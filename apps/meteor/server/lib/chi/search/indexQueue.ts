/**
 * MATTERCHAT: the dirty-room queue behind live Chi search indexing (F9).
 *
 * ## Why a queue rather than "index the message that just arrived"
 *
 * The listener that feeds this runs on EVERY message saved anywhere on the workspace, so its
 * cost is multiplied by the busiest hour the deployment will ever have. Embedding a passage is
 * a network round-trip to a paid provider; doing that on the hot path would couple every
 * person's message-send latency to a third party's p99, and would bill one request per message
 * instead of one per batch.
 *
 * So the hot path does exactly one thing — bump a per-room counter — and a ticker drains it.
 * The same discipline as server/lib/caseProCommsLog/batcher.ts, and for the same reason.
 *
 * ## The in-memory state is a hint, never the truth
 *
 * A flush calls back into `indexNewMessages`, which reads its own watermark out of the index
 * collection and re-derives what is missing. Losing this map to a restart therefore costs
 * nothing but latency: the next message in a room re-dirties it, and the periodic backfill
 * sweeps whatever never got another message. Nothing here is allowed to be the only record
 * that work is outstanding.
 *
 * ## Bounded on every axis
 *
 *  - `maxRoomsPerTick` — provider calls per tick, so a busy workspace cannot burst the bill.
 *  - `maxTrackedRooms` — a hard ceiling on the map. Past it, new rooms are simply not tracked
 *    (counted in `stats().dropped`) rather than evicting an existing entry, because eviction
 *    would need an O(n) scan on the one path that must stay O(1). A dropped room is not a lost
 *    room — it is indexed on its next message, or by the backfill.
 *  - `maxBatch` — a room that fills up early flushes early instead of waiting out the interval.
 *
 * PURE: no meteor, no models, no settings, no clock of its own. `now` is always a parameter,
 * so the ticker behaviour is testable without waiting for real time to pass.
 */

export type IndexQueueFlushResult = {
	/** Passages written. Diagnostics only — the queue does not branch on it. */
	indexed: number;
	/** True when the pass hit its message cap, i.e. the room still has history to chew through. */
	more: boolean;
};

export interface IndexQueueDeps {
	/** Index whatever is new in one room. MUST throw on a failure that deserves a retry. */
	flushRoom(rid: string): Promise<IndexQueueFlushResult>;
	onError(context: string, err: unknown): void;
	onInfo?(msg: string): void;
}

export type IndexQueueOptions = {
	/** Flush a dirty room after this long even if only one message arrived. */
	flushIntervalMs?: number;
	/** Flush immediately once this many messages are pending in one room. */
	maxBatch?: number;
	/** Rooms drained per tick — the provider-call budget. */
	maxRoomsPerTick?: number;
	/** Ceiling on tracked rooms; past it new rooms are dropped, not evicted. */
	maxTrackedRooms?: number;
	baseBackoffMs?: number;
	maxBackoffMs?: number;
};

export const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
export const DEFAULT_MAX_BATCH = 25;
export const DEFAULT_MAX_ROOMS_PER_TICK = 10;
export const DEFAULT_MAX_TRACKED_ROOMS = 2000;
const DEFAULT_BASE_BACKOFF_MS = 60_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000;

type RoomState = {
	/** Messages noticed since the last successful flush. */
	pending: number;
	/** When the room went dirty — drives both the interval flush and fair ordering. */
	dirtySince: number;
	nextAttemptAt: number;
	backoffMs: number;
	flushing: boolean;
};

export class SearchIndexQueue {
	private readonly rooms = new Map<string, RoomState>();

	/** Rooms turned away at the ceiling since boot. Surfaced by `stats()`, never reset silently. */
	private dropped = 0;

	private readonly flushIntervalMs: number;

	private readonly maxBatch: number;

	private readonly maxRoomsPerTick: number;

	private readonly maxTrackedRooms: number;

	private readonly baseBackoffMs: number;

	private readonly maxBackoffMs: number;

	constructor(
		private readonly deps: IndexQueueDeps,
		options: IndexQueueOptions = {},
	) {
		this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
		this.maxBatch = options.maxBatch ?? DEFAULT_MAX_BATCH;
		this.maxRoomsPerTick = options.maxRoomsPerTick ?? DEFAULT_MAX_ROOMS_PER_TICK;
		this.maxTrackedRooms = options.maxTrackedRooms ?? DEFAULT_MAX_TRACKED_ROOMS;
		this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
		this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
	}

	/**
	 * THE HOT PATH. Called from afterSaveMessage for every indexable message on the workspace:
	 * one map lookup, a few field writes, no I/O and no await. Never throws.
	 */
	noteMessageSaved(rid: string, now = Date.now()): void {
		let state = this.rooms.get(rid);
		if (!state) {
			if (this.rooms.size >= this.maxTrackedRooms) {
				// Ceiling reached. Deliberately a no-op: the room keeps its place in the
				// index's own watermark, so the next message after the queue drains — or the
				// backfill — picks it up. Latency, not loss.
				this.dropped += 1;
				return;
			}
			state = { pending: 0, dirtySince: now, nextAttemptAt: 0, backoffMs: 0, flushing: false };
			this.rooms.set(rid, state);
		}
		if (state.pending === 0) {
			state.dirtySince = now;
		}
		state.pending += 1;
		if (state.pending >= this.maxBatch && now >= state.nextAttemptAt && !state.flushing) {
			void this.flushRoom(rid, now);
		}
	}

	/** Mark a room as needing a pass on the next tick (boot resume, or an explicit request). */
	resumeRoom(rid: string, now = Date.now()): void {
		let state = this.rooms.get(rid);
		if (!state) {
			if (this.rooms.size >= this.maxTrackedRooms) {
				this.dropped += 1;
				return;
			}
			state = { pending: 0, dirtySince: now, nextAttemptAt: 0, backoffMs: 0, flushing: false };
			this.rooms.set(rid, state);
		}
		state.pending = Math.max(state.pending, 1);
		state.dirtySince = now - this.flushIntervalMs; // due immediately
	}

	/**
	 * Ticker entry point. Drains the rooms that are due, OLDEST-DIRTY FIRST so a chatty room
	 * cannot starve a quiet one out of the index, and never more than the per-tick budget.
	 */
	async flushDue(now = Date.now()): Promise<void> {
		const due: { rid: string; dirtySince: number }[] = [];
		for (const [rid, state] of this.rooms) {
			if (state.flushing || now < state.nextAttemptAt) {
				continue;
			}
			if (state.pending === 0) {
				this.rooms.delete(rid);
				continue;
			}
			if (state.pending >= this.maxBatch || now - state.dirtySince >= this.flushIntervalMs) {
				due.push({ rid, dirtySince: state.dirtySince });
			}
		}
		due.sort((a, b) => a.dirtySince - b.dirtySince);
		for (const { rid } of due.slice(0, this.maxRoomsPerTick)) {
			// eslint-disable-next-line no-await-in-loop
			await this.flushRoom(rid, now);
		}
	}

	/**
	 * Index one room. Never throws: a provider outage backs the room off and leaves the pending
	 * signal in place, so the work is retried rather than dropped.
	 */
	async flushRoom(rid: string, now = Date.now()): Promise<void> {
		const state = this.rooms.get(rid);
		if (!state || state.flushing) {
			return;
		}
		state.flushing = true;
		// Snapshot: anything the hook adds while we await below survives into the next pass.
		const covered = state.pending;
		try {
			const result = await this.deps.flushRoom(rid);
			state.pending = Math.max(0, state.pending - covered);
			state.backoffMs = 0;
			state.nextAttemptAt = 0;
			if (result.more) {
				// The pass hit its message cap; there is more history behind it.
				state.pending = Math.max(state.pending, 1);
			}
			if (state.pending > 0) {
				state.dirtySince = now - this.flushIntervalMs; // due on the next tick
			} else {
				this.rooms.delete(rid);
			}
			if (result.indexed) {
				this.deps.onInfo?.(`chi-search: indexed ${result.indexed} passage(s) for room ${rid}`);
			}
		} catch (err) {
			state.backoffMs = Math.min(state.backoffMs > 0 ? state.backoffMs * 2 : this.baseBackoffMs, this.maxBackoffMs);
			state.nextAttemptAt = now + state.backoffMs;
			state.pending = Math.max(state.pending, 1);
			this.deps.onError(`chi-search: indexing failed for room ${rid} (retry in ${state.backoffMs}ms)`, err);
		} finally {
			state.flushing = false;
		}
	}

	/** Diagnostics. `dropped` being non-zero means the ceiling is being hit and wants raising. */
	stats(): { rooms: number; pending: number; dropped: number } {
		let pending = 0;
		for (const state of this.rooms.values()) {
			pending += state.pending;
		}
		return { rooms: this.rooms.size, pending, dropped: this.dropped };
	}

	/** Test/diagnostics helper. */
	pendingRooms(): string[] {
		return [...this.rooms.keys()];
	}
}
