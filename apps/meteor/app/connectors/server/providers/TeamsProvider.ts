/**
 * TeamsProvider — Microsoft Graph implementation of IChatProvider (FIRST milestone: connect +
 * listChannels). GREENFIELD on Microsoft Graph; clean-room from the Graph docs — nothing under
 * apps/meteor/ee/ was read or copied.
 *
 * WHAT IS REAL in this milestone:
 *   - connect            → completes the OAuth auth-code + PKCE exchange (the same exchange the
 *                          /api/apps/teamsbridge/oauth/callback route runs) and returns usable,
 *                          decrypted-shape credentials. DELEGATED scopes; acts AS the signed-in user.
 *   - verifyCredentials  → calls GET /me (refreshing the access token once if it 401s), resolves
 *                          the external tenant id/name + granted scopes.
 *   - listChannels       → GET /me/joinedTeams then GET /teams/{id}/channels, paged via
 *                          @odata.nextLink, mapped to IProviderChannel. REAL.
 *
 * WHAT IS A TODO STUB (the NEXT milestone — read/post/realtime):
 *   - syncMessages       → GET /teams/{id}/channels/{id}/messages (+ /replies), or /messages/delta.
 *   - subscribe          → Graph change-notifications (webhooks) keyed by (tenantId, channelId);
 *                          polling fallback on a per-connection toggle.
 *   - postMessage        → POST /teams/{id}/channels/{id}/messages, contentType html, AS the user.
 *   - resolveIdentity    → from the message `from.user` block (avoids User.ReadBasic.All).
 *
 * STANDALONE-SAFE: every live method throws `teams_not_configured` when the connector is disabled
 * or no client secret is set, so a fresh MatterChat with Teams off has zero Teams behavior.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3.
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
import { GRAPH_BASE, getTeamsConfig, isTeamsConfigured, tokenEndpoint, redirectUri, TEAMS_DELEGATED_SCOPES } from './teams/config';
import type { GraphTokens } from './teams/graphClient';
import { graphFetch, graphGetAll } from './teams/graphClient';

// Mounting the OAuth routes is a side-effect of importing this provider, so booting the connectors
// index (which constructs the registry with `new TeamsProvider()`) also wires /api/apps/teamsbridge.
import './teams/routes';

const NEXT_MILESTONE =
	'TeamsProvider: read/post/realtime is the next milestone (syncMessages/subscribe/postMessage). See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §3.3–§3.5.';

function notConfigured(): never {
	throw new Error('teams_not_configured');
}

/** Build the mutable GraphTokens bundle the graphClient reads/refreshes from stored credentials. */
function tokensFromCredentials(credentials: IProviderCredentials): GraphTokens {
	if (!credentials?.accessToken) {
		throw new Error('teams_missing_access_token');
	}
	return {
		accessToken: credentials.accessToken,
		refreshToken: credentials.refreshToken,
		expiresAt: typeof credentials.expiresAt === 'number' ? credentials.expiresAt : undefined,
	};
}

export class TeamsProvider implements IChatProvider {
	readonly provider = 'teams' as const;

	// ─── auth / lifecycle ──────────────────────────────────────────────────────────────────────

	/**
	 * Complete the OAuth auth-code + PKCE exchange and return usable credentials. The primary
	 * connect flow is the browser redirect handled by ./teams/routes.ts (which persists the
	 * connection itself); this method exists so the IChatProvider contract is honored and callers
	 * that already hold an auth code (+ verifier) can complete the exchange programmatically.
	 */
	async connect(input: IProviderOAuthInput): Promise<IProviderCredentials> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		const { authCode, codeVerifier } = input;
		if (!authCode || !codeVerifier) {
			throw new Error('teams_connect_requires_auth_code_and_verifier');
		}
		const config = getTeamsConfig();

		const res = await fetch(tokenEndpoint(config), {
			ignoreSsrfValidation: true, // Microsoft login host (admin-configured authority), not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code: authCode,
				code_verifier: codeVerifier,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: input.redirectUri || redirectUri(),
				scope: TEAMS_DELEGATED_SCOPES.join(' '),
			}).toString(),
		});
		const tokens: any = await res.json().catch(() => ({}));
		if (!res.ok || !tokens?.access_token) {
			throw new Error(`teams_token_exchange_failed:${tokens?.error || res.status}`);
		}

		// Decode the external tenant id from the id_token (present via the `openid` scope).
		let externalOrgId = '';
		if (typeof tokens.id_token === 'string') {
			try {
				const payload = tokens.id_token.split('.')[1];
				const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
				externalOrgId = claims.tid || '';
			} catch {
				// fall through — verifyCredentials can resolve the org from /me/joinedTeams later
			}
		}

		return {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : undefined,
			externalOrgId,
		};
	}

	/**
	 * Sanity-check credentials and resolve the external org id/name + granted scopes. Calls GET /me
	 * (the graphClient refreshes the access token once on a 401). Returns `ok:false` rather than
	 * throwing so the caller can mark the connection `error`/`needs-reconnect` cleanly.
	 */
	async verifyCredentials(credentials: IProviderCredentials): Promise<IVerifiedConnection> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(credentials);
		try {
			const me = await graphFetch<{ id?: string; displayName?: string; userPrincipalName?: string }>(
				`${GRAPH_BASE}/me?$select=id,displayName,userPrincipalName`,
				tokens,
			);
			// The tenant id isn't on /me; prefer the value captured at connect-time, else derive from the UPN domain.
			const externalOrgId =
				(typeof credentials.externalOrgId === 'string' && credentials.externalOrgId) ||
				(me.userPrincipalName ? me.userPrincipalName.split('@')[1] : '') ||
				'';
			const externalOrgName = me.userPrincipalName ? `Teams (${me.userPrincipalName.split('@')[1] || externalOrgId})` : 'Microsoft Teams';
			return {
				ok: Boolean(me.id),
				externalOrgId,
				externalOrgName,
				scopes: TEAMS_DELEGATED_SCOPES,
			};
		} catch (err) {
			return { ok: false, externalOrgId: String(credentials.externalOrgId || ''), externalOrgName: '', scopes: [] };
		}
	}

	/**
	 * Tear down live resources for this connection. No sockets/subscriptions exist yet (realtime is
	 * the next milestone), so this is a no-op today — disconnect at the record level is handled by
	 * connectionService.
	 */
	async disconnect(_connection: IProviderConnection): Promise<void> {
		// No live Graph subscriptions to delete until the realtime milestone; nothing to release.
	}

	// ─── discovery ─────────────────────────────────────────────────────────────────────────────

	/**
	 * List the channels visible to this connection's user: GET /me/joinedTeams, then for each team
	 * GET /teams/{id}/channels, paged via @odata.nextLink, mapped to IProviderChannel.
	 *
	 * Channel ids look like `19:...@thread.tacv2`. `isPrivate` is derived from membershipType
	 * (`private`); `name`/`description`(topic) come straight off the channel resource.
	 */
	async listChannels(connection: IProviderConnection): Promise<IProviderChannel[]> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(connection.credentials);

		type GraphTeam = { id: string; displayName?: string };
		type GraphChannel = { id: string; displayName?: string; description?: string; membershipType?: string };

		const teams = await graphGetAll<GraphTeam>(`${GRAPH_BASE}/me/joinedTeams?$select=id,displayName`, tokens);

		const channels: IProviderChannel[] = [];
		for (const team of teams) {
			if (!team?.id) {
				continue;
			}
			const teamChannels = await graphGetAll<GraphChannel>(
				`${GRAPH_BASE}/teams/${encodeURIComponent(team.id)}/channels?$select=id,displayName,description,membershipType`,
				tokens,
			);
			for (const ch of teamChannels) {
				if (!ch?.id) {
					continue;
				}
				channels.push({
					externalId: ch.id,
					// Qualify with the team name so a flat channel list is legible across teams.
					name: team.displayName ? `${team.displayName} / ${ch.displayName || ch.id}` : ch.displayName || ch.id,
					isPrivate: ch.membershipType === 'private',
					topic: ch.description,
				});
			}
		}
		return channels;
	}

	// ─── sync (read) — NEXT MILESTONE ────────────────────────────────────────────────────────────

	// eslint-disable-next-line require-yield
	async *syncMessages(_connection: IProviderConnection, _channelExternalId: string, _since?: string): AsyncIterable<IProviderMessage> {
		// TODO(next milestone): GET /teams/{id}/channels/{id}/messages (+ /replies), paged via
		// @odata.nextLink, or /messages/delta with a persisted deltaLink. Map html→markdown +
		// resolve `from.user` for the author. See spec §3.3/§3.5.
		throw new Error(NEXT_MILESTONE);
	}

	async subscribe(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_onMessage: InboundMessageHandler,
	): Promise<IProviderSubscription> {
		// TODO(next milestone): Graph change-notifications (POST /subscriptions) keyed by
		// (tenantId, channelId) and shared across users; T-12h renewal cron; lifecycle + `missed`
		// backfill; polling fallback on a per-connection toggle. See spec §3.3.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── identity — NEXT MILESTONE ───────────────────────────────────────────────────────────────

	async resolveIdentity(_connection: IProviderConnection, _externalUserId: string): Promise<IProviderUser | null> {
		// TODO(next milestone): resolve from the message `from.user` block carried in each payload
		// (avoids needing User.ReadBasic.All). See spec §3.2 note.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── write — NEXT MILESTONE ──────────────────────────────────────────────────────────────────

	async postMessage(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_message: IOutboundMessage,
	): Promise<{ externalId: string }> {
		// TODO(next milestone): POST /teams/{id}/channels/{id}/messages with contentType:"html",
		// built `mentions[]`, AS the signed-in user (delegated ChannelMessage.Send). See spec §3.4.
		throw new Error(NEXT_MILESTONE);
	}
}
