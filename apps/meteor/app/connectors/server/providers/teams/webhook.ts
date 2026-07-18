/**
 * Microsoft Graph change-notification webhook for the Teams live message bridge.
 *
 * Mounted OUTSIDE /api (RC's REST/Apps router owns `/api/*` and 404s custom connect-handlers —
 * mirrors the `/_crossfirm` / `/_teams/oauth` mounting precedent):
 *
 *   POST /_connectors/teams/webhook    → message change notifications
 *   POST /_connectors/teams/lifecycle  → subscription lifecycle events
 *
 * SECURITY MODEL (the endpoint is public + unauthenticated by Graph's requirement):
 *  1. VALIDATION HANDSHAKE — a POST carrying `?validationToken=` is Graph validating the endpoint
 *     at subscription create/renew: reply 200 with the token as text/plain within 10s. This is the
 *     ONLY request answered without verification, and it triggers no processing.
 *  2. FAIL-CLOSED clientState — every notification item must carry the HMAC clientState derived
 *     from the deploy secret + the (connectionId, channelExternalId) of the subscription it claims
 *     (constant-time compare). No secret configured → nothing verifies → nothing processed.
 *     The subscription is resolved by subscriptionId from OUR OWN Mongo record; an attacker who
 *     invents a subscriptionId matches nothing, and one who replays a real subscriptionId still
 *     needs the HMAC.
 *  3. RAW-BODY AWARE, BOUNDED — the handler reads the raw request stream itself (1 MB cap,
 *     JSON.parse in a try) and never trusts field shapes (extractNotifications drops malformed
 *     items).
 *  4. 202 FAST, PROCESS ASYNC — Graph retries non-2xx with backoff then DROPS; we ack immediately
 *     and do the Graph fetch + RC insert on setImmediate. Invalid/unverifiable items are dropped
 *     silently (202 regardless) so a probe can't turn the endpoint into a retry amplifier.
 *  5. NOTHING FROM THE PAYLOAD IS TRUSTED FOR CONTENT — `includeResourceData` is false; the
 *     payload only tells us WHICH message changed; the actual message is fetched from Graph with
 *     the connection owner's delegated token, and the parsed resource must MATCH the bridged
 *     channel recorded on the subscription (defense-in-depth).
 *
 * Clean-room: written from the Microsoft Graph change-notifications docs; nothing under
 * apps/meteor/ee/ was read or copied.
 */
import type { IBridgedChannel, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
import { ExternalWorkspaceConnections, Messages, Users } from '@rocket.chat/models';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { GRAPH_BASE, TEAMS_WEBHOOK_ROUTE_PREFIX, webhookClientStateSecret } from './config';
import type { GraphTokens } from './graphClient';
import { graphFetch } from './graphClient';
import type { GraphChatMessage } from './messageMapping';
import { mapGraphMessage } from './messageMapping';
import type { IncomingLifecycleEvent, IncomingNotification, ParsedNotificationResource } from './webhookSecurity';
import { extractLifecycleEvents, extractNotifications, parseNotificationResource, verifyClientState } from './webhookSecurity';
import { SystemLogger } from '../../../../../server/lib/logger/system';
import { deleteMessage } from '../../../../lib/server/functions/deleteMessage';
import { updateMessage } from '../../../../lib/server/functions/updateMessage';
import { ingestExternalMessage } from '../../bridge/bridgeCore';
import { extMessageId } from '../../bridge/bridgeIds';
import { backfillBridge, reconcileBridges } from '../../bridge/bridgeService';
import { toProviderConnection } from '../../runtimeConnection';

/** Bound the raw request body (Graph notification batches are a few KB; 1 MB is generous). */
const MAX_BODY_BYTES = 1024 * 1024;

/** Read the raw request stream, bounded. Resolves null when the cap is exceeded. */
function readRawBody(req: any): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let total = 0;
		let overflowed = false;
		req.on('data', (chunk: Buffer) => {
			total += chunk.length;
			if (total > MAX_BODY_BYTES) {
				overflowed = true;
				chunks.length = 0;
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(overflowed ? null : Buffer.concat(chunks)));
		req.on('error', () => resolve(null));
	});
}

/** 200 + the validationToken as text/plain — the Graph endpoint-validation handshake. */
function answerValidationHandshake(res: any, validationToken: string): void {
	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end(validationToken);
}

/** Ack fast (Graph wants 2xx quickly; retries then drops otherwise). */
function accepted(res: any): void {
	res.writeHead(202);
	res.end();
}

/** Locate the (connection, bridge) our own records hold for a subscriptionId. */
async function resolveSubscription(subscriptionId: string): Promise<{ doc: IExternalWorkspaceConnection; bridge: IBridgedChannel } | null> {
	const doc = await ExternalWorkspaceConnections.findOneByBridgedSubscriptionId(subscriptionId);
	const bridge = doc?.bridgedChannels?.find((b) => b.subscriptionId === subscriptionId);
	return doc && bridge ? { doc, bridge } : null;
}

/** The channel token a parsed notification resource addresses (matches bridge.channelExternalId). */
function channelTokenOf(parsed: ParsedNotificationResource): string {
	return parsed.kind === 'channelMessage' ? `${parsed.teamId}|${parsed.channelId}` : parsed.chatId;
}

/** The Graph URL of the ONE message a parsed resource points at (reply-aware). */
function messageUrlOf(parsed: ParsedNotificationResource): string {
	if (parsed.kind === 'chatMessage') {
		return `${GRAPH_BASE}/chats/${encodeURIComponent(parsed.chatId)}/messages/${encodeURIComponent(parsed.messageId)}`;
	}
	const base = `${GRAPH_BASE}/teams/${encodeURIComponent(parsed.teamId)}/channels/${encodeURIComponent(parsed.channelId)}/messages/${encodeURIComponent(parsed.messageId)}`;
	return parsed.replyId ? `${base}/replies/${encodeURIComponent(parsed.replyId)}` : base;
}

/** Build Graph tokens + persistence hook from a runtime connection. */
function graphTokensFor(connection: NonNullable<ReturnType<typeof toProviderConnection>>): {
	tokens: GraphTokens;
	onRefreshed?: (t: { accessToken: string; refreshToken?: string; expiresAt?: number }) => void | Promise<void>;
} {
	const tokens: GraphTokens = {
		accessToken: String(connection.credentials.accessToken || ''),
		refreshToken: typeof connection.credentials.refreshToken === 'string' ? connection.credentials.refreshToken : undefined,
		expiresAt: typeof connection.credentials.expiresAt === 'number' ? connection.credentials.expiresAt : undefined,
	};
	const { onCredentialsRefreshed } = connection;
	return {
		tokens,
		...(onCredentialsRefreshed
			? {
					onRefreshed: async (t: { accessToken: string; refreshToken?: string; expiresAt?: number }) => {
						try {
							await onCredentialsRefreshed({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt });
						} catch (err) {
							SystemLogger.warn({ msg: 'Teams webhook refreshed-token persistence failed', err: String(err) });
						}
					},
				}
			: {}),
	};
}

/**
 * Process ONE verified message notification: fetch the full message from Graph with the owner's
 * delegated token, map it, ingest it into the subscription owner's room, then FAN OUT to every
 * other connection bridging the same external channel of the same tenant (Graph allows one
 * subscription per app+channel, so this one delivery serves all of them).
 */
/**
 * Apply an EDIT of a bridge-inserted message (deterministic `ext-…` _id) for one connection.
 * Same ownership rule as the Slack path: only messages the bridge itself inserted are edited —
 * a Teams-side edit of our own outbound post stays local (documented gap, symmetric with Slack).
 * Not-yet-ingested messages (created while inbound was off) ingest the edited form as new.
 */
async function applyTeamsEdit(
	doc: IExternalWorkspaceConnection,
	bridge: IBridgedChannel,
	mapped: NonNullable<ReturnType<typeof mapGraphMessage>>,
	ownerExternalId: string | undefined,
): Promise<void> {
	const rcId = extMessageId(doc._id, bridge.channelExternalId, mapped.externalId);
	const existing = await Messages.findOneById(rcId);
	if (!existing) {
		await ingestExternalMessage(doc, bridge, mapped, ownerExternalId);
		return;
	}
	if (existing.msg === mapped.text) {
		return; // No visible change — skip the write.
	}
	const owner = await Users.findOneById(doc.userId);
	if (!owner) {
		return;
	}
	await updateMessage({ _id: existing._id, rid: existing.rid, msg: mapped.text, customFields: existing.customFields ?? {} }, owner, existing);
}

/** Apply a DELETE (Graph soft-delete: deletedDateTime set) of a bridge-inserted message. */
async function applyTeamsDelete(doc: IExternalWorkspaceConnection, bridge: IBridgedChannel, externalMessageId: string): Promise<void> {
	const rcId = extMessageId(doc._id, bridge.channelExternalId, externalMessageId);
	const existing = await Messages.findOneById(rcId);
	if (!existing) {
		return;
	}
	const owner = await Users.findOneById(doc.userId);
	if (!owner) {
		return;
	}
	await deleteMessage(existing, owner);
}

async function processNotification(item: IncomingNotification, parsed: ParsedNotificationResource): Promise<void> {
	const resolved = await resolveSubscription(item.subscriptionId);
	if (!resolved) {
		return;
	}
	const { doc, bridge } = resolved;

	// created + updated carry a fetchable message; Graph deletes arrive as 'updated'/'deleted'
	// with `deletedDateTime` set on the fetched message (handled below).
	if (item.changeType !== 'created' && item.changeType !== 'updated' && item.changeType !== 'deleted') {
		return;
	}

	const connection = toProviderConnection(doc);
	if (!connection) {
		SystemLogger.warn({ msg: 'Teams webhook: credentials unavailable for subscription owner', connectionId: doc._id });
		return;
	}

	const { tokens, onRefreshed } = graphTokensFor(connection);
	const graphMessage = await graphFetch<GraphChatMessage>(messageUrlOf(parsed), tokens, {}, onRefreshed);

	// ── DELETE: soft-deleted messages carry deletedDateTime (mapGraphMessage maps them to null) ──
	if (graphMessage?.id && graphMessage.deletedDateTime) {
		const externalMessageId = String(graphMessage.id);
		await applyTeamsDelete(doc, bridge, externalMessageId);
		const delSharers = await ExternalWorkspaceConnections.findByBridgedChannel('teams', doc.externalOrgId, bridge.channelExternalId).toArray();
		for (const sharer of delSharers) {
			if (sharer._id === doc._id) {
				continue;
			}
			const sharerBridge = sharer.bridgedChannels?.find((b) => b.channelExternalId === bridge.channelExternalId);
			if (!sharerBridge) {
				continue;
			}
			try {
				await applyTeamsDelete(sharer, sharerBridge, externalMessageId);
			} catch (err) {
				SystemLogger.warn({ msg: 'Teams webhook fan-out delete failed', connectionId: sharer._id, err: String(err) });
			}
		}
		return;
	}

	const mapped = mapGraphMessage(graphMessage, bridge.channelExternalId);
	if (!mapped) {
		// System/authorless message — nothing to mirror.
		return;
	}

	const ownerExternalId =
		typeof connection.credentials.externalAadUserId === 'string' ? connection.credentials.externalAadUserId : undefined;

	// ── EDIT: 'updated' applies to the already-ingested `ext-…` message (was: fetched + dropped) ──
	if (item.changeType === 'updated') {
		await applyTeamsEdit(doc, bridge, mapped, ownerExternalId);
		const editSharers = await ExternalWorkspaceConnections.findByBridgedChannel('teams', doc.externalOrgId, bridge.channelExternalId).toArray();
		for (const sharer of editSharers) {
			if (sharer._id === doc._id) {
				continue;
			}
			const sharerBridge = sharer.bridgedChannels?.find((b) => b.channelExternalId === bridge.channelExternalId);
			if (!sharerBridge) {
				continue;
			}
			const sharerConnection = toProviderConnection(sharer);
			const sharerExternalId =
				sharerConnection && typeof sharerConnection.credentials.externalAadUserId === 'string'
					? sharerConnection.credentials.externalAadUserId
					: undefined;
			try {
				await applyTeamsEdit(sharer, sharerBridge, mapped, sharerExternalId);
			} catch (err) {
				SystemLogger.warn({ msg: 'Teams webhook fan-out edit failed', connectionId: sharer._id, err: String(err) });
			}
		}
		return;
	}

	// Subscription owner's room first…
	const inserted = await ingestExternalMessage(doc, bridge, mapped, ownerExternalId);
	const tsMs = Date.parse(mapped.ts);
	if (inserted && !Number.isNaN(tsMs)) {
		await ExternalWorkspaceConnections.setBridgedChannelLastInboundAt(doc._id, bridge.channelExternalId, new Date(tsMs));
	}

	// …then every other connection sharing this channel (their bridges have no own subscription).
	const sharers = await ExternalWorkspaceConnections.findByBridgedChannel('teams', doc.externalOrgId, bridge.channelExternalId).toArray();
	for (const sharer of sharers) {
		if (sharer._id === doc._id) {
			continue;
		}
		const sharerBridge = sharer.bridgedChannels?.find((b) => b.channelExternalId === bridge.channelExternalId);
		if (!sharerBridge) {
			continue;
		}
		// Alias suppression needs the sharer's OWN external id; creds may be undecryptable — degrade
		// to always-alias rather than dropping the message.
		const sharerConnection = toProviderConnection(sharer);
		const sharerExternalId =
			sharerConnection && typeof sharerConnection.credentials.externalAadUserId === 'string'
				? sharerConnection.credentials.externalAadUserId
				: undefined;
		try {
			const sharerInserted = await ingestExternalMessage(sharer, sharerBridge, mapped, sharerExternalId);
			if (sharerInserted && !Number.isNaN(tsMs)) {
				await ExternalWorkspaceConnections.setBridgedChannelLastInboundAt(sharer._id, sharerBridge.channelExternalId, new Date(tsMs));
			}
		} catch (err) {
			SystemLogger.warn({ msg: 'Teams webhook fan-out ingest failed', connectionId: sharer._id, err: String(err) });
		}
	}
}

/** Verify one notification item end-to-end (subscription known + clientState HMAC + resource shape). */
async function verifyNotification(item: IncomingNotification, secret: string): Promise<{ parsed: ParsedNotificationResource } | null> {
	const resolved = await resolveSubscription(item.subscriptionId);
	if (!resolved) {
		return null;
	}
	const { doc, bridge } = resolved;
	if (!verifyClientState(secret, item.clientState, doc._id, bridge.channelExternalId)) {
		SystemLogger.warn({ msg: 'Teams webhook: clientState mismatch — dropping notification', subscriptionId: item.subscriptionId });
		return null;
	}
	const parsed = parseNotificationResource(item.resource);
	if (!parsed) {
		return null;
	}
	// Defense-in-depth: the resource must address the channel this subscription was created for.
	if (channelTokenOf(parsed) !== bridge.channelExternalId) {
		SystemLogger.warn({ msg: 'Teams webhook: resource/channel mismatch — dropping notification', subscriptionId: item.subscriptionId });
		return null;
	}
	return { parsed };
}

async function handleNotifications(req: any, res: any, url: URL): Promise<void> {
	// 1. Endpoint-validation handshake: echo the token, text/plain, 200 — and nothing else.
	const validationToken = url.searchParams.get('validationToken');
	if (validationToken) {
		return answerValidationHandshake(res, validationToken);
	}

	// FAIL-CLOSED: without the deploy secret nothing can verify, so nothing is processed.
	const secret = webhookClientStateSecret();
	if (!secret) {
		return accepted(res);
	}

	const raw = await readRawBody(req);
	if (!raw?.length) {
		return accepted(res);
	}
	let body: unknown;
	try {
		body = JSON.parse(raw.toString('utf8'));
	} catch {
		return accepted(res);
	}
	const items = extractNotifications(body);

	// 2. Ack FIRST (202), process async — Graph drops the subscription's deliveries on slow/5xx.
	accepted(res);

	setImmediate(() => {
		void (async () => {
			for (const item of items) {
				try {
					const verified = await verifyNotification(item, secret);
					if (!verified) {
						continue;
					}
					await processNotification(item, verified.parsed);
				} catch (err) {
					SystemLogger.error({
						msg: 'Teams webhook notification processing failed',
						subscriptionId: item.subscriptionId,
						err: String(err),
					});
				}
			}
		})();
	});
}

/**
 * Lifecycle events (mandatory endpoint for >1h subscriptions — spec §3.3):
 *  - `reauthorizationRequired` → renew/recreate via a reconcile pass;
 *  - `subscriptionRemoved`     → clear the dead id so reconcile recreates it, then backfill;
 *  - `missed`                  → Graph dropped deliveries → catch-up backfill from lastInboundAt
 *                                (this is what makes the bridge lossless).
 */
async function processLifecycleEvent(event: IncomingLifecycleEvent, secret: string): Promise<void> {
	const resolved = await resolveSubscription(event.subscriptionId);
	if (!resolved) {
		return;
	}
	const { doc, bridge } = resolved;
	if (!verifyClientState(secret, event.clientState, doc._id, bridge.channelExternalId)) {
		SystemLogger.warn({ msg: 'Teams lifecycle: clientState mismatch — dropping event', subscriptionId: event.subscriptionId });
		return;
	}

	SystemLogger.info({ msg: 'Teams lifecycle event', lifecycleEvent: event.lifecycleEvent, subscriptionId: event.subscriptionId });

	if (event.lifecycleEvent === 'subscriptionRemoved') {
		// Clear the dead subscription so the reconcile pass recreates it (and backfills the gap).
		await ExternalWorkspaceConnections.setBridgedChannelSubscription(doc._id, bridge.channelExternalId, undefined, undefined);
		await reconcileBridges();
		return;
	}

	if (event.lifecycleEvent === 'missed') {
		const connection = toProviderConnection(doc);
		if (connection) {
			const ownerExternalId =
				typeof connection.credentials.externalAadUserId === 'string' ? connection.credentials.externalAadUserId : undefined;
			await backfillBridge(doc, bridge, connection, ownerExternalId);
		}
		return;
	}

	// reauthorizationRequired (and anything unrecognized): run a reconcile — it renews/recreates.
	await reconcileBridges();
}

async function handleLifecycle(req: any, res: any, url: URL): Promise<void> {
	const validationToken = url.searchParams.get('validationToken');
	if (validationToken) {
		return answerValidationHandshake(res, validationToken);
	}

	const secret = webhookClientStateSecret();
	if (!secret) {
		return accepted(res);
	}

	const raw = await readRawBody(req);
	if (!raw?.length) {
		return accepted(res);
	}
	let body: unknown;
	try {
		body = JSON.parse(raw.toString('utf8'));
	} catch {
		return accepted(res);
	}
	const events = extractLifecycleEvents(body);

	accepted(res);

	setImmediate(() => {
		void (async () => {
			for (const event of events) {
				try {
					await processLifecycleEvent(event, secret);
				} catch (err) {
					SystemLogger.error({ msg: 'Teams lifecycle processing failed', subscriptionId: event.subscriptionId, err: String(err) });
				}
			}
		})();
	});
}

// ─── mount ───────────────────────────────────────────────────────────────────────────────────

RoutePolicy.declare(`${TEAMS_WEBHOOK_ROUTE_PREFIX}/`, 'network');

WebApp.connectHandlers.use(TEAMS_WEBHOOK_ROUTE_PREFIX, async (req: any, res: any, next: () => void) => {
	try {
		// connect strips the mount prefix, so req.url here is '/webhook' | '/lifecycle' (+ query).
		const url = new URL(req.url, 'http://localhost');
		if (req.method === 'POST' && (url.pathname === '/webhook' || url.pathname.endsWith('/webhook'))) {
			return await handleNotifications(req, res, url);
		}
		if (req.method === 'POST' && (url.pathname === '/lifecycle' || url.pathname.endsWith('/lifecycle'))) {
			return await handleLifecycle(req, res, url);
		}
		return next();
	} catch (err) {
		SystemLogger.error({ msg: 'Teams webhook route error', err: String(err) });
		// Graph only needs a 2xx; internal failures are logged, never leaked.
		if (!res.headersSent) {
			res.writeHead(202);
		}
		res.end();
	}
});
