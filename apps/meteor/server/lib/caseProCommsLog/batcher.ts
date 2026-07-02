/**
 * CasePro comms-log batcher — the pure core of "matter-channel messages auto-log
 * to the CasePro matter's Communications history".
 *
 * DESIGN (mirrors the Teams bridge's afterSaveMessage discipline, bridgeCore.ts):
 *  - The afterSaveMessage hook NEVER blocks a message send: it only bumps an
 *    in-memory per-room counter (plus, for edits, stashes the message itself) —
 *    zero I/O on the hot path beyond what the hook already has in hand.
 *  - A ticker flushes each dirty room when EITHER ~60s have passed since it went
 *    dirty OR ≥20 messages are pending — whichever comes first.
 *  - A flush is CURSOR-DRIVEN, not queue-driven: it re-reads messages from Mongo
 *    strictly after the room's persisted cursor (`room.caseProCommsLog.lastLoggedTs`)
 *    and advances the cursor only after CasePro acknowledged the batch. Restarts
 *    therefore resume exactly where they left off; the in-memory state is just a
 *    "something to do" signal, never the source of truth.
 *  - Failures back off exponentially (30s → 15min cap), are logged, and retried
 *    forever — messages are never dropped silently (they stay behind the cursor).
 *  - Edits of already-logged messages are re-sent explicitly ("extras") with the
 *    same message id; the CasePro ingest is idempotent per id, so they are no-ops
 *    upstream (first ingest wins) and never corrupt the cursor.
 *
 * Everything environmental (Mongo, settings, the CasePro transport) arrives via
 * {@link CommsLogBatcherDeps} so this file is unit-testable without Meteor.
 */

export type CommsLogMessage = {
	message_id: string;
	sender_name: string;
	/** ISO 8601 */
	sent_at: string;
	text: string;
};

export type CommsLogBatchPayload = {
	matter_id: string;
	channel_id: string;
	channel_name: string;
	messages: CommsLogMessage[];
};

/** What a flush needs to know about a room (re-read fresh every flush). */
export type CommsLogRoomTarget = {
	rid: string;
	matterId: string;
	channelName: string;
	/** Global switches AND the per-channel toggle, evaluated at flush time. */
	enabled: boolean;
	/** Persisted cursor; null ⇒ nothing logged yet for this room. */
	cursorTs: Date | null;
};

export interface CommsLogBatcherDeps {
	/** Room + toggles + cursor, read fresh at flush time. null ⇒ room gone / not matter-linked. */
	getRoomTarget(rid: string): Promise<CommsLogRoomTarget | null>;
	/** Loggable (non-system, non-empty) messages strictly after `since`, ascending, capped. */
	fetchLoggableMessagesSince(rid: string, since: Date, limit: number): Promise<(CommsLogMessage & { ts: Date })[]>;
	/** POST one digest to the CasePro ingest endpoint. MUST throw on failure. */
	postBatch(target: CommsLogRoomTarget, payload: CommsLogBatchPayload): Promise<void>;
	/** Persist the cursor after CasePro acknowledged everything up to (ts, id). */
	setCursor(rid: string, lastTs: Date, lastId: string): Promise<void>;
	onError(context: string, err: unknown): void;
	onInfo?(msg: string): void;
}

export type CommsLogBatcherOptions = {
	/** Flush a dirty room after this long even if the batch is small. */
	flushIntervalMs?: number;
	/** Flush immediately once this many messages are pending. */
	maxBatch?: number;
	/** Page size for a single cursor fetch (a busy room drains over several flushes). */
	fetchLimit?: number;
	baseBackoffMs?: number;
	maxBackoffMs?: number;
};

export const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
export const DEFAULT_MAX_BATCH = 20;
const DEFAULT_FETCH_LIMIT = 100;
const DEFAULT_BASE_BACKOFF_MS = 30_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000;

type RoomState = {
	/** New (non-edit) messages noticed since the last successful flush. */
	pending: number;
	/** Edits of possibly-already-logged messages, re-sent verbatim (idempotent upstream). */
	extras: Map<string, CommsLogMessage>;
	/** When the room went dirty (drives the ~60s flush). */
	dirtySince: number;
	/** Earliest new-message ts seen while the room has NO persisted cursor yet. */
	firstPendingTs: number | null;
	nextAttemptAt: number;
	backoffMs: number;
	flushing: boolean;
};

export class CommsLogBatcher {
	private readonly rooms = new Map<string, RoomState>();

	private readonly flushIntervalMs: number;

	private readonly maxBatch: number;

	private readonly fetchLimit: number;

	private readonly baseBackoffMs: number;

	private readonly maxBackoffMs: number;

	constructor(
		private readonly deps: CommsLogBatcherDeps,
		options: CommsLogBatcherOptions = {},
	) {
		this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
		this.maxBatch = options.maxBatch ?? DEFAULT_MAX_BATCH;
		this.fetchLimit = options.fetchLimit ?? DEFAULT_FETCH_LIMIT;
		this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
		this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
	}

	private stateFor(rid: string, now: number): RoomState {
		let state = this.rooms.get(rid);
		if (!state) {
			state = {
				pending: 0,
				extras: new Map(),
				dirtySince: now,
				firstPendingTs: null,
				nextAttemptAt: 0,
				backoffMs: 0,
				flushing: false,
			};
			this.rooms.set(rid, state);
		}
		return state;
	}

	/**
	 * Hot path (called from afterSaveMessage; the caller already gated on
	 * room.matterId + toggles + system/empty messages). Never throws, never awaits.
	 */
	noteMessageSaved(rid: string, message: { ts: Date }, edit?: CommsLogMessage, now = Date.now()): void {
		const state = this.stateFor(rid, now);
		const wasIdle = state.pending === 0 && state.extras.size === 0;
		if (edit) {
			state.extras.set(edit.message_id, edit);
		} else {
			state.pending += 1;
			const ms = message.ts.getTime();
			if (state.firstPendingTs === null || ms < state.firstPendingTs) {
				state.firstPendingTs = ms;
			}
		}
		if (wasIdle) {
			state.dirtySince = now;
		}
		if (state.pending + state.extras.size >= this.maxBatch && now >= state.nextAttemptAt && !state.flushing) {
			void this.flushRoom(rid, now);
		}
	}

	/** Boot-time resume: mark a room dirty so the next tick drains everything past its cursor. */
	resumeRoom(rid: string, now = Date.now()): void {
		const state = this.stateFor(rid, now);
		state.pending = Math.max(state.pending, 1);
		state.dirtySince = now - this.flushIntervalMs; // due immediately
	}

	/** Ticker entry point — flush every room whose time or size threshold is met. */
	async flushDue(now = Date.now()): Promise<void> {
		const due: string[] = [];
		for (const [rid, state] of this.rooms) {
			if (state.flushing || now < state.nextAttemptAt) {
				continue;
			}
			const size = state.pending + state.extras.size;
			if (size === 0) {
				this.rooms.delete(rid);
				continue;
			}
			if (size >= this.maxBatch || now - state.dirtySince >= this.flushIntervalMs) {
				due.push(rid);
			}
		}
		for (const rid of due) {
			// eslint-disable-next-line no-await-in-loop
			await this.flushRoom(rid, now);
		}
	}

	/**
	 * Drain one room: cursor-fetch new messages + re-send stashed edits, POST one
	 * digest, then advance the cursor. Never throws.
	 */
	async flushRoom(rid: string, now = Date.now()): Promise<void> {
		const state = this.rooms.get(rid);
		if (!state || state.flushing) {
			return;
		}
		state.flushing = true;
		try {
			const target = await this.deps.getRoomTarget(rid);
			if (!target) {
				// Room deleted or matter unlinked — nothing to log against anymore.
				this.rooms.delete(rid);
				return;
			}
			if (!target.enabled) {
				// Toggled off (per-channel or globally): zero traffic. Drop the queue;
				// the cursor stays where it was, so re-enabling does not backfill the
				// silenced window.
				this.rooms.delete(rid);
				return;
			}

			// No persisted cursor yet ⇒ this room was never logged. Start from the
			// first message the hook observed — deliberately NOT from the beginning
			// of the room's history (linking a matter must not silently exfiltrate
			// months of past conversation).
			const since = target.cursorTs ?? (state.firstPendingTs !== null ? new Date(state.firstPendingTs - 1) : null);

			// Snapshot what this flush covers; anything the hook adds while we await
			// below stays queued for the next tick instead of being dropped.
			const pendingSnapshot = state.pending;
			const fetched = since ? await this.deps.fetchLoggableMessagesSince(rid, since, this.fetchLimit) : [];
			const fetchedIds = new Set(fetched.map((m) => m.message_id));
			const extras = [...state.extras.values()].filter((m) => !fetchedIds.has(m.message_id));
			const sentExtraIds = extras.map((m) => m.message_id);

			if (fetched.length === 0 && extras.length === 0) {
				this.rooms.delete(rid);
				return;
			}

			const messages: CommsLogMessage[] = [
				...fetched.map(({ ts: _ts, ...m }) => m),
				...extras,
			].sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at));

			await this.deps.postBatch(target, {
				matter_id: target.matterId,
				channel_id: rid,
				channel_name: target.channelName,
				messages,
			});

			if (fetched.length > 0) {
				const last = fetched[fetched.length - 1];
				await this.deps.setCursor(rid, last.ts, last.message_id);
			}

			// Success: consume exactly what this flush covered. Messages/edits that
			// arrived during the awaits stay queued; a full fetch page means more
			// history is waiting — either way, go again on the next tick.
			for (const id of sentExtraIds) {
				state.extras.delete(id);
			}
			for (const id of fetchedIds) {
				state.extras.delete(id);
			}
			state.pending = Math.max(0, state.pending - pendingSnapshot);
			state.backoffMs = 0;
			state.nextAttemptAt = 0;
			state.firstPendingTs = null;
			if (fetched.length === this.fetchLimit) {
				state.pending = Math.max(state.pending, 1);
			}
			if (state.pending + state.extras.size > 0) {
				state.dirtySince = now - this.flushIntervalMs; // due on the next tick
			} else {
				this.rooms.delete(rid);
			}
			this.deps.onInfo?.(`comms-log: flushed ${messages.length} message(s) for room ${rid}`);
		} catch (err) {
			// Failure: keep everything (pending signal, extras, cursor untouched) and
			// back off. Nothing is lost — the next successful flush re-reads from the
			// cursor.
			state.backoffMs = Math.min(state.backoffMs > 0 ? state.backoffMs * 2 : this.baseBackoffMs, this.maxBackoffMs);
			state.nextAttemptAt = now + state.backoffMs;
			state.pending = Math.max(state.pending, 1);
			this.deps.onError(`comms-log: flush failed for room ${rid} (retry in ${state.backoffMs}ms)`, err);
		} finally {
			state.flushing = false;
		}
	}

	/** Test/diagnostics helper. */
	pendingRooms(): string[] {
		return [...this.rooms.keys()];
	}
}
