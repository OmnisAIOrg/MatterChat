/**
 * Deterministic id scheme for the live message bridge — LOOP PREVENTION, leg 2 + persistent
 * dedupe. NO Meteor imports — unit-tested directly
 * (apps/meteor/tests/unit/app/connectors/bridgeIds.spec.ts).
 *
 * Bridge-inserted RC messages get `_id = ext-<connectionId>-<channelHash>-<externalMessageId>`:
 *  - the `ext-` prefix is the outbound guard (skip re-posting what the bridge itself inserted) —
 *    the re-namespaced descendant of SlackBridge's `slack-<channel>-<ts>` / `indexOf('slack-')`
 *    scheme (spec §7 "Re-namespace RC message IDs");
 *  - connectionId scoping means two connections (two users / two providers) bridging the same
 *    external channel can never collide on _id;
 *  - determinism makes inbound INSERTS IDEMPOTENT: Graph re-deliveries / double-processing upsert
 *    onto the same _id instead of duplicating the message.
 *
 * Rooms are tagged `importIds: ['ext:<connectionId>:<channelExternalId>']` (spec §4.3) — the
 * cheap "is this room bridged at all?" gate the outbound callback reads before any Mongo lookup.
 */
import crypto from 'crypto';

/** Prefix of every RC message _id the bridge inserts (the outbound skip guard keys on it). */
export const EXT_MESSAGE_ID_PREFIX = 'ext-';

/** Prefix of the room importIds tag marking a room as connector-bridged. */
export const EXT_ROOM_IMPORT_ID_PREFIX = 'ext:';

/** Short stable hash of the channel token — keeps _ids bounded (channel ids are long + symbol-y). */
function channelHash(channelExternalId: string): string {
	return crypto.createHash('sha256').update(channelExternalId).digest('hex').slice(0, 10);
}

/** Make an external message id safe inside an RC _id (Graph ids are numeric; belt & braces). */
function sanitizeExternalId(externalMessageId: string): string {
	return externalMessageId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** The deterministic RC message _id for one external message on one connection. */
export function extMessageId(connectionId: string, channelExternalId: string, externalMessageId: string): string {
	return `${EXT_MESSAGE_ID_PREFIX}${connectionId}-${channelHash(channelExternalId)}-${sanitizeExternalId(externalMessageId)}`;
}

/** True when an RC message _id was minted by the bridge (outbound must not re-post it). */
export function isBridgeMessageId(messageId: string): boolean {
	return messageId.startsWith(EXT_MESSAGE_ID_PREFIX);
}

/** The room importIds tag for one bridged channel on one connection (spec §4.3 namespacing). */
export function roomImportId(connectionId: string, channelExternalId: string): string {
	return `${EXT_ROOM_IMPORT_ID_PREFIX}${connectionId}:${channelExternalId}`;
}

/** True when a room importIds entry marks a connector bridge (the cheap outbound gate). */
export function isBridgeRoomImportId(importId: unknown): boolean {
	return typeof importId === 'string' && importId.startsWith(EXT_ROOM_IMPORT_ID_PREFIX);
}
