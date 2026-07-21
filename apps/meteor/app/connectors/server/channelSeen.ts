/**
 * Store-computed unread state for external (browse-lane) conversations — pure helpers, no Meteor
 * (unit-tested at tests/unit/app/connectors/channelSeen.spec.ts).
 *
 * WHY THIS EXISTS (founder bug 2026-07-20: "no red dot ever shows"): per-conversation unread
 * counts used to come only from the PROVIDER's API — which Slack restricts for non-Marketplace
 * apps (always 0) and Teams/Google don't reliably report. But since the live message bridge, every
 * inbound message is persisted to MatterChat's own durable store the moment it arrives — so unread
 * is now computed from OUR data: `inbound rows newer than the user's last-seen marker`, uniformly
 * for slack/teams/google.
 *
 * SEEN MARKERS live on the user's own connection doc as `lastSeenByChannel` — a record keyed by
 * BASE64URL-encoded channel id (Teams channel ids contain '.'/'$' which are illegal in Mongo
 * field names; base64url is unambiguous and reversible). Written by markMyRead (the sidebar
 * already calls markRead on every conversation open).
 */

/** Mongo-safe field key for one external channel id. */
export function encodeChannelKey(channelExternalId: string): string {
	return Buffer.from(channelExternalId, 'utf8').toString('base64url');
}

export function decodeChannelKey(key: string): string {
	return Buffer.from(key, 'base64url').toString('utf8');
}

export type SeenMarkers = Record<string, Date | string> | undefined;

/** Resolve the last-seen instant for one channel (undefined = never seen). */
export function lastSeenFor(markers: SeenMarkers, channelExternalId: string): Date | undefined {
	const raw = markers?.[encodeChannelKey(channelExternalId)];
	if (!raw) {
		return undefined;
	}
	const d = raw instanceof Date ? raw : new Date(raw);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

export type InboundRow = { channelExternalId: string; createdAt: Date | string };

/**
 * Count inbound rows newer than each channel's marker. Rows for never-seen channels ALL count.
 * Returns only channels with a non-zero count.
 */
export function storeUnreadCounts(rows: InboundRow[], markers: SeenMarkers): Map<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (!row?.channelExternalId) {
			continue;
		}
		const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
		if (Number.isNaN(created.getTime())) {
			continue;
		}
		const seen = lastSeenFor(markers, row.channelExternalId);
		if (seen && created <= seen) {
			continue;
		}
		counts.set(row.channelExternalId, (counts.get(row.channelExternalId) ?? 0) + 1);
	}
	return counts;
}
