/**
 * Pure processing logic for the CasePro case-update webhook. NO Meteor imports — this module is
 * unit-tested directly (apps/meteor/tests/unit/app/casepro-events/processing.spec.ts). All time
 * and scheduling is injectable (now()/schedule()) so tests never sleep.
 *
 * IDEMPOTENCY  — EventMemo: an in-memory TTL memo keyed by event_id (caller falls back to a
 *                sha256 of the raw body when event_id is missing). 15-min TTL, ~10k entry cap,
 *                lazy eviction on insert (expired first, then oldest-inserted).
 *
 * BURST COLLAPSE — MatterDigestBuffer: per matter_id, the FIRST event opens a 60s window and is
 *                BUFFERED (nothing posts immediately); every further event for the same matter
 *                inside the window joins the buffer; when the window closes, ONE digest message
 *                summarizing all buffered events is flushed. A lone event therefore posts up to
 *                60s late — chosen over post-first-then-buffer so a burst never produces two
 *                messages.
 *
 * MESSAGE TEXT — never includes field VALUES (the payload carries none). Single event:
 *                "Case update: Insurance updated — fields: status, phase". Digest:
 *                "Case update: 3 changes — insurance updated ×2, note created". Optional deep
 *                link appended on its own line when a CasePro web base URL is configured.
 */
import type { CaseProEvent } from './security';

// ─── idempotency ───────────────────────────────────────────────────────────────────────────────

export const EVENT_MEMO_TTL_MS = 15 * 60 * 1000;
export const EVENT_MEMO_MAX_ENTRIES = 10_000;

/** In-memory first-seen memo with TTL + size cap. Insertion-ordered Map ⇒ oldest evicts first. */
export class EventMemo {
	private seen = new Map<string, number>();

	constructor(
		private readonly ttlMs: number = EVENT_MEMO_TTL_MS,
		private readonly maxEntries: number = EVENT_MEMO_MAX_ENTRIES,
		private readonly now: () => number = Date.now,
	) {}

	/** True when `key` is first-seen inside the TTL (and records it); false for a duplicate. */
	firstSeen(key: string): boolean {
		const now = this.now();
		const at = this.seen.get(key);
		if (at !== undefined && now - at < this.ttlMs) {
			return false;
		}
		this.seen.delete(key);
		this.evict(now);
		this.seen.set(key, now);
		return true;
	}

	/** Lazy eviction: drop expired entries; if still at cap, drop oldest-inserted. */
	private evict(now: number): void {
		if (this.seen.size < this.maxEntries) {
			return;
		}
		for (const [key, at] of this.seen) {
			if (now - at >= this.ttlMs) {
				this.seen.delete(key);
			}
		}
		while (this.seen.size >= this.maxEntries) {
			const oldest = this.seen.keys().next();
			if (oldest.done) {
				break;
			}
			this.seen.delete(oldest.value);
		}
	}
}

// ─── burst collapse ────────────────────────────────────────────────────────────────────────────

export const DIGEST_WINDOW_MS = 60 * 1000;

export type DigestFlush = (matterId: string, events: CaseProEvent[]) => void | Promise<void>;
export type Scheduler = (fn: () => void, ms: number) => unknown;

/**
 * Per-matter event buffer. First event for a matter schedules a single flush at windowMs; all
 * events arriving before the flush join it. onFlush errors are swallowed (the webhook must never
 * throw out of a timer); the glue layer logs inside its own onFlush.
 */
export class MatterDigestBuffer {
	private buffers = new Map<string, CaseProEvent[]>();

	constructor(
		private readonly onFlush: DigestFlush,
		private readonly windowMs: number = DIGEST_WINDOW_MS,
		private readonly schedule: Scheduler = (fn, ms) => setTimeout(fn, ms),
	) {}

	add(event: CaseProEvent, matterId: string): void {
		const buffered = this.buffers.get(matterId);
		if (buffered) {
			buffered.push(event);
			return;
		}
		this.buffers.set(matterId, [event]);
		this.schedule(() => this.flush(matterId), this.windowMs);
	}

	private flush(matterId: string): void {
		const events = this.buffers.get(matterId);
		this.buffers.delete(matterId);
		if (!events?.length) {
			return;
		}
		try {
			void Promise.resolve(this.onFlush(matterId, events)).catch(() => undefined);
		} catch {
			// never throw out of a timer callback
		}
	}
}

// ─── message formatting ────────────────────────────────────────────────────────────────────────

/**
 * Humanize a CasePro entity_type: singularize + capitalize + underscores→spaces.
 *   matters → Matter, insurances → Insurance, medical_providers → Medical provider,
 *   injuries → Injury, notes → Note; unknown types degrade to the same rules.
 */
export function humanizeEntityType(entityType: string): string {
	const spaced = entityType.replace(/_/g, ' ').trim() || 'record';
	let singular = spaced;
	if (/ies$/i.test(spaced)) {
		singular = `${spaced.slice(0, -3)}y`;
	} else if (/s$/i.test(spaced) && !/(?:ss|us)$/i.test(spaced)) {
		// "ss"/"us" endings ("address", "status") are not plurals — leave them alone.
		singular = spaced.slice(0, -1);
	}
	return singular.charAt(0).toUpperCase() + singular.slice(1).toLowerCase();
}

/** "insurance updated" — the lowercase descriptor used inside digest lists. */
function describe(event: CaseProEvent): string {
	return `${humanizeEntityType(event.entityType).toLowerCase()} ${event.changeType}`;
}

/** Deep link into CasePro for a matter, or null when no web base URL is configured. */
export function matterLink(webBaseUrl: string, matterId: string): string | null {
	const base = webBaseUrl.trim().replace(/\/+$/, '');
	if (!base) {
		return null;
	}
	return `${base}/matters/${encodeURIComponent(matterId)}`;
}

/**
 * Render the (single or digest) room message for one flushed window. `webBaseUrl` may be empty —
 * plain text, no link. Never contains field values.
 */
export function formatCaseUpdateMessage(events: CaseProEvent[], matterId: string, webBaseUrl = ''): string {
	let text: string;
	if (events.length === 1) {
		const event = events[0];
		text = `Case update: ${humanizeEntityType(event.entityType)} ${event.changeType}`;
		if (event.changedFields.length > 0) {
			text += ` — fields: ${event.changedFields.join(', ')}`;
		}
	} else {
		// Collapse identical descriptors with counts, first-occurrence order.
		const counts = new Map<string, number>();
		for (const event of events) {
			const key = describe(event);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const parts = [...counts.entries()].map(([key, n]) => (n > 1 ? `${key} ×${n}` : key));
		text = `Case update: ${events.length} changes — ${parts.join(', ')}`;
	}
	const link = matterLink(webBaseUrl, matterId);
	return link ? `${text}\n${link}` : text;
}
