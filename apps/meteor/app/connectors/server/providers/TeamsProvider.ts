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
 * WHAT IS REAL as of the read/post milestone:
 *   - syncMessages       → channel: GET /teams/{teamId}/channels/{channelId}/messages?$top=50;
 *                          direct chat: GET /chats/{chatId}/messages?$top=50 (newest first), paged via
 *                          @odata.nextLink up to a cap; each mapped to IProviderMessage (author from
 *                          `from.user.displayName`, body.content HTML stripped to text).
 *   - postMessage        → channel: POST /teams/{teamId}/channels/{channelId}/messages;
 *                          direct chat: POST /chats/{chatId}/messages, AS the signed-in user
 *                          (delegated ChannelMessage.Send / Chat.ReadWrite). Returns the created id.
 *
 * WHAT IS REAL as of the chats/members milestone:
 *   - listDirectChats    → GET /me/chats?$expand=members (oneOnOne + group), mapped to
 *                          IProviderDirectChat. `name` = the OTHER members' names (or the group topic);
 *                          `externalId` = the Graph chat id (addressed via /chats/{chatId} for read/post).
 *   - listMembers        → aggregate GET /teams/{teamId}/members across joined teams, deduped by the
 *                          Entra user id (`microsoft.graph.aadUserConversationMember.userId`).
 *                          Requires the newly-granted TeamMember.Read.All scope.
 *
 * WHAT IS REAL as of the LIVE MESSAGE BRIDGE milestone:
 *   - subscribe          → Graph change-notifications: POST /subscriptions for the channel/chat
 *                          (delegated; created in the EXTERNAL tenant), delivered to the public
 *                          /_connectors/teams/webhook endpoint (see ./teams/webhook.ts). The
 *                          bridge's durable dispatch is Mongo-backed (subscriptionId → connection),
 *                          so the returned handle's stop() deletes the Graph subscription.
 *   - disconnect         → deletes every Graph subscription THIS app created for the signed-in
 *                          user (matched by our notificationUrl) — provider-pure teardown; the
 *                          bridge records are removed by connectionService/bridgeService.
 *
 * WHAT IS A TODO STUB:
 *   - resolveIdentity    → from the message `from.user` block (avoids User.ReadBasic.All); the
 *                          bridge already renders names from authorDisplayName, so nothing calls it.
 *
 * MESSAGE-TARGET IDENTITY (channel vs direct chat): Microsoft Graph addresses a CHANNEL as
 * `/teams/{teamId}/channels/{channelId}` — it needs BOTH ids — but a DIRECT CHAT as `/chats/{chatId}`.
 * So `listChannels` emits a COMPOSITE `externalId` of `teamId|channelId` (see `encodeChannelId`) while
 * `listDirectChats` emits the BARE Graph chat id. `syncMessages`/`postMessage` accept EITHER and
 * detect which by the `|` separator: an id containing `|` is a channel composite (split via
 * `decodeChannelId` → /teams/.../channels/...); an id WITHOUT `|` is a chat id (used as-is → /chats/...).
 * The `|` separator appears in neither a team GUID nor a `19:…@thread.tacv2`/`19:…@unq.gbl.spaces`
 * chat id, so the detection is unambiguous. Callers (the rail, REST) treat the id as an opaque token.
 *
 * STANDALONE-SAFE: every live method throws `teams_not_configured` when the connector is disabled
 * or no client secret is set, so a fresh MatterChat with Teams off has zero Teams behavior.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { SystemLogger } from '../../../../server/lib/logger/system';
import type {
	IChatProvider,
	InboundMessageHandler,
	IOutboundMessage,
	IProviderChannel,
	IProviderConnection,
	IProviderCredentials,
	IProviderDirectChat,
	IProviderMember,
	IProviderMessage,
	IProviderOAuthInput,
	IProviderSubscription,
	IProviderUser,
	IVerifiedConnection,
} from '../ChatProvider';
import {
	GRAPH_BASE,
	getTeamsConfig,
	isTeamsConfigured,
	isTeamsWebhookConfigured,
	tokenEndpoint,
	redirectUri,
	TEAMS_DELEGATED_SCOPES,
	webhookNotificationUrl,
} from './teams/config';
import type { GraphTokens, RefreshedTokens } from './teams/graphClient';
import { graphFetch, graphGetAll } from './teams/graphClient';
import { mapGraphMessage } from './teams/messageMapping';
import type { GraphChatMessage } from './teams/messageMapping';
import { createChannelSubscription, deleteSubscription } from './teams/subscriptions';

// Mounting the OAuth routes is a side-effect of importing this provider, so booting the connectors
// index (which constructs the registry with `new TeamsProvider()`) also wires /api/apps/teamsbridge.
import './teams/routes';

const NEXT_MILESTONE =
	'TeamsProvider.resolveIdentity: names already ride on each message (from.user.displayName); a directory lookup is a future milestone. See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §3.2.';

function notConfigured(): never {
	throw new Error('teams_not_configured');
}

/** Separator joining teamId + channelId into one opaque `externalId`. Absent from both id formats. */
const CHANNEL_ID_SEP = '|';

/** How many message pages (×$top) to read in one syncMessages call — a reasonable backfill cap. */
const MAX_MESSAGE_PAGES = 5;
const MESSAGE_PAGE_SIZE = 50;

/**
 * Encode a channel's Graph address — `{teamId}/{channelId}` — into the single `externalId` the
 * IChatProvider contract carries everywhere. Graph needs BOTH ids to read/post; listChannels emits
 * this composite and syncMessages/postMessage decode it.
 */
function encodeChannelId(teamId: string, channelId: string): string {
	return `${teamId}${CHANNEL_ID_SEP}${channelId}`;
}

/**
 * Split a composite channel `externalId` back into its `{ teamId, channelId }`. Tolerates a bare
 * channel id (no separator) by throwing a clear error — a channel can't be addressed without its
 * team, so the caller must pass the id listChannels emitted.
 */
function decodeChannelId(externalId: string): { teamId: string; channelId: string } {
	const idx = externalId.indexOf(CHANNEL_ID_SEP);
	if (idx <= 0 || idx >= externalId.length - 1) {
		throw new Error('teams_invalid_channel_id');
	}
	return { teamId: externalId.slice(0, idx), channelId: externalId.slice(idx + CHANNEL_ID_SEP.length) };
}

/**
 * Whether an `externalId` is a CHANNEL composite (`teamId|channelId`) vs a DIRECT-CHAT id. The `|`
 * separator is present only in the composite `listChannels` emits — never in a team GUID nor a
 * `19:…@thread.tacv2`/`19:…@unq.gbl.spaces` chat id `listDirectChats` emits — so its presence is the
 * unambiguous discriminator. `syncMessages`/`postMessage` use this to pick the Graph endpoint.
 */
function isChannelComposite(externalId: string): boolean {
	return externalId.includes(CHANNEL_ID_SEP);
}

/**
 * Resolve a message-target `externalId` (channel composite OR direct-chat id) to the Graph collection
 * base its messages live under: `/teams/{teamId}/channels/{channelId}` for a channel, `/chats/{chatId}`
 * for a direct chat. `syncMessages` appends `/messages?$top=…`; `postMessage` appends `/messages`.
 */
function messagesBaseUrl(externalId: string): string {
	if (isChannelComposite(externalId)) {
		const { teamId, channelId } = decodeChannelId(externalId);
		return `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}`;
	}
	if (!externalId) {
		throw new Error('teams_invalid_channel_id');
	}
	// A direct chat is addressed by its bare Graph chat id (no team).
	return `${GRAPH_BASE}/chats/${encodeURIComponent(externalId)}`;
}

// htmlToText lives in ./teams/messageMapping (shared with the webhook's inbound path + unit-tested).

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

/** The graphClient's refresh callback shape, forwarded to the connection's persistence hook. */
type OnRefreshed = (t: RefreshedTokens) => void | Promise<void>;

/**
 * Build BOTH the mutable GraphTokens bundle AND the refresh-persistence hook for one call chain.
 * When the caller attached `connection.onCredentialsRefreshed` (connectionService does), every
 * graphFetch/graphGetAll in the chain gets a hook that forwards the refreshed fields (new access
 * token, ROTATED refresh token, expiresAt) so the caller can merge + re-encrypt + persist them.
 * The provider itself still never touches Mongo. No hook attached → undefined (in-memory refresh
 * only — the pre-existing behavior).
 */
function tokensAndHook(connection: IProviderConnection): { tokens: GraphTokens; onRefreshed?: OnRefreshed } {
	const tokens = tokensFromCredentials(connection.credentials);
	const { onCredentialsRefreshed } = connection;
	if (!onCredentialsRefreshed) {
		return { tokens };
	}
	const onRefreshed: OnRefreshed = async (t) => {
		try {
			await onCredentialsRefreshed({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt });
		} catch (err) {
			// Persistence is best-effort: the in-memory refresh already succeeded, so the live call
			// proceeds; the only cost of a failed persist is a re-refresh on a later call.
			SystemLogger.warn({ msg: 'Teams refreshed-token persistence failed (call continues)', err: String(err) });
		}
	};
	return { tokens, onRefreshed };
}

/** The presence enum the IProviderDirectChat/IProviderMember contract carries (frontend renders a dot). */
type ProviderPresence = 'active' | 'away' | 'dnd' | 'offline';

/**
 * Map a Microsoft Graph presence `availability` to the IChatProvider presence enum. Graph's richer
 * availability vocabulary (Available, Away, BeRightBack, Busy, DoNotDisturb, Offline, …) collapses to
 * the four-state dot the UI renders. Anything unrecognized → undefined (the field degrades to absent).
 */
function mapGraphPresence(availability?: string): ProviderPresence | undefined {
	switch (availability) {
		case 'Available':
		case 'AvailableIdle':
			return 'active';
		case 'Away':
		case 'BeRightBack':
			return 'away';
		case 'DoNotDisturb':
		case 'Busy':
		case 'BusyIdle':
			return 'dnd';
		case 'Offline':
		case 'PresenceUnknown':
			return 'offline';
		default:
			return undefined;
	}
}

/** Graph caps getPresencesByUserId at 650 ids/call; batch well under that to stay polite. */
const PRESENCE_BATCH_SIZE = 100;

/**
 * Best-effort presence lookup for a set of Entra user ids via POST /communications/getPresencesByUserId
 * (delegated Presence.Read). Returns a Map<userId, ProviderPresence> with only the ids Graph resolved
 * to a recognized availability. ANY error (missing Presence.Read scope, throttling, a malformed batch)
 * resolves to an EMPTY map — presence is purely additive, so a failure simply leaves it undefined on
 * every chat/member rather than breaking the list. Batched to respect the endpoint's id-count cap.
 */
async function fetchPresences(tokens: GraphTokens, userIds: string[], onRefreshed?: OnRefreshed): Promise<Map<string, ProviderPresence>> {
	const out = new Map<string, ProviderPresence>();
	// Dedupe + drop empties so a batch is never wasted on a blank/duplicate id.
	const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
	if (!ids.length) {
		return out;
	}

	type GraphPresence = { id?: string; availability?: string };
	try {
		for (let i = 0; i < ids.length; i += PRESENCE_BATCH_SIZE) {
			const batch = ids.slice(i, i + PRESENCE_BATCH_SIZE);
			const res = await graphFetch<{ value?: GraphPresence[] }>(
				`${GRAPH_BASE}/communications/getPresencesByUserId`,
				tokens,
				{
					method: 'POST',
					body: { ids: batch },
				},
				onRefreshed,
			);
			for (const p of res.value || []) {
				if (!p?.id) {
					continue;
				}
				const mapped = mapGraphPresence(p.availability);
				if (mapped) {
					out.set(p.id, mapped);
				}
			}
		}
	} catch (err) {
		// Presence.Read may not be consented, or the endpoint throttled — degrade to no presence.
		SystemLogger.debug({ msg: 'Teams fetchPresences failed (presence left undefined)', err: String(err) });
		return new Map();
	}
	return out;
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
	 * Tear down live resources for this connection: delete every Graph change-notification
	 * subscription THIS app created for the signed-in user. Provider-pure (no Mongo): delegated
	 * `GET /subscriptions` lists only the app+user pair's subscriptions; we delete the ones whose
	 * notificationUrl is ours. Record-level teardown stays in connectionService/bridgeService.
	 * Best-effort by contract (the caller swallows errors) — but we don't throw for empty creds.
	 */
	async disconnect(connection: IProviderConnection): Promise<void> {
		if (!isTeamsConfigured() || !connection.credentials?.accessToken) {
			return;
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);
		const ourUrl = webhookNotificationUrl();

		type GraphSubscription = { id?: string; notificationUrl?: string };
		const subs = await graphGetAll<GraphSubscription>(`${GRAPH_BASE}/subscriptions`, tokens, onRefreshed);
		for (const sub of subs) {
			if (!sub?.id || sub.notificationUrl !== ourUrl) {
				continue;
			}
			try {
				await deleteSubscription(tokens, sub.id, onRefreshed);
			} catch (err) {
				SystemLogger.warn({ msg: 'Teams disconnect: subscription delete failed', subscriptionId: sub.id, err: String(err) });
			}
		}
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
		const { tokens, onRefreshed } = tokensAndHook(connection);

		type GraphTeam = { id: string; displayName?: string };
		type GraphChannel = { id: string; displayName?: string; description?: string; membershipType?: string };

		const teams = await graphGetAll<GraphTeam>(`${GRAPH_BASE}/me/joinedTeams?$select=id,displayName`, tokens, onRefreshed);

		const channels: IProviderChannel[] = [];
		for (const team of teams) {
			if (!team?.id) {
				continue;
			}
			const teamChannels = await graphGetAll<GraphChannel>(
				`${GRAPH_BASE}/teams/${encodeURIComponent(team.id)}/channels?$select=id,displayName,description,membershipType`,
				tokens,
				onRefreshed,
			);
			for (const ch of teamChannels) {
				if (!ch?.id) {
					continue;
				}
				channels.push({
					// Composite `teamId|channelId` — Graph needs both to read/post (see encodeChannelId).
					externalId: encodeChannelId(team.id, ch.id),
					// Qualify with the team name so a flat channel list is legible across teams.
					name: team.displayName ? `${team.displayName} / ${ch.displayName || ch.id}` : ch.displayName || ch.id,
					isPrivate: ch.membershipType === 'private',
					topic: ch.description,
				});
			}
		}
		return channels;
	}

	// ─── sync (read) — REAL ──────────────────────────────────────────────────────────────────────

	/**
	 * Read a channel's OR a direct chat's messages, newest-first, paged via @odata.nextLink up to
	 * MAX_MESSAGE_PAGES:
	 *   - channel:  GET /teams/{teamId}/channels/{channelId}/messages?$top=50
	 *   - direct chat: GET /chats/{chatId}/messages?$top=50
	 * The endpoint is picked from `channelExternalId` by `messagesBaseUrl` (composite `teamId|channelId`
	 * → channel; bare chat id → chat). Each Graph message is mapped to IProviderMessage — author from
	 * `from.user.displayName` (falls back to the user id), text from `body.content` (HTML stripped to
	 * plain text), `ts` from `createdDateTime`. System messages (no `from.user`, e.g. "X added Y") are
	 * skipped.
	 *
	 * `channelExternalId` is EITHER the composite `teamId|channelId` listChannels emitted OR the bare
	 * chat id listDirectChats emitted. `since` is an optional ISO timestamp: messages at/older than it
	 * stop the scan (Graph has no `$filter` here, so we filter client-side and stop early — the feed is
	 * newest-first for both endpoints).
	 */
	async *syncMessages(connection: IProviderConnection, channelExternalId: string, since?: string): AsyncIterable<IProviderMessage> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);
		// Channel composite (`teamId|channelId`) → /teams/.../channels/...; bare chat id → /chats/...
		const baseUrl = messagesBaseUrl(channelExternalId);

		const sinceMs = since ? Date.parse(since) : NaN;
		const hasSince = !Number.isNaN(sinceMs);

		let next: string | undefined = `${baseUrl}/messages?$top=${MESSAGE_PAGE_SIZE}`;
		let pages = 0;

		while (next && pages < MAX_MESSAGE_PAGES) {
			// Explicit variable annotation (not inference) — breaks the `page` -> `next` -> `page`
			// control-flow cycle tsc reports as TS7022 (the generic alone doesn't, because the
			// narrowed type of the `next` argument still depends on `page`).
			const page: { 'value'?: GraphChatMessage[]; '@odata.nextLink'?: string } = await graphFetch(next, tokens, {}, onRefreshed);
			pages++;

			for (const msg of page.value || []) {
				const ts = msg?.createdDateTime || '';
				// Newest-first feed: once we cross the `since` cursor we can stop entirely.
				if (hasSince && ts) {
					const tsMs = Date.parse(ts);
					if (!Number.isNaN(tsMs) && tsMs <= sinceMs) {
						return;
					}
				}

				// Shared mapping (same as the webhook path): skips deleted/system/authorless messages,
				// strips HTML bodies, carries authorDisplayName + editedTs + threadExternalId.
				const mapped = mapGraphMessage(msg, channelExternalId);
				if (!mapped) {
					continue;
				}
				yield mapped;
			}

			next = page['@odata.nextLink'];
		}
	}

	/**
	 * Begin real-time updates for a channel/chat: creates the Graph change-notification
	 * subscription delivering to the public /_connectors/teams/webhook endpoint.
	 *
	 * NOTE on dispatch: the live bridge's inbound delivery is DURABLE — the webhook resolves the
	 * subscription from the connection document (Mongo) and ingests via bridgeCore, surviving
	 * restarts. The `onMessage` handler here is therefore not the delivery path for bridged rooms;
	 * this method exists to honor the IChatProvider contract for callers that manage their own
	 * subscription lifecycle. The returned handle's stop() deletes the Graph subscription.
	 *
	 * Requires webhook mode (public URL + TEAMS_WEBHOOK_CLIENT_STATE_SECRET) — throws
	 * `teams_webhook_not_configured` otherwise. A `shared: true` outcome (Graph already holds the
	 * one-per-app+channel subscription) returns a no-op handle — delivery rides the existing
	 * subscription's fan-out.
	 */
	async subscribe(
		connection: IProviderConnection,
		channelExternalId: string,
		_onMessage: InboundMessageHandler,
	): Promise<IProviderSubscription> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		if (!isTeamsWebhookConfigured()) {
			throw new Error('teams_webhook_not_configured');
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);
		const created = await createChannelSubscription(tokens, connection.connectionId, channelExternalId, onRefreshed);
		if (created.shared) {
			return {
				stop: async (): Promise<void> => {
					// Nothing owned to release — another connection owns the actual Graph subscription.
				},
			};
		}
		const { subscriptionId } = created;
		return {
			stop: async (): Promise<void> => {
				const stopBundle = tokensAndHook(connection);
				await deleteSubscription(stopBundle.tokens, subscriptionId, stopBundle.onRefreshed);
			},
		};
	}

	// ─── identity — NEXT MILESTONE ───────────────────────────────────────────────────────────────

	async resolveIdentity(_connection: IProviderConnection, _externalUserId: string): Promise<IProviderUser | null> {
		// TODO(next milestone): resolve from the message `from.user` block carried in each payload
		// (avoids needing User.ReadBasic.All). See spec §3.2 note.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── write — REAL ────────────────────────────────────────────────────────────────────────────

	/**
	 * Post a message to a channel OR a direct chat AS the signed-in user (delegated ChannelMessage.Send
	 * / Chat.ReadWrite):
	 *   - channel:  POST /teams/{teamId}/channels/{channelId}/messages
	 *   - direct chat: POST /chats/{chatId}/messages
	 * with `{ body: { content } }`. Sends the text as-is (contentType defaults to text on Graph) and
	 * returns the created message id. The endpoint is picked from `channelExternalId` by
	 * `messagesBaseUrl` (composite → channel; bare chat id → chat).
	 *
	 * `channelExternalId` is EITHER the composite `teamId|channelId` listChannels emitted OR the bare
	 * chat id listDirectChats emitted.
	 */
	async postMessage(
		connection: IProviderConnection,
		channelExternalId: string,
		message: IOutboundMessage,
	): Promise<{ externalId: string }> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		const text = message?.text;
		if (typeof text !== 'string' || !text.trim()) {
			throw new Error('teams_empty_message');
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);
		// Channel composite (`teamId|channelId`) → /teams/.../channels/...; bare chat id → /chats/...
		const baseUrl = messagesBaseUrl(channelExternalId);

		const created = await graphFetch<{ id?: string }>(
			`${baseUrl}/messages`,
			tokens,
			{
				method: 'POST',
				body: { body: { content: text } },
			},
			onRefreshed,
		);
		if (!created?.id) {
			throw new Error('teams_post_no_message_id');
		}
		return { externalId: created.id };
	}

	// ─── direct chats (DMs) — REAL ────────────────────────────────────────────────────────────────

	/**
	 * List the user's direct chats — 1:1 and group DMs — for the "Chats" section:
	 * GET /me/chats?$expand=members, paged via @odata.nextLink. Each Graph chat is mapped to
	 * IProviderDirectChat — `externalId` = the Graph chat id (addressed via /chats/{chatId} for
	 * read/post), `isGroup` from `chatType` (`group` vs `oneOnOne`), and `name`:
	 *   - 1:1   → the OTHER member's displayName (the member that isn't the signed-in user)
	 *   - group → the chat `topic` if set, else the joined other-member display names
	 * `meeting`/system chat types are skipped — only oneOnOne + group DMs surface. Graph errors
	 * (e.g. Chat.Read/Chat.ReadWrite missing) are surfaced UNSWALLOWED by graphFetch.
	 */
	async listDirectChats(connection: IProviderConnection): Promise<IProviderDirectChat[]> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);
		// The signed-in user's own id — so we can name a 1:1 by the OTHER member, not by ourselves.
		const me = await graphFetch<{ id?: string }>(`${GRAPH_BASE}/me?$select=id`, tokens, {}, onRefreshed);
		const myId = me?.id || '';

		type GraphChatMember = {
			// aadUserConversationMember carries the Entra user id + the member's displayName.
			userId?: string;
			displayName?: string;
		};
		// The "feel-alive" signals Graph carries on a chat resource (no extra call needed):
		//  - lastMessagePreview.createdDateTime → when the chat last had activity (sort + "x ago").
		//  - viewpoint.lastMessageReadDateTime  → how far this user has read; if the last message is
		//    newer than that, the chat "has unread". Graph gives no exact per-chat unread number cheaply,
		//    so unreadCount is 1 = "has unread" (see caveats), never an exact count.
		type GraphChat = {
			id?: string;
			topic?: string | null;
			chatType?: string;
			members?: GraphChatMember[];
			lastMessagePreview?: { createdDateTime?: string } | null;
			viewpoint?: { lastMessageReadDateTime?: string } | null;
		};

		const chats = await graphGetAll<GraphChat>(`${GRAPH_BASE}/me/chats?$expand=members,lastMessagePreview`, tokens, onRefreshed);

		const out: IProviderDirectChat[] = [];
		// Collect the 1:1 counterpart ids so we can resolve presence in ONE batched call after the loop.
		const oneOnOneOtherIds: string[] = [];
		for (const chat of chats) {
			if (!chat?.id) {
				continue;
			}
			// Only DMs: oneOnOne (1:1) and group. Skip meeting/system chat types.
			const chatType = chat.chatType || '';
			if (chatType !== 'oneOnOne' && chatType !== 'group') {
				continue;
			}
			const isGroup = chatType === 'group';

			const members = Array.isArray(chat.members) ? chat.members : [];
			// Everyone but me — the basis for naming a 1:1 and for the group fallback label.
			const others = members.filter((m) => (m?.userId || '') !== myId);
			const otherNames = others.map((m) => m?.displayName).filter((n): n is string => Boolean(n));
			const memberExternalIds = members.map((m) => m?.userId).filter((id): id is string => Boolean(id));

			let name: string;
			if (isGroup) {
				// Prefer the group's own topic; fall back to the joined other-member names, then the id.
				name = chat.topic?.trim() || (otherNames.length ? otherNames.join(', ') : '') || chat.id;
			} else {
				// 1:1 → the single other member's name (or the id if Graph didn't expand a name).
				name = otherNames[0] || chat.id;
			}

			// lastActivity (epoch-ms) from the last message preview's createdDateTime; absent → undefined.
			const lastMsgIso = chat.lastMessagePreview?.createdDateTime;
			const lastMsgMs = lastMsgIso ? Date.parse(lastMsgIso) : NaN;
			const lastActivity = Number.isNaN(lastMsgMs) ? undefined : lastMsgMs;

			// "has unread": the last message is newer than this user's lastMessageReadDateTime viewpoint.
			// Graph has no cheap exact count, so 1 = has-unread, 0/undefined = caught up (see caveats).
			let unreadCount: number | undefined;
			if (typeof lastMsgMs === 'number' && !Number.isNaN(lastMsgMs)) {
				const readIso = chat.viewpoint?.lastMessageReadDateTime;
				const readMs = readIso ? Date.parse(readIso) : NaN;
				// Unread when we have a read cursor and the last message beats it. If the cursor is
				// missing/unparseable we can't be sure, so leave unreadCount undefined (don't guess unread).
				if (!Number.isNaN(readMs)) {
					unreadCount = lastMsgMs > readMs ? 1 : 0;
				}
			}

			if (!isGroup && others.length === 1 && others[0]?.userId) {
				oneOnOneOtherIds.push(others[0].userId);
			}

			out.push({
				externalId: chat.id,
				name,
				isGroup,
				...(memberExternalIds.length ? { memberExternalIds } : {}),
				...(lastActivity !== undefined ? { lastActivity } : {}),
				...(unreadCount !== undefined ? { unreadCount } : {}),
				// Graph doesn't give a per-chat mention count cheaply — always 0 (see caveats).
				mentionCount: 0,
				// avatarUrl: a user photo requires a heavy binary GET (/users/{id}/photo/$value); we don't
				// fetch binaries here, and Graph exposes no cheap photo URL — so it's left undefined and the
				// frontend falls back to initials (see caveats).
			});
		}

		// Presence (1:1 only): one batched POST /communications/getPresencesByUserId for all counterpart
		// ids. Best-effort — if Presence.Read isn't consented (or it throttles) this returns an empty map
		// and presence stays undefined on every chat. Matched back onto the 1:1 rows by counterpart id.
		if (oneOnOneOtherIds.length) {
			const presences = await fetchPresences(tokens, oneOnOneOtherIds, onRefreshed);
			if (presences.size) {
				for (const chat of chats) {
					if (!chat?.id || chat.chatType !== 'oneOnOne') {
						continue;
					}
					const others = (Array.isArray(chat.members) ? chat.members : []).filter((m) => (m?.userId || '') !== myId);
					const otherId = others.length === 1 ? others[0]?.userId : undefined;
					const presence = otherId ? presences.get(otherId) : undefined;
					if (!presence) {
						continue;
					}
					const row = out.find((r) => r.externalId === chat.id);
					if (row) {
						row.presence = presence;
					}
				}
			}
		}

		return out;
	}

	// ─── members (People) — REAL ──────────────────────────────────────────────────────────────────

	/**
	 * List the org/workspace people for the "People" section by aggregating team membership across the
	 * user's joined teams: GET /me/joinedTeams then GET /teams/{teamId}/members (paged), deduped by the
	 * Entra user id. Requires the newly-granted delegated TeamMember.Read.All scope. Each member maps to
	 * IProviderMember { externalId: aad userId, displayName, email }. Graph errors (e.g. the scope not
	 * yet consented) are surfaced UNSWALLOWED by graphFetch/graphGetAll.
	 */
	async listMembers(connection: IProviderConnection): Promise<IProviderMember[]> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);

		type GraphTeam = { id: string };
		type GraphTeamMember = {
			// aadUserConversationMember: the Entra user id, the member's display name, and email.
			userId?: string;
			displayName?: string;
			email?: string;
		};

		const teams = await graphGetAll<GraphTeam>(`${GRAPH_BASE}/me/joinedTeams?$select=id`, tokens, onRefreshed);

		// Dedupe people across teams by Entra user id (one person is a member of many teams).
		const byUserId = new Map<string, IProviderMember>();
		for (const team of teams) {
			if (!team?.id) {
				continue;
			}
			const teamMembers = await graphGetAll<GraphTeamMember>(
				`${GRAPH_BASE}/teams/${encodeURIComponent(team.id)}/members`,
				tokens,
				onRefreshed,
			);
			for (const m of teamMembers) {
				const externalId = m?.userId;
				if (!externalId || byUserId.has(externalId)) {
					continue;
				}
				byUserId.set(externalId, {
					externalId,
					displayName: m.displayName || externalId,
					...(m.email ? { email: m.email } : {}),
					// avatarUrl: a user photo needs a heavy binary GET (/users/{id}/photo/$value); we don't
					// fetch binaries here and Graph exposes no cheap photo URL, so it's left undefined and the
					// frontend falls back to initials (see caveats).
				});
			}
		}

		// Presence (best-effort): one batched POST /communications/getPresencesByUserId for every person.
		// If Presence.Read isn't consented (or it throttles) this returns an empty map and presence stays
		// undefined on every member — purely additive, never breaks the list.
		const memberIds = [...byUserId.keys()];
		if (memberIds.length) {
			const presences = await fetchPresences(tokens, memberIds, onRefreshed);
			for (const [id, presence] of presences) {
				const member = byUserId.get(id);
				if (member) {
					member.presence = presence;
				}
			}
		}

		return [...byUserId.values()];
	}

	// ─── read-state (notifications / feel-alive) — REAL ────────────────────────────────────────────

	/**
	 * Mark a chat OR channel read in Teams, AS the signed-in user. Best-effort and resolves void —
	 * the service layer swallows any throw and still acks ok to the client, so this never needs to
	 * signal a hard failure.
	 *
	 * Graph exposes a cheap markChatReadForUser ONLY for chats (1:1/group DMs):
	 *   POST /chats/{chatId}/markChatReadForUser  with `{ user: { id } }`
	 * There is no equivalent cheap "mark channel read" on Graph (channel read-state isn't a delegated
	 * write), so a CHANNEL composite (`teamId|channelId`) is a deliberate no-op here. `externalId` is
	 * EITHER a channel composite OR a bare chat id — detected exactly like syncMessages/postMessage.
	 */
	async markRead(connection: IProviderConnection, externalId: string): Promise<void> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		if (!externalId) {
			return;
		}
		// No cheap delegated "mark channel read" in Graph — channel ids are a no-op (see doc above).
		if (isChannelComposite(externalId)) {
			return;
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);
		// markChatReadForUser needs the acting user's Entra id in the body.
		const me = await graphFetch<{ id?: string }>(`${GRAPH_BASE}/me?$select=id`, tokens, {}, onRefreshed);
		const myId = me?.id;
		if (!myId) {
			return;
		}
		await graphFetch(
			`${GRAPH_BASE}/chats/${encodeURIComponent(externalId)}/markChatReadForUser`,
			tokens,
			{
				method: 'POST',
				body: { user: { id: myId } },
			},
			onRefreshed,
		);
	}

	/**
	 * Roll up this ONE connection's total unread for the badge: a single GET /me/chats (the same data
	 * listDirectChats reads) and count chats whose last message is newer than this user's read viewpoint
	 * (the "has unread" comparison). Returns plain non-negative integers.
	 *
	 *   - unreadCount  = number of chats with at least one unread message (each counts once — Graph gives
	 *                    no cheap exact per-chat count, see caveats; this is a "chats-with-unread" total).
	 *   - mentionCount = 0 — Graph exposes no cheap per-chat mention count (see caveats).
	 *
	 * Channels are NOT included (Graph has no cheap delegated channel unread signal), so this is DM unread
	 * only — same /me/chats source as listDirectChats, no extra calls.
	 */
	async unreadSummary(connection: IProviderConnection): Promise<{ unreadCount: number; mentionCount: number }> {
		if (!isTeamsConfigured()) {
			return notConfigured();
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);

		type GraphChat = {
			id?: string;
			chatType?: string;
			lastMessagePreview?: { createdDateTime?: string } | null;
			viewpoint?: { lastMessageReadDateTime?: string } | null;
		};

		// $select keeps the payload tiny — we only need the read-state signals, not members/topic.
		const chats = await graphGetAll<GraphChat>(
			`${GRAPH_BASE}/me/chats?$select=id,chatType,lastMessagePreview,viewpoint`,
			tokens,
			onRefreshed,
		);

		let unreadCount = 0;
		for (const chat of chats) {
			if (!chat?.id) {
				continue;
			}
			const chatType = chat.chatType || '';
			if (chatType !== 'oneOnOne' && chatType !== 'group') {
				continue;
			}
			const lastIso = chat.lastMessagePreview?.createdDateTime;
			const lastMs = lastIso ? Date.parse(lastIso) : NaN;
			if (Number.isNaN(lastMs)) {
				continue;
			}
			const readIso = chat.viewpoint?.lastMessageReadDateTime;
			const readMs = readIso ? Date.parse(readIso) : NaN;
			// Only count as unread when we have a read cursor AND the last message beats it (don't guess).
			if (!Number.isNaN(readMs) && lastMs > readMs) {
				unreadCount++;
			}
		}

		return { unreadCount, mentionCount: 0 };
	}
}
