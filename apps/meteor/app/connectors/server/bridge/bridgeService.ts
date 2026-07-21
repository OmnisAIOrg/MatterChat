/**
 * bridgeService — per-user lifecycle + subscription upkeep for live-bridged channels.
 *
 * The REST routes call the ownership-scoped functions (a user bridges/unbridges only their OWN
 * connections — same gating discipline as connectionService); the server entry calls
 * `startBridgeRuntime()` once at boot to (a) register the outbound callback, (b) reconcile Graph
 * subscriptions (recreate missing/expired, catch up missed messages), and (c) start the renewal
 * timer that PATCHes each subscription at ~T-12h (Graph chatMessage subscriptions live ≤3 days).
 *
 * SUBSCRIPTION LIFECYCLE (spec §3.3):
 *   bridge activation  → create subscription (webhook mode; fail-open to outbound-only when the
 *                        webhook prerequisites are missing, fail-SHARED when Graph already holds
 *                        the one-per-app+channel subscription for another connection)
 *   every 30 min       → renew subscriptions expiring within 12h; recreate the ones Graph dropped
 *   boot               → same reconcile + a `since=lastInboundAt` backfill to close downtime gaps
 *   lifecycle events   → webhook.ts calls back into renew/recreate/backfill (reauthorizationRequired,
 *                        subscriptionRemoved, missed)
 *   unbridge/disconnect→ delete the subscription (best-effort)
 */
import type { IBridgedChannel, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
import { ExternalWorkspaceConnections, Rooms, Users } from '@rocket.chat/models';

import { SystemLogger } from '../../../../server/lib/logger/system';
import type { IProviderConnection, IProviderMessage } from '../ChatProvider';
import { providerRegistry } from '../providerRegistry';
import { isSlackEventsConfigured } from '../providers/slack/config';
import { slackTsToEpochMs } from '../providers/slack/eventMessageMapping';
import { isTeamsWebhookConfigured } from '../providers/teams/config';
import type { GraphTokens, RefreshedTokens } from '../providers/teams/graphClient';
import { createChannelSubscription, deleteSubscription, renewSubscription } from '../providers/teams/subscriptions';
import { toProviderConnection } from '../runtimeConnection';
import { createBridgedRoom, ingestExternalMessage, registerBridgeOutbound } from './bridgeCore';
import { roomImportId } from './bridgeIds';
import { inboundChannelKindOf, recordAndPushInbound } from './inboundBrowse';

/** Renew any subscription with less runway than this (spec: renew at ~T-12h). */
const RENEW_BEFORE_MS = 12 * 60 * 60 * 1000;
/** Renewal sweep period. */
const RENEWAL_SWEEP_MS = 30 * 60 * 1000;
/** How many recent messages the activation backfill seeds the new room with. */
const ACTIVATION_BACKFILL_LIMIT = 25;

/** Poll-lane messages older than this never live-push (a long-dead bridge catching up must not buzz). */
const FRESH_PUSH_WINDOW_MS = 2 * 60 * 60 * 1000;

export type BridgeError = { error: string; message: string; status?: number };

/** Client-safe projection of one bridged channel. */
export type ClientBridge = {
	connectionId: string;
	provider: IExternalWorkspaceConnection['provider'];
	channelExternalId: string;
	/** The raw id the bridge was created from when it differed (Slack People user id) — client match aid. */
	sourceExternalId?: string;
	name: string;
	rid: string;
	/** `webhook` = own live subscription; `shared` = riding another connection's subscription; `none` = outbound-only. */
	realtime: 'webhook' | 'shared' | 'none';
	subscriptionExpiresAt?: Date;
};

function realtimeModeOf(doc: IExternalWorkspaceConnection, bridge: IBridgedChannel): ClientBridge['realtime'] {
	if (bridge.subscriptionId) {
		return 'webhook';
	}
	// No own subscription: with webhook mode on, this bridge rides another connection's subscription
	// for the same channel (fan-out); with webhook mode off it's outbound-only.
	if (doc.provider === 'teams' && isTeamsWebhookConfigured()) {
		return 'shared';
	}
	// Slack realtime is the APP-LEVEL Events API (/_slack/events): no per-channel subscription
	// exists — every bridge is live once the signing secret is configured, off (outbound + the
	// reconcile poll) when it isn't. This `realtime` value IS the admin-facing status surface.
	if (doc.provider === 'slack' && isSlackEventsConfigured()) {
		return 'webhook';
	}
	return 'none';
}

function toClientBridge(doc: IExternalWorkspaceConnection, bridge: IBridgedChannel): ClientBridge {
	return {
		connectionId: doc._id,
		provider: doc.provider,
		channelExternalId: bridge.channelExternalId,
		...(bridge.sourceExternalId ? { sourceExternalId: bridge.sourceExternalId } : {}),
		name: bridge.name,
		rid: bridge.rid,
		realtime: realtimeModeOf(doc, bridge),
		...(bridge.subscriptionExpiresAt ? { subscriptionExpiresAt: bridge.subscriptionExpiresAt } : {}),
	};
}

/** Build Graph tokens + refresh hook from a runtime connection (Teams subscription calls). */
function graphTokensFor(connection: IProviderConnection): {
	tokens: GraphTokens;
	onRefreshed?: (t: RefreshedTokens) => void | Promise<void>;
} {
	const tokens: GraphTokens = {
		accessToken: String(connection.credentials.accessToken || ''),
		refreshToken: typeof connection.credentials.refreshToken === 'string' ? connection.credentials.refreshToken : undefined,
		expiresAt: typeof connection.credentials.expiresAt === 'number' ? connection.credentials.expiresAt : undefined,
	};
	const { onCredentialsRefreshed } = connection;
	if (!onCredentialsRefreshed) {
		return { tokens };
	}
	return {
		tokens,
		onRefreshed: async (t: RefreshedTokens) => {
			try {
				await onCredentialsRefreshed({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt });
			} catch (err) {
				SystemLogger.warn({ msg: 'Bridge refreshed-token persistence failed (call continues)', err: String(err) });
			}
		},
	};
}

/**
 * Error strings that mean the stored token is DEAD (not a transient failure): the OAuth refresh
 * grant's `invalid_grant` (Teams/Google), plus Slack's auth-death codes — Slack has no refresh
 * grant, so a revoked/deactivated user token surfaces as `slack_error:invalid_auth` /
 * `token_revoked` / `account_inactive` on a regular Web API call. (Mirrored in connectionService.)
 */
const AUTH_DEATH_MARKERS = ['invalid_grant', 'invalid_auth', 'token_revoked', 'account_inactive'];

/** Token death (spec §3.7): flip the connection to `error` so the UI says "reconnect". */
async function markAuthDeath(doc: IExternalWorkspaceConnection, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	if (AUTH_DEATH_MARKERS.some((marker) => message.includes(marker))) {
		try {
			await ExternalWorkspaceConnections.setStatusById(doc._id, 'error');
			SystemLogger.warn({ msg: 'External connection token dead — marked error (reconnect required)', connectionId: doc._id });
		} catch {
			// Status write failed — the original error still tells the story.
		}
	}
}

/**
 * Backfill one bridge from the provider's history and ingest anything new (oldest-first so thread
 * roots exist before replies). `since` = the bridge's lastInboundAt (absent = seed the most recent
 * `limit` messages). Advances lastInboundAt to the newest ingested message. Used by activation,
 * boot reconcile, and the `missed` lifecycle event — this is what makes the bridge lossless.
 */
export async function backfillBridge(
	doc: IExternalWorkspaceConnection,
	bridge: IBridgedChannel,
	connection: IProviderConnection,
	ownerExternalId: string | undefined,
	limit = 200,
): Promise<number> {
	const provider = providerRegistry.get(doc.provider);
	const since = bridge.lastInboundAt ? bridge.lastInboundAt.toISOString() : undefined;

	// syncMessages yields newest-first; collect (bounded) then reverse to ingest oldest-first.
	const collected: IProviderMessage[] = [];
	for await (const message of provider.syncMessages(connection, bridge.channelExternalId, since)) {
		collected.push(message);
		if (collected.length >= limit) {
			break;
		}
	}
	collected.reverse();

	let ingested = 0;
	let newestMs = bridge.lastInboundAt?.getTime() ?? 0;
	for (const message of collected) {
		const inserted = await ingestExternalMessage(doc, bridge, message, ownerExternalId);
		if (inserted) {
			ingested++;
		}
		// `ts` is ISO-8601 (Teams/Google) OR a Slack "seconds.micros" ts — Date.parse yields NaN on
		// the latter, so fall back to the Slack epoch conversion. Without the fallback the cursor
		// never advances on Slack bridges and every sweep re-reads the full history window.
		const parsedMs = Date.parse(message.ts);
		const tsMs = Number.isNaN(parsedMs) ? slackTsToEpochMs(message.ts) : parsedMs;
		// Poll-lane browse + push: a NEWLY-ingested, recent message on an INCREMENTAL backfill
		// (cursor set — never the activation seed, which must not storm 200 notifications) also
		// feeds the `source:'inbound'` browse store and live-pushes. This is Google's only inbound
		// lane (no webhook) and the recovery lane for Teams/Slack missed windows. Idempotent with
		// the webhook lanes: they ingest first, so this `inserted` stays false for anything they
		// already delivered.
		if (inserted && since && tsMs !== undefined && Date.now() - tsMs < FRESH_PUSH_WINDOW_MS) {
			await recordAndPushInbound([{ doc, selfExternalId: ownerExternalId }], bridge.channelExternalId, message, {
				channelKind: inboundChannelKindOf(doc.provider, bridge.channelExternalId),
				tsMs,
			});
		}
		if (tsMs !== undefined && tsMs > newestMs) {
			newestMs = tsMs;
		}
	}
	if (newestMs > (bridge.lastInboundAt?.getTime() ?? 0)) {
		await ExternalWorkspaceConnections.setBridgedChannelLastInboundAt(doc._id, bridge.channelExternalId, new Date(newestMs));
	}
	return ingested;
}

/**
 * The owner's external user id captured at OAuth — inbound alias suppression for self.
 * Teams stores it as `externalAadUserId` (Entra oid), Slack as `externalSlackUserId` (U…).
 */
function ownerExternalIdOf(connection: IProviderConnection): string | undefined {
	const v = connection.credentials.externalAadUserId ?? connection.credentials.externalSlackUserId;
	return typeof v === 'string' && v ? v : undefined;
}

/**
 * Create (or refresh) the Graph subscription for one bridge, persisting the outcome. Returns the
 * realtime mode reached. Never throws for the "webhook not configured" case — that's the
 * documented outbound-only degradation.
 */
async function ensureSubscription(
	doc: IExternalWorkspaceConnection,
	bridge: IBridgedChannel,
	connection: IProviderConnection,
): Promise<'webhook' | 'shared' | 'none'> {
	// SLACK: realtime is the APP-LEVEL Events API — there is no per-channel subscription to create
	// (the app's event subscription covers every visible channel), so "activating" inbound is just
	// the bridge record itself. Fail-closed + graceful: with no signing secret, inbound stays off
	// (outbound + the reconcile poll keep working) and the admin-facing status is 'none'.
	if (doc.provider === 'slack') {
		if (isSlackEventsConfigured()) {
			return 'webhook';
		}
		SystemLogger.warn({
			msg: 'Slack inbound realtime is OFF — signing secret unset (set Slack_Signing_Secret in admin or SLACK_SIGNING_SECRET env). Bridge stays outbound-only + reconcile poll.',
			connectionId: doc._id,
			channelExternalId: bridge.channelExternalId,
		});
		return 'none';
	}
	if (doc.provider !== 'teams' || !isTeamsWebhookConfigured()) {
		return 'none';
	}
	const { tokens, onRefreshed } = graphTokensFor(connection);
	try {
		const created = await createChannelSubscription(tokens, doc._id, bridge.channelExternalId, onRefreshed);
		if (created.shared) {
			await ExternalWorkspaceConnections.setBridgedChannelSubscription(doc._id, bridge.channelExternalId, undefined, undefined);
			return 'shared';
		}
		await ExternalWorkspaceConnections.setBridgedChannelSubscription(
			doc._id,
			bridge.channelExternalId,
			created.subscriptionId,
			created.expiresAt,
		);
		return 'webhook';
	} catch (err) {
		await markAuthDeath(doc, err);
		SystemLogger.warn({
			msg: 'Teams subscription create failed — bridge stays outbound-only until reconciled',
			connectionId: doc._id,
			channelExternalId: bridge.channelExternalId,
			err: String(err),
		});
		return 'none';
	}
}

/**
 * Bridge one external channel into a new MatterChat room for the calling user.
 * Ownership-scoped; idempotent per (connection, channel) — re-bridging returns the existing bridge.
 */
export async function bridgeMyChannel(
	userId: string,
	opts: { connectionId: string; channelExternalId: string; name?: string },
): Promise<{ bridge: ClientBridge } | BridgeError> {
	const doc = await ExternalWorkspaceConnections.findOneByIdAndUserId(opts.connectionId, userId);
	if (!doc) {
		return { error: 'connection_not_found', message: 'No connected workspace found for this account.', status: 404 };
	}
	if (doc.status !== 'connected') {
		return { error: `connection_${doc.status}`, message: 'This connection is not active — reconnect the workspace and try again.' };
	}

	const connection = toProviderConnection(doc);
	if (!connection) {
		return { error: 'credentials_unavailable', message: 'Stored credentials could not be read — reconnect the workspace.', status: 401 };
	}

	// Canonicalize BEFORE persisting: a Slack People-directory selection carries a USER id, but
	// inbound events address the CONVERSATION id — a bridge keyed by the user id silently receives
	// nothing (outbound worked, inbound never matched the fan-out). Best-effort: an unresolvable id
	// falls through unchanged rather than blocking the bridge.
	let channelExternalId = opts.channelExternalId;
	try {
		const provider = providerRegistry.get(doc.provider);
		channelExternalId = (await provider.resolveBridgeChannelId?.(connection, opts.channelExternalId)) ?? opts.channelExternalId;
	} catch (err) {
		SystemLogger.warn({ msg: 'Bridge channel-id resolution failed — bridging the raw id', connectionId: doc._id, err: String(err) });
	}

	// Match on BOTH ids so a pre-fix bridge keyed by the raw user id is found rather than duplicated.
	const existing = doc.bridgedChannels?.find((b) => b.channelExternalId === channelExternalId || b.channelExternalId === opts.channelExternalId);
	if (existing) {
		return { bridge: toClientBridge(doc, existing) };
	}

	const owner = await Users.findOneById(userId);
	if (!owner) {
		return { error: 'user_not_found', message: 'Owner user not found.', status: 404 };
	}

	const label = opts.name?.trim() || channelExternalId;
	const room = await createBridgedRoom(owner, doc, channelExternalId, label);

	const bridge: IBridgedChannel = {
		channelExternalId,
		// Keep the raw pre-resolution id when it differed (Slack user id → im id) so the client can
		// match this bridge back to the People-row selection that created it.
		...(channelExternalId !== opts.channelExternalId ? { sourceExternalId: opts.channelExternalId } : {}),
		name: label,
		rid: room._id,
		createdAt: new Date(),
	};
	await ExternalWorkspaceConnections.addBridgedChannel(doc._id, bridge);

	// Realtime: create the Graph subscription (webhook mode). Degrades to shared / outbound-only.
	const realtime = await ensureSubscription(doc, bridge, connection);

	// Seed the room with the channel's recent history (also sets the lastInboundAt cursor).
	try {
		await backfillBridge(doc, bridge, connection, ownerExternalIdOf(connection), ACTIVATION_BACKFILL_LIMIT);
	} catch (err) {
		await markAuthDeath(doc, err);
		SystemLogger.warn({ msg: 'Bridge activation backfill failed (bridge stays active)', connectionId: doc._id, err: String(err) });
	}

	const fresh = await ExternalWorkspaceConnections.findOneByIdAndUserId(doc._id, userId);
	const freshBridge = fresh?.bridgedChannels?.find((b) => b.channelExternalId === channelExternalId);
	return { bridge: freshBridge && fresh ? toClientBridge(fresh, freshBridge) : { ...toClientBridge(doc, bridge), realtime } };
}

/**
 * Tear down one of the caller's own bridges: delete the Graph subscription (best-effort), remove
 * the bridge record, and strip the room's bridge tag (the room + its history stay, but stop
 * mirroring in either direction).
 */
export async function unbridgeMyChannel(
	userId: string,
	opts: { connectionId: string; channelExternalId: string },
): Promise<{ removed: true } | BridgeError> {
	const doc = await ExternalWorkspaceConnections.findOneByIdAndUserId(opts.connectionId, userId);
	if (!doc) {
		return { error: 'connection_not_found', message: 'No connected workspace found for this account.', status: 404 };
	}
	// Match canonical OR source id — the client may hand back the People-row user id it selected by,
	// while the record is keyed by the resolved conversation id (see bridgeMyChannel).
	const bridge = doc.bridgedChannels?.find(
		(b) => b.channelExternalId === opts.channelExternalId || b.sourceExternalId === opts.channelExternalId,
	);
	if (!bridge) {
		return { error: 'bridge_not_found', message: 'This channel is not bridged on that connection.', status: 404 };
	}

	if (bridge.subscriptionId) {
		const connection = toProviderConnection(doc);
		if (connection) {
			const { tokens, onRefreshed } = graphTokensFor(connection);
			try {
				await deleteSubscription(tokens, bridge.subscriptionId, onRefreshed);
			} catch (err) {
				SystemLogger.warn({ msg: 'Teams subscription delete failed (bridge removed anyway)', connectionId: doc._id, err: String(err) });
			}
		}
	}

	// Remove by the record's CANONICAL id (opts may carry the source/user id — see the match above).
	await ExternalWorkspaceConnections.removeBridgedChannel(doc._id, bridge.channelExternalId);
	// Strip the room tag so the outbound callback's cheap gate stops matching this room.
	await Rooms.updateOne({ _id: bridge.rid }, { $pull: { importIds: roomImportId(doc._id, bridge.channelExternalId) } });
	return { removed: true };
}

/** List all of the caller's own bridges across their connections. */
export async function listMyBridges(userId: string): Promise<ClientBridge[]> {
	const docs = await ExternalWorkspaceConnections.findByUserId(userId).toArray();
	const out: ClientBridge[] = [];
	for (const doc of docs) {
		for (const bridge of doc.bridgedChannels || []) {
			out.push(toClientBridge(doc, bridge));
		}
	}
	return out;
}

// NOTE: full-connection subscription teardown lives in TeamsProvider.disconnect (provider-pure:
// it lists the app+user's Graph subscriptions by our notificationUrl and deletes them), invoked
// with real credentials by connectionService.disconnectMyConnection.

// ─── boot reconcile + renewal timer ────────────────────────────────────────────────────────────

let runtimeStarted = false;
let sweepRunning = false;

/** The providers the reconcile sweep covers (the ones with an inbound realtime/poll loop). */
const RECONCILED_PROVIDERS = new Set<IExternalWorkspaceConnection['provider']>(['teams', 'slack', 'google']);

/**
 * One reconcile pass over every Teams, Slack AND Google connection with bridges:
 *  - Teams: subscription missing (never created / previously shared / dropped) → try to create;
 *    subscription expiring within RENEW_BEFORE_MS → renew (recreate on 404);
 *  - all: a `since=lastInboundAt` backfill so downtime/missed windows are closed — for Slack this
 *    poll is ALSO the graceful degradation when the Events API signing secret is unset, and for
 *    Google (which has no per-space push at all yet) it IS the inbound transport (inbound arrives
 *    on the reconcile cadence instead of realtime).
 */
export async function reconcileBridges(): Promise<void> {
	if (sweepRunning) {
		return;
	}
	sweepRunning = true;
	try {
		const docs = await ExternalWorkspaceConnections.findAllWithBridges().toArray();
		for (const doc of docs) {
			if (doc.status !== 'connected' || !RECONCILED_PROVIDERS.has(doc.provider)) {
				continue;
			}
			const connection = toProviderConnection(doc);
			if (!connection) {
				continue;
			}
			const ownerExternalId = ownerExternalIdOf(connection);
			for (const bridge of doc.bridgedChannels || []) {
				try {
					if (doc.provider === 'teams' && isTeamsWebhookConfigured()) {
						if (!bridge.subscriptionId) {
							await ensureSubscription(doc, bridge, connection);
						} else if (!bridge.subscriptionExpiresAt || bridge.subscriptionExpiresAt.getTime() - Date.now() < RENEW_BEFORE_MS) {
							const { tokens, onRefreshed } = graphTokensFor(connection);
							try {
								const expiresAt = await renewSubscription(tokens, bridge.subscriptionId, onRefreshed);
								await ExternalWorkspaceConnections.setBridgedChannelSubscription(
									doc._id,
									bridge.channelExternalId,
									bridge.subscriptionId,
									expiresAt,
								);
							} catch (err) {
								// Gone on Graph's side (expired / removed) → recreate from scratch.
								if ((err as { status?: number })?.status === 404) {
									await ExternalWorkspaceConnections.setBridgedChannelSubscription(doc._id, bridge.channelExternalId, undefined, undefined);
									await ensureSubscription(doc, { ...bridge, subscriptionId: undefined }, connection);
								} else {
									throw err;
								}
							}
						}
					}
					// Close any gap regardless of subscription state (webhook-off deployments get their
					// inbound this way too — a coarse poll on the reconcile cadence).
					await backfillBridge(doc, bridge, connection, ownerExternalId);
				} catch (err) {
					await markAuthDeath(doc, err);
					SystemLogger.warn({
						msg: 'Bridge reconcile failed for channel (will retry next sweep)',
						connectionId: doc._id,
						channelExternalId: bridge.channelExternalId,
						err: String(err),
					});
				}
			}
		}
	} finally {
		sweepRunning = false;
	}
}

/**
 * Boot entry: register the outbound callback and start the reconcile/renewal loop. Idempotent.
 * The first reconcile is deferred a few seconds so boot never blocks on Graph.
 */
export function startBridgeRuntime(): void {
	if (runtimeStarted) {
		return;
	}
	runtimeStarted = true;

	registerBridgeOutbound();

	setTimeout(() => {
		void reconcileBridges().catch((err) => SystemLogger.error({ msg: 'Bridge boot reconcile failed', err: String(err) }));
	}, 15_000);

	setInterval(() => {
		void reconcileBridges().catch((err) => SystemLogger.error({ msg: 'Bridge renewal sweep failed', err: String(err) }));
	}, RENEWAL_SWEEP_MS);
}
