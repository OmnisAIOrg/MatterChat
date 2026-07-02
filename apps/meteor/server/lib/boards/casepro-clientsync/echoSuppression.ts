/**
 * Echo suppression for the CasePro client-message two-way sync — LOOP PREVENTION.
 * NO Meteor imports so it is unit-tested directly.
 *
 * THE LOOP: a staff message typed in a MatterChat "Client" channel is POSTed outbound to
 * CasePro (`direction='outbound'`); the inbound poll then reads that very message back and,
 * without suppression, would re-insert it into the Client channel as a "new" firm message —
 * and, because that re-insert is itself an afterSaveMessage, could loop.
 *
 * THE GUARDS (three, layered — same shape as the connectors bridge, spec-parallel):
 *  1. THIS module: after every outbound POST, the returned CasePro `client_messages.id` is
 *     remembered for a TTL window; the inbound path drops any message whose id is remembered.
 *     In-memory (per instance) — the fast path, survives nothing.
 *  2. DETERMINISTIC RC _id: inbound messages are inserted with a stable `cpc-<matterId>-<id>`
 *     _id, and the OUTBOUND afterSaveMessage callback SKIPS any message whose _id starts with
 *     that prefix — so a mirrored inbound message is never re-POSTed outbound.
 *  3. PERSISTENT dedupe: inbound insert uses that same deterministic _id (a re-delivered poll
 *     upserts onto itself, never duplicates); and every outbound message we ingest is matched
 *     by its CasePro id so our own firm echo is recognised even after a restart empties the
 *     in-memory set — CasePro's `from:'firm'` rows we posted carry the `sourceMessageId` we
 *     sent, which the poll compares against the RC message that produced them.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — CasePro write→read latency is a poll cycle (<1 min).
const MAX_ENTRIES = 5000; // hard cap so a chatty matter can never grow this unbounded.

/** Deterministic RC message _id for a CasePro client message mirrored into a Client channel. */
export function clientSyncMessageId(matterId: string, caseProMessageId: string): string {
	return `cpc-${matterId}-${caseProMessageId}`;
}

/** True when an RC message _id was produced by this sync (so the outbound leg must skip it). */
export function isClientSyncMessageId(id: string | undefined): boolean {
	return typeof id === 'string' && id.startsWith('cpc-');
}

/** A TTL set of CasePro message ids this sync just POSTed outbound (keyed per matter+id). */
export class EchoSuppressionSet {
	private readonly entries = new Map<string, number>();

	constructor(
		private readonly ttlMs: number = DEFAULT_TTL_MS,
		private readonly now: () => number = Date.now,
	) {}

	private key(matterId: string, caseProMessageId: string): string {
		return `${matterId}:${caseProMessageId}`;
	}

	/** Remember a CasePro message id this sync just created via an outbound POST. */
	add(matterId: string, caseProMessageId: string): void {
		this.sweep();
		if (this.entries.size >= MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) {
				this.entries.delete(oldest);
			}
		}
		this.entries.set(this.key(matterId, caseProMessageId), this.now() + this.ttlMs);
	}

	/** True when this CasePro message id was posted by the sync within the TTL window. */
	has(matterId: string, caseProMessageId: string): boolean {
		const k = this.key(matterId, caseProMessageId);
		const expiresAt = this.entries.get(k);
		if (expiresAt === undefined) {
			return false;
		}
		if (expiresAt <= this.now()) {
			this.entries.delete(k);
			return false;
		}
		return true;
	}

	/** Drop expired entries (called on every add; bounded by MAX_ENTRIES). */
	private sweep(): void {
		const now = this.now();
		for (const [k, expiresAt] of this.entries) {
			if (expiresAt <= now) {
				this.entries.delete(k);
			}
		}
	}

	/** Current live entry count (test/introspection helper). */
	size(): number {
		this.sweep();
		return this.entries.size;
	}
}

export const clientSyncEcho = new EchoSuppressionSet();
