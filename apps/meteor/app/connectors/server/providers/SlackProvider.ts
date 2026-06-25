/**
 * SlackProvider — Slack Web API implementation of IChatProvider (FIRST milestone: connect +
 * listChannels). PER-USER: each MatterChat user OAuth-connects their OWN Slack workspace and acts AS
 * themselves with a USER token (Slack OAuth v2, authed_user.access_token). Clean-room from the Slack
 * Web API docs — nothing under apps/meteor/ee/ was read or copied. Mirrors TeamsProvider.
 *
 * WHAT IS REAL in this milestone:
 *   - connect            → completes the Slack OAuth v2 code exchange (the same exchange the
 *                          /_slack/oauth/callback route runs) and returns usable credentials carrying
 *                          the USER token. Acts AS the signed-in user.
 *   - verifyCredentials  → calls auth.test (surfaces team id/name), resolves granted scopes.
 *   - listChannels       → GET conversations.list (public + private), cursor-paged via
 *                          response_metadata.next_cursor, mapped to IProviderChannel. REAL.
 *
 * WHAT IS A TODO STUB (the NEXT milestone — read/post/realtime):
 *   - syncMessages       → GET conversations.history (+ replies), paged via next_cursor.
 *   - subscribe          → Slack Events API / Socket Mode, keyed by (teamId, channelId).
 *   - postMessage        → POST chat.postMessage AS the user (chat:write user scope).
 *   - resolveIdentity    → GET users.info.
 *
 * STANDALONE-SAFE: every live method throws `slack_not_configured` when the connector is disabled or
 * no client secret is set, so a fresh MatterChat with Slack off has zero Slack behavior.
 *
 * Slack returns `{ ok:false, error }` on failure (HTTP 200) — slackApi surfaces it, never swallows.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import type {
	IChatProvider,
	InboundMessageHandler,
	IOutboundMessage,
	IProviderChannel,
	IProviderConnection,
	IProviderCredentials,
	IProviderMessage,
	IProviderOAuthInput,
	IProviderSubscription,
	IProviderUser,
	IVerifiedConnection,
} from '../ChatProvider';
import { getSlackConfig, isSlackConfigured, redirectUri, SLACK_TOKEN_ENDPOINT } from './slack/config';
import { slackFetch, slackFetchAll } from './slack/slackApi';

// Mounting the OAuth routes is a side-effect of importing this provider, so booting the connectors
// index (which constructs the registry with `new SlackProvider()`) also wires /_slack/oauth.
import './slack/routes';

const NEXT_MILESTONE =
	'SlackProvider: read/post/realtime is the next milestone (syncMessages/subscribe/postMessage). conversations.history / Events API / chat.postMessage.';

function notConfigured(): never {
	throw new Error('slack_not_configured');
}

/** Pull the USER token off stored credentials (Slack user tokens do not expire — no refresh). */
function tokenFromCredentials(credentials: IProviderCredentials): string {
	if (!credentials?.accessToken) {
		throw new Error('slack_missing_access_token');
	}
	return credentials.accessToken;
}

export class SlackProvider implements IChatProvider {
	readonly provider = 'slack' as const;

	// ─── auth / lifecycle ──────────────────────────────────────────────────────────────────────

	/**
	 * Complete the Slack OAuth v2 code exchange and return usable credentials carrying the USER token.
	 * The primary connect flow is the browser redirect handled by ./slack/routes.ts (which persists
	 * the connection itself); this method exists so the IChatProvider contract is honored and callers
	 * that already hold an auth code can complete the exchange programmatically.
	 */
	async connect(input: IProviderOAuthInput): Promise<IProviderCredentials> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		const { authCode } = input;
		if (!authCode) {
			throw new Error('slack_connect_requires_auth_code');
		}
		const config = getSlackConfig();

		const res = await fetch(SLACK_TOKEN_ENDPOINT, {
			ignoreSsrfValidation: true, // slack.com — a fixed Slack host, not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code: authCode,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: input.redirectUri || redirectUri(),
			}).toString(),
		});
		const tokens: any = await res.json().catch(() => ({}));
		// Slack returns HTTP 200 with ok:false on logical failure — check the envelope.
		if (!tokens?.ok) {
			throw new Error(`slack_token_exchange_failed:${tokens?.error || res.status}`);
		}

		const userToken = tokens?.authed_user?.access_token;
		if (!userToken) {
			throw new Error('slack_token_exchange_no_user_token');
		}

		return {
			accessToken: userToken,
			externalOrgId: tokens?.team?.id || '',
			externalSlackUserId: tokens?.authed_user?.id,
		};
	}

	/**
	 * Sanity-check credentials and resolve the external org id/name + granted scopes. Calls auth.test
	 * (returns team + team_id for the USER token). Returns `ok:false` rather than throwing so the
	 * caller can mark the connection `error`/`needs-reconnect` cleanly.
	 */
	async verifyCredentials(credentials: IProviderCredentials): Promise<IVerifiedConnection> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		const token = tokenFromCredentials(credentials);
		const config = getSlackConfig();
		try {
			const auth = await slackFetch<{ ok: boolean; team?: string; team_id?: string; url?: string }>(token, 'auth.test');
			const externalOrgId = auth.team_id || (typeof credentials.externalOrgId === 'string' ? credentials.externalOrgId : '') || '';
			const externalOrgName = auth.team || 'Slack';
			return {
				ok: Boolean(auth.ok && externalOrgId),
				externalOrgId,
				externalOrgName,
				scopes: config.userScopes,
			};
		} catch (err) {
			return { ok: false, externalOrgId: String(credentials.externalOrgId || ''), externalOrgName: '', scopes: [] };
		}
	}

	/**
	 * Tear down live resources for this connection. No sockets/subscriptions exist yet (realtime is the
	 * next milestone), so this is a no-op today — disconnect at the record level is handled by
	 * connectionService.
	 */
	async disconnect(_connection: IProviderConnection): Promise<void> {
		// No live Slack subscriptions to close until the realtime milestone; nothing to release.
	}

	// ─── discovery ─────────────────────────────────────────────────────────────────────────────

	/**
	 * List the channels visible to this connection's user: GET conversations.list with
	 * types=public_channel,private_channel & exclude_archived, cursor-paged via
	 * response_metadata.next_cursor, mapped to IProviderChannel.
	 *
	 * `isPrivate` comes from `is_private`; `topic` from `topic.value`. The provider does NOT qualify
	 * names with a team prefix (a Slack connection is a single workspace), so connectionService groups
	 * all channels under the connection's workspace name.
	 */
	async listChannels(connection: IProviderConnection): Promise<IProviderChannel[]> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		const token = tokenFromCredentials(connection.credentials);

		type SlackChannel = { id: string; name?: string; is_private?: boolean; is_archived?: boolean; topic?: { value?: string } };

		const channels = await slackFetchAll<SlackChannel>(token, 'conversations.list', 'channels', {
			types: 'public_channel,private_channel',
			exclude_archived: true,
			limit: 200,
		});

		const out: IProviderChannel[] = [];
		for (const ch of channels) {
			if (!ch?.id) {
				continue;
			}
			out.push({
				externalId: ch.id,
				name: ch.name || ch.id,
				isPrivate: Boolean(ch.is_private),
				topic: ch.topic?.value || undefined,
			});
		}
		return out;
	}

	// ─── sync (read) — NEXT MILESTONE ────────────────────────────────────────────────────────────

	// eslint-disable-next-line require-yield
	async *syncMessages(_connection: IProviderConnection, _channelExternalId: string, _since?: string): AsyncIterable<IProviderMessage> {
		// TODO(next milestone): GET conversations.history (+ conversations.replies for threads), paged
		// via response_metadata.next_cursor (oldest/latest cursors). Map Slack `ts` → externalId and
		// resolve the author from `user`. See the read milestone.
		throw new Error(NEXT_MILESTONE);
	}

	async subscribe(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_onMessage: InboundMessageHandler,
	): Promise<IProviderSubscription> {
		// TODO(next milestone): Slack Events API (or Socket Mode) keyed by (teamId, channelId); the
		// bridge maps each `message` event into Rocket.Chat. See the realtime milestone.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── identity — NEXT MILESTONE ───────────────────────────────────────────────────────────────

	async resolveIdentity(_connection: IProviderConnection, _externalUserId: string): Promise<IProviderUser | null> {
		// TODO(next milestone): GET users.info?user=<id> (users:read), map to IProviderUser.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── write — NEXT MILESTONE ──────────────────────────────────────────────────────────────────

	async postMessage(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_message: IOutboundMessage,
	): Promise<{ externalId: string }> {
		// TODO(next milestone): POST chat.postMessage AS the signed-in user (chat:write user scope),
		// channel=<externalId>, thread_ts for replies. See the write milestone.
		throw new Error(NEXT_MILESTONE);
	}
}
