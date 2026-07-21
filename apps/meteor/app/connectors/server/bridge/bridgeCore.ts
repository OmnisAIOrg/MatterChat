/**
 * bridgeCore — the RC side of the live message bridge (the generalized RocketAdapter of the spec).
 *
 * OWNS ALL Rocket.Chat vocabulary: room creation/tagging, message insertion, the outbound
 * afterSaveMessage callback. Providers stay external-vocabulary-only; this module translates via
 * the connection doc + the deterministic id schemes in ./bridgeIds. Mirrors the shape of MIT
 * apps/meteor/app/slackbridge/server/RocketAdapter.ts (callback registration, importIds tagging,
 * alias rendering, the `slack-` → `ext-` id guard), parameterized by provider through the
 * providerRegistry instead of a hard-coded SlackAdapter. Nothing under apps/meteor/ee/ was read.
 *
 * DATA FLOW
 *  OUTBOUND: user types in a bridged room → afterSaveMessage fires → cheap gate on
 *    room.importIds (`ext:` prefix — no Mongo hit for normal rooms) → look up the bridging
 *    connection → post to the external channel AS THE CONNECTION OWNER (delegated token) →
 *    remember the returned external id (echo suppression) + stamp it on the RC message
 *    (persistent echo guard).
 *  INBOUND: webhook/backfill hands an IProviderMessage → dedupe (echo set → persistent stamp →
 *    deterministic _id) → insert into the bridged room, attributed to the external sender via the
 *    ALIAS mechanism (spec §4.3: user-scope connections never auto-create RC ghost accounts).
 *
 * ATTRIBUTION MODEL (per-user, delegated):
 *  - Outbound: ONLY messages authored by the connection owner are mirrored out — Graph cannot
 *    post as an arbitrary user (spec §3.4), and the bridged room belongs to the owner. Other RC
 *    users' messages in the room are skipped (logged).
 *  - Inbound: messages ride under the owner's account with `alias` = the external sender's
 *    display name; the owner's own native external posts carry no alias (they're genuinely theirs).
 */
import type { IExternalWorkspaceConnection, IBridgedChannel, IMessage, IRoom, IUser } from '@rocket.chat/core-typings';
import { isEditedMessage } from '@rocket.chat/core-typings';
import { ExternalWorkspaceConnections, Messages, Rooms, Users } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';

import { getBridgeBotUser } from './bridgeBot';
import { extMessageId, isBridgeMessageId, isBridgeRoomImportId, roomImportId } from './bridgeIds';
import { echoSuppression, reactionEcho, reactionEchoKey } from './echoSuppression';
import { callbacks } from '../../../../server/lib/callbacks';
import { SystemLogger } from '../../../../server/lib/logger/system';
import { createRoom } from '../../../lib/server/functions/createRoom';
import { sendMessage } from '../../../lib/server/functions/sendMessage';
import { settings } from '../../../settings/server';
import type { IOutboundMessage, IProviderMessage } from '../ChatProvider';
import { providerRegistry } from '../providerRegistry';
import { toProviderConnection } from '../runtimeConnection';

const BRIDGE_BOT_FALLBACK_USERNAME = 'connector.bridge';

const CALLBACK_ID = 'ConnectorBridge_Out';

/**
 * Parse a timestamp from an external message. Handles multiple formats:
 *  - Slack: 'seconds.micros' (e.g., '1752796800.123456') → unix seconds
 *  - Teams/Google: ISO-8601 strings → Date.parse
 *  - Fallback: current time if parsing fails
 */
function parseExternalTs(ts: string): Date {
	// Slack format: 'seconds.micros' (e.g., '1752796800.123456')
	if (/^\d+\.\d+$/.test(ts)) {
		const unix = Math.round(parseFloat(ts) * 1000);
		return new Date(unix);
	}
	// Try ISO/standard format (Teams, Google, etc.)
	const parsed = Date.parse(ts);
	if (!Number.isNaN(parsed)) {
		return new Date(parsed);
	}
	// Fallback: current time if all parsing fails
	return new Date();
}

/** Slug a channel label into a valid RC room name (default validation is `[0-9a-zA-Z-_.]+`). */
function roomNameFor(label: string): string {
	const slug = label
		.toLowerCase()
		.replace(/[^0-9a-z]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	// Random suffix dodges collisions with existing rooms (and repeated bridge/unbridge cycles).
	return `${slug || 'bridged'}-${Random.id(4).toLowerCase()}`;
}

/**
 * Create the private MatterChat room mirroring one external channel, owned by (and containing
 * only) the connection owner, and tag it:
 *  - `importIds: ['ext:<connectionId>:<channelExternalId>']` — the spec §4.3 namespaced tag; the
 *    outbound callback's cheap gate and the existing `Rooms.findOneByImportId` primitive.
 *  - `customFields.connectorBridge` — the client-readable tag (provider + connection) the UI can
 *    badge without parsing importIds.
 */
export async function createBridgedRoom(
	owner: IUser,
	connection: IExternalWorkspaceConnection,
	channelExternalId: string,
	label: string,
): Promise<IRoom> {
	const { rid } = await createRoom('p', roomNameFor(label), owner, [], false, false, {
		description: `Bridged from ${connection.externalOrgName || connection.provider}: ${label}`,
		customFields: {
			connectorBridge: {
				provider: connection.provider,
				connectionId: connection._id,
				channelExternalId,
			},
		},
	});
	await Rooms.addImportIds(rid, [roomImportId(connection._id, channelExternalId)]);
	const room = await Rooms.findOneById(rid);
	if (!room) {
		throw new Error('bridge_room_create_failed');
	}
	return room;
}

/**
 * Ingest ONE external message into a bridged room (called by the webhook and by backfill).
 * Idempotent + loop-safe:
 *  1. echo set — the bridge itself posted this external id moments ago → drop;
 *  2. persistent stamp — an RC message in this room already carries this external id in
 *     `customFields.connectorBridge.externalId` (our own outbound post, surviving restarts) → drop;
 *  3. deterministic `_id` — the message was already ingested (re-delivery/double-processing) → drop.
 *
 * Returns true when a message was actually inserted (callers advance lastInboundAt on truth).
 */
export async function ingestExternalMessage(
	doc: IExternalWorkspaceConnection,
	bridge: IBridgedChannel,
	message: IProviderMessage,
	ownerExternalId?: string,
): Promise<boolean> {
	if (!message.externalId || !message.text?.trim()) {
		return false;
	}

	// Guard 1 — in-memory echo set (fast path for the webhook echo of our own outbound post).
	if (echoSuppression.has(doc._id, message.externalId)) {
		return false;
	}

	// Guard 3 — deterministic _id: already ingested (Graph re-delivery / duplicate processing).
	const rcMessageId = extMessageId(doc._id, bridge.channelExternalId, message.externalId);
	if (await Messages.findOneById(rcMessageId, { projection: { _id: 1 } })) {
		// NOTE (documented v1 gap): `updated` notifications for an already-ingested message (edits,
		// reactions) are not re-applied yet — first ingest wins.
		return false;
	}

	// Guard 2 — persistent echo stamp: our own outbound RC message carries this external id.
	if (
		await Messages.findOne({ 'rid': bridge.rid, 'customFields.connectorBridge.externalId': message.externalId }, { projection: { _id: 1 } })
	) {
		return false;
	}

	const owner = await Users.findOneById(doc.userId, { projection: { username: 1, name: 1 } });
	if (!owner?.username) {
		SystemLogger.warn({ msg: 'Connector bridge inbound: owner user missing', connectionId: doc._id, userId: doc.userId });
		return false;
	}
	const room = await Rooms.findOneById(bridge.rid);
	if (!room) {
		SystemLogger.warn({ msg: 'Connector bridge inbound: bridged room missing', connectionId: doc._id, rid: bridge.rid });
		return false;
	}

	const senderIsOwner = Boolean(ownerExternalId) && message.authorExternalId === ownerExternalId;

	// Threading: link a reply to its already-ingested thread root (same deterministic id scheme).
	let tmid: string | undefined;
	if (message.threadExternalId) {
		const rootId = extMessageId(doc._id, bridge.channelExternalId, message.threadExternalId);
		if (await Messages.findOneById(rootId, { projection: { _id: 1 } })) {
			tmid = rootId;
		}
	}

	// AUTHOR: the owner's own echoes ride under the owner; messages from EXTERNAL senders are
	// authored by the bridge bot and rendered via ALIAS. The bot is load-bearing, not cosmetic:
	// validateMessage requires `message-impersonate` for ANY aliased message, humans don't have it,
	// and sending aliased inbound as the owner threw 'Not enough permission' — silently killing
	// every message from the other party (the founder's days-long "bridged room gets nothing" bug).
	const sender = senderIsOwner ? owner : await getBridgeBotUser();
	const rcMessage: Partial<IMessage> & { _id: string; rid: string; msg: string } = {
		_id: rcMessageId,
		rid: bridge.rid,
		msg: message.text,
		ts: parseExternalTs(message.ts),
		u: { _id: sender._id, username: sender.username ?? BRIDGE_BOT_FALLBACK_USERNAME },
		// External senders render via the ALIAS mechanism — never ghost RC accounts (spec §4.3).
		...(senderIsOwner ? {} : { alias: message.authorDisplayName || message.authorExternalId }),
		...(tmid ? { tmid } : {}),
		customFields: {
			connectorBridge: {
				provider: doc.provider,
				connectionId: doc._id,
				externalId: message.externalId,
				authorExternalId: message.authorExternalId,
				inbound: true,
			},
		},
	};

	await sendMessage(sender, rcMessage, room, { upsert: true });
	return true;
}

/** Resolve the bridge entry for a room on a loaded connection doc. */
function bridgeForRoom(doc: IExternalWorkspaceConnection, rid: string): IBridgedChannel | undefined {
	return doc.bridgedChannels?.find((b) => b.rid === rid);
}

/**
 * The OUTBOUND leg: mirror messages typed in a bridged room to the external channel.
 * Registered once at boot (see registerBridgeOutbound). NEVER throws — a bridge failure must not
 * break message saving; failures are logged and the message stays local.
 */
async function onMessageSaved(message: IMessage, room: IRoom | undefined): Promise<IMessage> {
	try {
		// Cheap gate: bridged rooms carry the `ext:` importIds tag — normal rooms exit with zero I/O.
		if (!room || !Array.isArray(room.importIds) || !room.importIds.some(isBridgeRoomImportId)) {
			return message;
		}
		// Loop guard: the bridge's own inbound inserts (deterministic `ext-` ids) never go back out.
		if (isBridgeMessageId(message._id)) {
			return message;
		}
		// v1 scope: new user text only — no edits, no system messages, no file-only messages.
		if (isEditedMessage(message) || message.t || !message.msg?.trim()) {
			return message;
		}

		const doc = await ExternalWorkspaceConnections.findOneByBridgedRoomId(room._id);
		const bridge = doc && bridgeForRoom(doc, room._id);
		if (!doc || !bridge) {
			return message;
		}
		if (doc.status !== 'connected') {
			SystemLogger.debug({ msg: 'Connector bridge outbound skipped: connection not active', connectionId: doc._id, status: doc.status });
			return message;
		}

		// DELEGATED model: only the connection owner can post as themselves (Graph cannot post as an
		// arbitrary user — spec §3.4). Anyone else's message stays local.
		if (message.u?._id !== doc.userId) {
			SystemLogger.debug({ msg: 'Connector bridge outbound skipped: author is not the connection owner', rid: room._id });
			return message;
		}

		const connection = toProviderConnection(doc);
		if (!connection) {
			SystemLogger.warn({ msg: 'Connector bridge outbound skipped: credentials unavailable', connectionId: doc._id });
			return message;
		}

		const provider = providerRegistry.get(doc.provider);

		// Build outbound message with optional thread reply: if this RC message replies to another,
		// look up the parent's external id and pass it as threadExternalId. Providers support
		// threading (e.g. Slack `thread_ts`, Teams `replyToId`); if parent has no external id,
		// post top-level as today.
		const outboundPayload: IOutboundMessage = { text: message.msg };
		if (message.tmid) {
			const parentMsg = await Messages.findOneById(message.tmid, {
				projection: { 'customFields.connectorBridge.externalId': 1 },
			});
			if (parentMsg?.customFields?.connectorBridge?.externalId) {
				outboundPayload.threadExternalId = parentMsg.customFields.connectorBridge.externalId;
			}
		}

		const { externalId } = await provider.postMessage(connection, bridge.channelExternalId, outboundPayload);

		// LOOP PREVENTION for the coming webhook echo of this very post:
		// leg 1 — remember the external id in-memory (fast path)…
		echoSuppression.add(doc._id, externalId);
		// …and leg 3 — stamp it on the RC message (persistent guard, survives restarts).
		await Messages.updateOne(
			{ _id: message._id },
			{
				$set: {
					'customFields.connectorBridge': {
						provider: doc.provider,
						connectionId: doc._id,
						externalId,
						inbound: false,
					},
				},
			},
		);
	} catch (err) {
		SystemLogger.error({ msg: 'Connector bridge outbound failed (message stays local)', rid: room?._id, err: String(err) });
	}
	return message;
}

/**
 * Shared outbound gates for edit/delete/reaction mirroring: bridged room, loaded doc+bridge,
 * active connection, readable credentials. Returns null (mirror nothing) on any miss.
 */
async function bridgedOutboundContext(room: IRoom | undefined): Promise<{
	doc: IExternalWorkspaceConnection;
	bridge: IBridgedChannel;
	connection: NonNullable<ReturnType<typeof toProviderConnection>>;
} | null> {
	if (!room || !Array.isArray(room.importIds) || !room.importIds.some(isBridgeRoomImportId)) {
		return null;
	}
	const doc = await ExternalWorkspaceConnections.findOneByBridgedRoomId(room._id);
	const bridge = doc && bridgeForRoom(doc, room._id);
	if (!doc || !bridge || doc.status !== 'connected') {
		return null;
	}
	const connection = toProviderConnection(doc);
	if (!connection) {
		return null;
	}
	return { doc, bridge, connection };
}

/** RC reaction (':thumbsup:', ':thumbsup_tone2:') → provider-native bare name ('thumbsup'). */
export function rcEmojiToProviderName(reaction: string): string {
	const bare = reaction.replace(/:/g, '');
	// Skin-tone variants don't round-trip cleanly (Slack uses '::skin-tone-N'); mirror the base emoji.
	return bare.replace(/_tone\d$/, '');
}

/**
 * Extended-sync gate (reactions + edits + deletes, the PR #75 additions). DEFAULT OFF, so the
 * bridge behaves like pre-#75 pure message mirroring unless an admin explicitly enables it. Read
 * best-effort — if settings aren't ready yet, stay OFF (safe default).
 */
export function extendedBridgeSyncEnabled(): boolean {
	try {
		return Boolean(settings.get('Slack_Bridge_Sync_Reactions'));
	} catch {
		return false;
	}
}

/**
 * OUTBOUND EDIT mirror: an owner-authored edit of a message the bridge posted out
 * (customFields.connectorBridge stamp with inbound:false) is mirrored via provider.updateMessage.
 * Bridge-INSERTED messages (`ext-…` ids) never reach here (guard in onMessageSaved), and inbound
 * never edits our outbound posts, so edit mirroring cannot loop.
 */
async function onMessageEdited(message: IMessage, room: IRoom | undefined): Promise<IMessage> {
	if (!extendedBridgeSyncEnabled()) {
		return message; // Extended sync off → edits stay local (pre-#75 behavior).
	}
	try {
		const ctx = await bridgedOutboundContext(room);
		if (message.u?._id !== ctx?.doc.userId) {
			return message;
		}
		const stamp = message.customFields?.connectorBridge;
		if (stamp?.inbound !== false || !stamp.externalId || !message.msg?.trim()) {
			return message;
		}
		const provider = providerRegistry.get(ctx.doc.provider);
		if (!provider.updateMessage) {
			return message;
		}
		await provider.updateMessage(ctx.connection, ctx.bridge.channelExternalId, stamp.externalId, message.msg);
	} catch (err) {
		SystemLogger.error({ msg: 'Connector bridge edit mirror failed (edit stays local)', rid: room?._id, err: String(err) });
	}
	return message;
}

/**
 * OUTBOUND DELETE mirror: deleting our own outbound post in RC deletes it in the external
 * channel too. Inbound-applied deletes target `ext-…` messages (no outbound stamp), so this
 * cannot loop either.
 */
async function onMessageDeleted(message: IMessage, room: IRoom | undefined): Promise<void> {
	if (!extendedBridgeSyncEnabled()) {
		return; // Extended sync off → deletes stay local (pre-#75 behavior).
	}
	try {
		if (isBridgeMessageId(message._id)) {
			return;
		}
		const ctx = await bridgedOutboundContext(room);
		if (message.u?._id !== ctx?.doc.userId) {
			return;
		}
		const stamp = message.customFields?.connectorBridge;
		if (stamp?.inbound !== false || !stamp.externalId) {
			return;
		}
		const provider = providerRegistry.get(ctx.doc.provider);
		if (!provider.deleteMessage) {
			return;
		}
		await provider.deleteMessage(ctx.connection, ctx.bridge.channelExternalId, stamp.externalId);
	} catch (err) {
		SystemLogger.error({ msg: 'Connector bridge delete mirror failed', rid: room?._id, err: String(err) });
	}
}

/**
 * OUTBOUND REACTION mirror: the connection OWNER's reaction on any stamped message (our outbound
 * posts AND bridge-inserted inbound ones) is mirrored via provider.setReaction.
 *
 * LOOP SAFETY: the inbound reaction path applies external reactions AS the owner, which fires
 * this very callback — it sets a reactionEcho `out:` key first, which we consume here and skip.
 * Our own mirror sets the `in:` key so the provider's resulting reaction event is dropped inbound.
 */
async function onReactionChanged(message: IMessage, user: IUser, reaction: string, add: boolean): Promise<void> {
	if (!extendedBridgeSyncEnabled()) {
		return; // Extended sync off → reactions are not mirrored out (pre-#75 behavior).
	}
	try {
		const room = await Rooms.findOneById(message.rid);
		const ctx = await bridgedOutboundContext(room ?? undefined);
		if (user._id !== ctx?.doc.userId) {
			return;
		}
		const stamp = message.customFields?.connectorBridge;
		if (!stamp?.externalId) {
			return;
		}
		const provider = providerRegistry.get(ctx.doc.provider);
		if (!provider.setReaction) {
			return;
		}
		const name = rcEmojiToProviderName(reaction);
		if (reactionEcho.has(ctx.doc._id, reactionEchoKey('out', stamp.externalId, name, add))) {
			return; // Inbound-applied reaction — do not mirror it straight back out.
		}
		// Drop the provider's coming event for this very mirror (defense; the apply-time no-op
		// guard in the inbound path catches it too).
		reactionEcho.add(ctx.doc._id, reactionEchoKey('in', stamp.externalId, name, add));
		await provider.setReaction(ctx.connection, ctx.bridge.channelExternalId, stamp.externalId, name, add);
	} catch (err) {
		SystemLogger.error({ msg: 'Connector bridge reaction mirror failed', mid: message._id, err: String(err) });
	}
}

/** Register the outbound bridge callbacks (idempotent; called once from the server entry). */
export function registerBridgeOutbound(): void {
	callbacks.add(
		'afterSaveMessage',
		(message: IMessage, { room }: { room: IRoom }) =>
			isEditedMessage(message) ? onMessageEdited(message, room) : onMessageSaved(message, room),
		callbacks.priority.LOW,
		CALLBACK_ID,
	);
	callbacks.add(
		'afterDeleteMessage',
		async (message: IMessage, { room }: { room: IRoom }) => {
			await onMessageDeleted(message, room);
			return message;
		},
		callbacks.priority.LOW,
		`${CALLBACK_ID}_Delete`,
	);
	callbacks.add(
		'afterSetReaction',
		async (message: IMessage, params: { user: IUser; reaction: string }) => {
			await onReactionChanged(message, params.user, params.reaction, true);
			return message;
		},
		callbacks.priority.LOW,
		`${CALLBACK_ID}_SetReaction`,
	);
	callbacks.add(
		'afterUnsetReaction',
		async (message: IMessage, params: { user: IUser; reaction: string }) => {
			await onReactionChanged(message, params.user, params.reaction, false);
			return message;
		},
		callbacks.priority.LOW,
		`${CALLBACK_ID}_UnsetReaction`,
	);
}
