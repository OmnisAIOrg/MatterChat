/**
 * Microsoft Graph change-notification subscription CRUD for the Teams live message bridge.
 *
 * SPEAKS ONLY GRAPH — no Mongo (persistence of subscription ids/expiries on the connection doc is
 * the bridgeService's job). All calls run on the CONNECTION OWNER's delegated token via graphFetch
 * (proactive refresh + 401-refresh-once + 429 backoff), so subscriptions are created in the
 * EXTERNAL tenant under the user's own identity — delegated `ChannelMessage.Read.All` (channels) /
 * `Chat.Read` (chats), never app-only.
 *
 * Lifecycle facts designed around (spec §3.3, verified):
 *  - chatMessage subscriptions live at most 4,320 minutes (3 days) → we ask for ~2.9 days and the
 *    bridgeService renews at ~T-12h.
 *  - `lifecycleNotificationUrl` is MANDATORY for lifetimes > 1h — always sent.
 *  - ONE subscription per app+channel: a second bridge on the same external channel gets Graph's
 *    "already exists" error → surfaced as `{ shared: true }` so the caller records a shared bridge
 *    (inbound fan-out via findByBridgedChannel covers delivery for sharers).
 *  - `includeResourceData` is FALSE: notifications carry only ids; the webhook fetches the full
 *    message with the owner's delegated token. No RSA encryption certificate needed (deliberate —
 *    rich notifications are the documented fast-follow).
 *
 * Clean-room: written from the Microsoft Graph subscription docs; nothing under apps/meteor/ee/
 * was read or copied.
 */
import { GRAPH_BASE, webhookClientStateSecret, webhookLifecycleUrl, webhookNotificationUrl } from './config';
import type { GraphTokens, RefreshedTokens } from './graphClient';
import { graphFetch } from './graphClient';
import { deriveClientState } from './webhookSecurity';
import { SystemLogger } from '../../../../../server/lib/logger/system';

/** Ask for ~2.9 days (max is 4,320 min = 3 days for chatMessage resources); renew at ~T-12h. */
const SUBSCRIPTION_LIFETIME_MS = 4200 * 60 * 1000;

type OnRefreshed = (t: RefreshedTokens) => void | Promise<void>;

/** The `teamId|channelId` composite separator (same rule as TeamsProvider.encodeChannelId). */
const CHANNEL_ID_SEP = '|';

/**
 * The Graph resource path whose messages a bridge subscribes to. A composite `teamId|channelId`
 * (from listChannels) addresses a channel; a bare id (from listDirectChats) addresses a chat.
 */
export function subscriptionResource(channelExternalId: string): string {
	const idx = channelExternalId.indexOf(CHANNEL_ID_SEP);
	if (idx > 0 && idx < channelExternalId.length - 1) {
		const teamId = channelExternalId.slice(0, idx);
		const channelId = channelExternalId.slice(idx + 1);
		return `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`;
	}
	if (!channelExternalId) {
		throw new Error('teams_invalid_channel_id');
	}
	return `/chats/${encodeURIComponent(channelExternalId)}/messages`;
}

export type CreatedSubscription =
	| { shared: false; subscriptionId: string; expiresAt: Date }
	| {
			/** Graph already holds the one-per-app+channel subscription (another connection owns it). */
			shared: true;
	  };

/**
 * Create the change-notification subscription for one bridged channel. `changeType` is
 * `created,updated` — deletes are a documented v1 gap (the bridge does not remove RC messages).
 * clientState is DERIVED per (connectionId, channelExternalId) from the deploy secret, so the
 * webhook can verify it statelessly and fail closed.
 */
export async function createChannelSubscription(
	tokens: GraphTokens,
	connectionId: string,
	channelExternalId: string,
	onRefreshed?: OnRefreshed,
): Promise<CreatedSubscription> {
	const secret = webhookClientStateSecret();
	if (!secret) {
		throw new Error('teams_webhook_not_configured');
	}

	try {
		const created = await graphFetch<{ id?: string; expirationDateTime?: string }>(
			`${GRAPH_BASE}/subscriptions`,
			tokens,
			{
				method: 'POST',
				body: {
					changeType: 'created,updated',
					notificationUrl: webhookNotificationUrl(),
					lifecycleNotificationUrl: webhookLifecycleUrl(),
					resource: subscriptionResource(channelExternalId),
					includeResourceData: false,
					expirationDateTime: new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString(),
					clientState: deriveClientState(secret, connectionId, channelExternalId),
				},
			},
			onRefreshed,
		);
		if (!created?.id) {
			throw new Error('teams_subscription_no_id');
		}
		const expiresAt = created.expirationDateTime ? new Date(created.expirationDateTime) : new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS);
		return { shared: false, subscriptionId: created.id, expiresAt };
	} catch (err) {
		// ONE subscription per app+channel (spec §3.3): a second user bridging the SAME external
		// channel collides with the existing subscription. Graph answers 403/409 ExtensionError with
		// a "same resource / already exists" message — treat that as "shared", not a failure.
		const message = err instanceof Error ? err.message : String(err);
		const status = (err as { status?: number })?.status;
		if ((status === 403 || status === 409) && /same resource|already exists|maximum number of subscriptions/i.test(message)) {
			SystemLogger.info({ msg: 'Teams subscription already exists for channel — sharing it', connectionId, channelExternalId });
			return { shared: true };
		}
		throw err;
	}
}

/** Renew (PATCH) one subscription; returns the new expiry. Throws on failure (incl. 404 = gone). */
export async function renewSubscription(tokens: GraphTokens, subscriptionId: string, onRefreshed?: OnRefreshed): Promise<Date> {
	const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString();
	const renewed = await graphFetch<{ expirationDateTime?: string }>(
		`${GRAPH_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`,
		tokens,
		{ method: 'PATCH', body: { expirationDateTime } },
		onRefreshed,
	);
	return renewed?.expirationDateTime ? new Date(renewed.expirationDateTime) : new Date(expirationDateTime);
}

/** Delete one subscription. Best-effort semantics belong to the caller; a 404 is swallowed here. */
export async function deleteSubscription(tokens: GraphTokens, subscriptionId: string, onRefreshed?: OnRefreshed): Promise<void> {
	try {
		await graphFetch(`${GRAPH_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, tokens, { method: 'DELETE' }, onRefreshed);
	} catch (err) {
		if ((err as { status?: number })?.status === 404) {
			// Already gone (expired / removed by Graph) — the desired end state.
			return;
		}
		throw err;
	}
}
