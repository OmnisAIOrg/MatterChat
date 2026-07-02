/**
 * Echo suppression for the live message bridge — LOOP PREVENTION, leg 1 (spec §7 "Echo
 * suppression"). NO Meteor imports — unit-tested directly
 * (apps/meteor/tests/unit/app/connectors/echoSuppression.spec.ts).
 *
 * THE LOOP: a message typed in a bridged MatterChat room is posted outbound to the external
 * channel; the external workspace then emits a change-notification for that very message; without
 * suppression the bridge would re-insert its own post as a "new" inbound message (and, with
 * outbound wired to afterSaveMessage, loop forever).
 *
 * THE GUARDS (three, layered):
 *  1. THIS module: after every outbound post, the returned EXTERNAL message id is remembered for a
 *     TTL window; the inbound path drops any notification whose message id is remembered.
 *     In-memory (per instance) — fast path, survives nothing.
 *  2. Bridge-inserted RC messages carry a deterministic `ext-…` _id (bridgeCore.extMessageId), and
 *     the OUTBOUND callback skips any message whose _id starts with that prefix — mirrors the
 *     SlackBridge `_id.indexOf('slack-') === 0` guard, re-namespaced per connection.
 *  3. Persistent dedupe: inbound insert uses the SAME deterministic `ext-…` _id, so a re-delivered
 *     or double-processed notification upserts onto itself instead of duplicating; and outbound
 *     posts are stamped (`customFields.connectorBridge.externalId`) so the echo of our own post is
 *     recognized even after a restart empties this in-memory set.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — Graph notification latency is <10s avg, 1 min max.
const MAX_ENTRIES = 5000; // hard cap so a chatty instance can never grow unbounded.

/** A TTL set of external message ids the bridge itself created (keyed per connection+message). */
export class EchoSuppressionSet {
	private readonly entries = new Map<string, number>();

	constructor(
		private readonly ttlMs: number = DEFAULT_TTL_MS,
		private readonly now: () => number = Date.now,
	) {}

	private key(connectionId: string, externalMessageId: string): string {
		return `${connectionId}:${externalMessageId}`;
	}

	/** Remember an external message id this bridge just posted outbound. */
	add(connectionId: string, externalMessageId: string): void {
		this.sweep();
		// Oldest-first eviction when at cap (Map preserves insertion order).
		if (this.entries.size >= MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) {
				this.entries.delete(oldest);
			}
		}
		this.entries.set(this.key(connectionId, externalMessageId), this.now() + this.ttlMs);
	}

	/** True when this external message id was posted by the bridge within the TTL window. */
	has(connectionId: string, externalMessageId: string): boolean {
		const key = this.key(connectionId, externalMessageId);
		const expiresAt = this.entries.get(key);
		if (expiresAt === undefined) {
			return false;
		}
		if (expiresAt <= this.now()) {
			this.entries.delete(key);
			return false;
		}
		return true;
	}

	/** Drop expired entries (called on every add; cheap — bounded by MAX_ENTRIES). */
	private sweep(): void {
		const now = this.now();
		for (const [key, expiresAt] of this.entries) {
			if (expiresAt <= now) {
				this.entries.delete(key);
			}
		}
	}

	/** Current live entry count (test/introspection helper). */
	size(): number {
		this.sweep();
		return this.entries.size;
	}
}

/** Singleton used by the bridge (one per server instance). */
export const echoSuppression = new EchoSuppressionSet();
