/**
 * GoogleChatProvider — Google Chat REST implementation of IChatProvider.
 *
 * GREENFIELD on the Google Chat API; clean-room from the Google docs — nothing under
 * apps/meteor/ee/ was read or copied. Mirrors TeamsProvider, but Google Chat is SIMPLER: a space's
 * resource name (`spaces/{id}`) IS the channel id, so there is NO composite encode/decode — the
 * `externalId` is passed straight through to `GET/POST /v1/{space}/messages`.
 *
 * WHAT IS REAL:
 *   - connect            → completes the OAuth auth-code + PKCE exchange (the same exchange the
 *                          /_google/oauth/callback route runs) and returns usable credentials.
 *                          DELEGATED scopes; acts AS the signed-in user.
 *   - verifyCredentials  → lists spaces (cheapest authenticated call) to confirm the token works.
 *   - listChannels       → GET /v1/spaces (paged via nextPageToken), the SPACE-type spaces mapped to
 *                          IProviderChannel { externalId: space.name, name, isPrivate }.
 *   - listDirectChats    → GET /v1/spaces, the DIRECT_MESSAGE + GROUP_CHAT spaces mapped to
 *                          IProviderDirectChat. A DM is named by the OTHER member(s) via
 *                          GET /v1/{space}/members (chat.memberships.readonly); falls back to the
 *                          space displayName/id when the membership lookup yields nothing.
 *   - listMembers        → GET /v1/{space}/members for one space; for the org-wide People roster,
 *                          aggregate members across all the user's spaces, deduped by user id.
 *   - syncMessages       → GET /v1/{space}/messages?pageSize=50 (paged), each mapped to
 *                          IProviderMessage (author from sender.displayName, text, createdAt). Works
 *                          for DM-type spaces too — same /v1/{space}/messages path.
 *   - postMessage        → POST /v1/{space}/messages with { text }, AS the signed-in user. Returns
 *                          the created message resource name as the externalId. Works for DM-type
 *                          spaces too — same /v1/{space}/messages path.
 *
 * WHAT IS A TODO STUB (the realtime milestone):
 *   - subscribe          → Google Chat does not push per-space message events to a generic OAuth
 *                          client; a polling fallback (or a Chat app/Pub-Sub) is the realtime path.
 *   - resolveIdentity    → from the message `sender` block carried in each payload.
 *
 * STANDALONE-SAFE: every live method throws `google_not_configured` when the connector is disabled
 * or no client secret is set, so a fresh MatterChat with Google Chat off has zero Google behavior.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

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
	CHAT_BASE,
	getGoogleConfig,
	isGoogleConfigured,
	GOOGLE_TOKEN_ENDPOINT,
	redirectUri,
	GOOGLE_DELEGATED_SCOPES,
} from './google/config';
import type { GoogleTokens, RefreshedTokens } from './google/googleApi';
import { googleFetch, googleGetAll } from './google/googleApi';
import { SystemLogger } from '../../../../server/lib/logger/system';

// Mounting the OAuth routes is a side-effect of importing this provider, so booting the connectors
// index (which constructs the registry with `new GoogleChatProvider()`) also wires /_google/oauth.
import './google/routes';

const NEXT_MILESTONE =
	'GoogleChatProvider: realtime is the next milestone (subscribe/resolveIdentity). Google Chat has no generic per-space push to an OAuth client; polling/Pub-Sub is the path.';

function notConfigured(): never {
	throw new Error('google_not_configured');
}

/**
 * Cache user → DM space resolution per connection to avoid repeated lookups.
 * Keyed by connection id, maps user resource names to space resource names.
 * Entries are garbage-collected when the connection is discarded (unbridged/disconnected).
 */
const userToDmSpaceCache = new Map<string, Map<string, string>>();

/** How many message pages (×pageSize) to read in one syncMessages call — a reasonable backfill cap. */
const MAX_MESSAGE_PAGES = 5;
const MESSAGE_PAGE_SIZE = 50;

/** Build the mutable GoogleTokens bundle the googleApi reads/refreshes from stored credentials. */
function tokensFromCredentials(credentials: IProviderCredentials): GoogleTokens {
	if (!credentials?.accessToken) {
		throw new Error('google_missing_access_token');
	}
	return {
		accessToken: credentials.accessToken,
		refreshToken: credentials.refreshToken,
		expiresAt: typeof credentials.expiresAt === 'number' ? credentials.expiresAt : undefined,
	};
}

/** The googleApi refresh callback shape, forwarded to the connection's persistence hook. */
type OnRefreshed = (t: RefreshedTokens) => void | Promise<void>;

/**
 * Build BOTH the mutable GoogleTokens bundle AND the refresh-persistence hook for one call chain
 * (mirrors TeamsProvider's tokensAndHook). When the caller attached `connection.onCredentialsRefreshed`
 * (connectionService / runtimeConnection do), every googleFetch/googleGetAll in the chain gets a hook
 * that forwards the refreshed fields (new access token, expiresAt) so the caller can merge +
 * re-encrypt + persist them. The provider itself still never touches Mongo. No hook attached →
 * undefined (in-memory refresh only — the stored access token stays expired, so every later call
 * pays a 401 + refresh round-trip; that's why every connection-taking method uses THIS, not
 * tokensFromCredentials directly).
 */
function tokensAndHook(connection: IProviderConnection): { tokens: GoogleTokens; onRefreshed?: OnRefreshed } {
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
			SystemLogger.warn({ msg: 'Google refreshed-token persistence failed (call continues)', err: String(err) });
		}
	};
	return { tokens, onRefreshed };
}

/**
 * Convert a space's `lastActiveTime` (RFC-3339 string) to epoch-ms for the contract's optional
 * `lastActivity` field. Returns undefined when the field is absent or unparseable, so callers can spread
 * it conditionally (`...(ms !== undefined ? { lastActivity: ms } : {})`) and never emit a NaN.
 */
function lastActivityMs(space: GoogleSpace): number | undefined {
	if (!space?.lastActiveTime) {
		return undefined;
	}
	const ms = Date.parse(space.lastActiveTime);
	return Number.isNaN(ms) ? undefined : ms;
}

/** Normalize a space resource name to the `spaces/{id}` form (tolerates a bare id). */
function toSpaceName(externalId: string): string {
	if (!externalId) {
		throw new Error('google_invalid_channel_id');
	}
	return externalId.startsWith('spaces/') ? externalId : `spaces/${externalId}`;
}

/**
 * A Google Chat space, in the shape the spaces.list endpoint returns. `spaceType` is the current field
 * (`SPACE` = named channel/room, `DIRECT_MESSAGE` = 1:1, `GROUP_CHAT` = group DM); `type` is the
 * legacy field (`ROOM`/`DM`) — we tolerate both. spaces.list does NOT inline members, so a DM is named
 * via a separate spaces.members.list call (see fetchSpaceMembers).
 */
type GoogleSpace = {
	name?: string;
	displayName?: string;
	spaceType?: string;
	type?: string;
	/**
	 * Timestamp (RFC-3339 string) of the last message in the space. Returned by spaces.list on
	 * SPACE/GROUP_CHAT/DIRECT_MESSAGE spaces when available; absent on spaces with no activity yet. Used
	 * (best-effort) to populate the contract's optional `lastActivity` (epoch-ms) for sort/recency.
	 */
	lastActiveTime?: string;
};

/**
 * A `User` (a human or app principal) as it appears inside a membership's `member` block. `name` is the
 * `users/{id}` resource id, `displayName` the human label, `type` is HUMAN vs BOT. The Chat API does NOT
 * return an avatar/photo on this User block today, so `avatarUrl` is tolerated-if-present but is in
 * practice always undefined (see the caveat in listMembers/listDirectChats).
 */
type GoogleChatUser = { name?: string; displayName?: string; type?: string; avatarUrl?: string };

/**
 * A space membership, in the shape spaces.members.list returns under the `memberships` field. Human
 * members carry a `member` (a User); Google-group members carry `groupMember` (which has no per-person
 * user id) — we only surface `member` people.
 */
type GoogleMembership = { name?: string; member?: GoogleChatUser; groupMember?: { name?: string } };

/** Page size for spaces.members.list — members per space are few, one page usually suffices. */
const MEMBER_PAGE_SIZE = 100;

/**
 * List a space's HUMAN members via spaces.members.list: GET /v1/{space}/members?pageSize=100 (paged via
 * nextPageToken, field `memberships`). Returns the `member` User of each membership (group memberships,
 * which have no per-person id, are dropped). Requires the delegated `chat.memberships.readonly` scope —
 * a missing-scope/permission failure rides back UNSWALLOWED via googleGetAll (`google_error:...`).
 */
async function fetchSpaceMembers(space: string, tokens: GoogleTokens, onRefreshed?: OnRefreshed): Promise<GoogleChatUser[]> {
	const memberships = await googleGetAll<GoogleMembership>(
		`${CHAT_BASE}/${space}/members?pageSize=${MEMBER_PAGE_SIZE}`,
		'memberships',
		tokens,
		onRefreshed,
	);
	const users: GoogleChatUser[] = [];
	for (const m of memberships) {
		// Only person ("member") memberships carry a user id; skip Google-group ("groupMember") rows.
		if (m?.member?.name) {
			users.push(m.member);
		}
	}
	return users;
}

export class GoogleChatProvider implements IChatProvider {
	readonly provider = 'google' as const;

	// ─── auth / lifecycle ──────────────────────────────────────────────────────────────────────

	/**
	 * Complete the OAuth auth-code + PKCE exchange and return usable credentials. The primary connect
	 * flow is the browser redirect handled by ./google/routes.ts (which persists the connection
	 * itself); this method exists so the IChatProvider contract is honored and callers that already
	 * hold an auth code (+ verifier) can complete the exchange programmatically.
	 */
	async connect(input: IProviderOAuthInput): Promise<IProviderCredentials> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const { authCode, codeVerifier } = input;
		if (!authCode || !codeVerifier) {
			throw new Error('google_connect_requires_auth_code_and_verifier');
		}
		const config = getGoogleConfig();

		const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
			ignoreSsrfValidation: true, // Google token host, not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code: authCode,
				code_verifier: codeVerifier,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: input.redirectUri || redirectUri(),
			}).toString(),
		});
		const tokens: any = await res.json().catch(() => ({}));
		if (!res.ok || !tokens?.access_token) {
			throw new Error(`google_token_exchange_failed:${tokens?.error || res.status}`);
		}

		// Decode the workspace domain from the id_token (present via `openid email`).
		let externalOrgId = '';
		if (typeof tokens.id_token === 'string') {
			try {
				const payload = tokens.id_token.split('.')[1];
				const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
				externalOrgId = claims.hd || (typeof claims.email === 'string' ? claims.email.split('@')[1] : '') || '';
			} catch {
				// fall through — verifyCredentials can still confirm the token by listing spaces
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
	 * Sanity-check credentials by listing spaces (the cheapest authenticated Chat call; the googleApi
	 * refreshes the access token once on a 401). Returns `ok:false` rather than throwing so the caller
	 * can mark the connection `error`/`needs-reconnect` cleanly.
	 */
	async verifyCredentials(credentials: IProviderCredentials): Promise<IVerifiedConnection> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(credentials);
		try {
			// A 1-item spaces listing proves the delegated token is valid for Chat.
			await googleFetch<{ spaces?: unknown[] }>(`${CHAT_BASE}/spaces?pageSize=1`, tokens);
			const externalOrgId = (typeof credentials.externalOrgId === 'string' && credentials.externalOrgId) || '';
			const externalOrgName = externalOrgId ? `Google Chat (${externalOrgId})` : 'Google Chat';
			return { ok: true, externalOrgId, externalOrgName, scopes: GOOGLE_DELEGATED_SCOPES };
		} catch (err) {
			return { ok: false, externalOrgId: String(credentials.externalOrgId || ''), externalOrgName: '', scopes: [] };
		}
	}

	/**
	 * Tear down live resources for this connection. No sockets/subscriptions exist yet (realtime is
	 * the next milestone), so this is a no-op today — disconnect at the record level is handled by
	 * connectionService.
	 */
	async disconnect(connection: IProviderConnection): Promise<void> {
		// Clean up the cached user→DM space mapping when the connection is torn down.
		userToDmSpaceCache.delete(connection.connectionId);
	}

	/**
	 * Canonicalize a channel/space id before persisting in a bridge record. When the People
	 * directory is used to bridge a person, it passes the user resource name (`users/{id}`),
	 * but Google Chat's message endpoints (syncMessages/postMessage) require the space resource
	 * name (`spaces/{id}`). This resolves user ids to their corresponding DM space via
	 * `spaces.findDirectMessage` (creates the DM if it doesn't exist yet) and caches the result
	 * to avoid repeated lookups.
	 */
	async resolveBridgeChannelId(connection: IProviderConnection, channelExternalId: string): Promise<string> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		// If it's already a space id, return it unchanged.
		if (channelExternalId.startsWith('spaces/')) {
			return channelExternalId;
		}
		// If it's not a user id, return unchanged (best-effort: let the caller's logic handle it).
		if (!channelExternalId.startsWith('users/')) {
			return channelExternalId;
		}

		// Check cache for this connection's user→space mapping.
		let connectionCache = userToDmSpaceCache.get(connection.connectionId);
		if (connectionCache?.has(channelExternalId)) {
			return connectionCache.get(channelExternalId) || channelExternalId;
		}

		// Miss: look up the DM space via spaces.findDirectMessage.
		const { tokens, onRefreshed } = tokensAndHook(connection);
		try {
			const response = await googleFetch<{ space?: string }>(
				`${CHAT_BASE}/spaces:findDirectMessage?displayName=${encodeURIComponent(channelExternalId)}`,
				tokens,
				{},
				onRefreshed,
			);
			const spaceId = response.space;
			if (spaceId) {
				// Cache the mapping for this connection.
				if (!connectionCache) {
					connectionCache = new Map();
					userToDmSpaceCache.set(connection.connectionId, connectionCache);
				}
				connectionCache.set(channelExternalId, spaceId);
				return spaceId;
			}
		} catch (err) {
			SystemLogger.debug({
				msg: 'Google Chat DM space resolution failed (using raw user id)',
				connectionId: connection.connectionId,
				userId: channelExternalId,
				err: String(err),
			});
		}

		// Fallback: return the raw user id (will likely fail downstream with a clear error).
		return channelExternalId;
	}

	// ─── discovery ─────────────────────────────────────────────────────────────────────────────

	/**
	 * List the NAMED-SPACE channels visible to this connection's user: GET /v1/spaces, paged via
	 * nextPageToken, the `SPACE` (legacy `ROOM`) spaces mapped to IProviderChannel. The space resource
	 * name (`spaces/{id}`) IS the channel id, passed straight to the messages endpoints. DM-type spaces
	 * (DIRECT_MESSAGE / GROUP_CHAT) are EXCLUDED here — they surface via listDirectChats instead, so a
	 * DM never appears both as a "private channel" and as a "Chat".
	 */
	async listChannels(connection: IProviderConnection): Promise<IProviderChannel[]> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);

		const spaces = await googleGetAll<GoogleSpace>(`${CHAT_BASE}/spaces?pageSize=100`, 'spaces', tokens, onRefreshed);

		const channels: IProviderChannel[] = [];
		for (const space of spaces) {
			if (!space?.name) {
				continue;
			}
			// spaceType is the current field; `type` is the legacy field (ROOM/DM) — tolerate both.
			const spaceType = space.spaceType || space.type || '';
			// Channels are named spaces only; DMs/group DMs are listDirectChats' job.
			if (spaceType !== 'SPACE' && spaceType !== 'ROOM') {
				continue;
			}
			// "Feel-alive" fields (all OPTIONAL on the contract, all best-effort here):
			//  - lastActivity: from the space's lastActiveTime when present (epoch-ms) — drives recency sort.
			//  - unreadCount/mentionCount: the Chat REST API does NOT expose per-space unread for an
			//    app/user token cheaply, so we report 0 (honest; see unreadSummary + the caveats).
			const lastActivity = lastActivityMs(space);
			channels.push({
				// The space resource name is the channel id — passed straight to the messages endpoints.
				externalId: space.name,
				name: space.displayName || space.name,
				// A named SPACE can still be a private/restricted space; without an extra field on the
				// list payload we treat named spaces as non-private (matches the channels-section intent).
				isPrivate: false,
				unreadCount: 0,
				mentionCount: 0,
				...(lastActivity !== undefined ? { lastActivity } : {}),
			});
		}
		return channels;
	}

	/**
	 * List the user's direct chats — 1:1 (DIRECT_MESSAGE) and group DMs (GROUP_CHAT) — for the "Chats"
	 * section: GET /v1/spaces (the same spaces.list listChannels reads), keeping only the DM-type spaces.
	 * The `externalId` is the space resource name (addressed via /v1/{space}/messages for read/post, same
	 * as a channel — syncMessages/postMessage accept it unchanged). `isGroup` is true for GROUP_CHAT.
	 *
	 * Naming: a Google DM space has no useful displayName, so we name it by its member(s) via
	 * spaces.members.list (chat.memberships.readonly), joining the human members' display names. (Google
	 * Chat memberships do not flag which membership is the signed-in user, so we label by all human
	 * members rather than excluding self.) When the membership lookup yields nothing usable we fall back
	 * to the space displayName, then the resource id, so the chat always has a label.
	 *
	 * The top-level spaces.list call surfaces Google errors ({error:{code,message,status}}) UNSWALLOWED
	 * via googleGetAll; a single per-space membership failure is logged + tolerated (the DM still lists,
	 * named by its fallback label) so one inaccessible space does not blank the whole Chats section.
	 */
	async listDirectChats(connection: IProviderConnection): Promise<IProviderDirectChat[]> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);

		const spaces = await googleGetAll<GoogleSpace>(`${CHAT_BASE}/spaces?pageSize=100`, 'spaces', tokens, onRefreshed);

		const out: IProviderDirectChat[] = [];
		for (const space of spaces) {
			if (!space?.name) {
				continue;
			}
			const spaceType = space.spaceType || space.type || '';
			// Only DM-type spaces: DIRECT_MESSAGE (1:1) and GROUP_CHAT (group DM). Skip SPACE/ROOM.
			const isDm = spaceType === 'DIRECT_MESSAGE';
			const isGroupChat = spaceType === 'GROUP_CHAT';
			if (!isDm && !isGroupChat) {
				continue;
			}

			// Name the DM by its members. spaces.list does not inline members, so look them up per space.
			let members: GoogleChatUser[] = [];
			try {
				members = await fetchSpaceMembers(space.name, tokens, onRefreshed);
			} catch (err) {
				// A per-space membership read can fail (e.g. a space we can no longer enumerate members of);
				// don't drop the whole DM list for one space — fall back to the space's own label below.
				SystemLogger.debug({ msg: 'Google Chat listDirectChats member lookup failed for a space', space: space.name, err: String(err) });
			}

			const memberNames = members.map((m) => m.displayName).filter((n): n is string => Boolean(n));
			const memberExternalIds = members.map((m) => m.name).filter((id): id is string => Boolean(id));

			// Prefer the joined member display names (the other people in the DM). Group DMs may also carry a
			// displayName; fall back to it, then to the resource id, so the chat always has a label.
			const name = (memberNames.length ? memberNames.join(', ') : '') || space.displayName || space.name;

			// "Feel-alive" fields (all OPTIONAL, all best-effort):
			//  - lastActivity: space lastActiveTime → epoch-ms, when present.
			//  - avatarUrl: the other member's avatar IF the membership User carries one (it does NOT today
			//    on the Chat API, so this is in practice undefined — see caveats). For a 1:1 we take the
			//    first human member's avatar; we don't synthesize an avatar for group DMs.
			//  - presence: the Chat API has NO presence concept, so it's left undefined (see caveats).
			//  - unreadCount/mentionCount: per-space unread is not exposed cheaply → 0 (honest; see caveats).
			const lastActivity = lastActivityMs(space);
			const avatarUrl = !isGroupChat ? members.find((m) => Boolean(m.avatarUrl))?.avatarUrl : undefined;

			out.push({
				externalId: space.name,
				name,
				isGroup: isGroupChat,
				...(memberExternalIds.length ? { memberExternalIds } : {}),
				unreadCount: 0,
				mentionCount: 0,
				...(lastActivity !== undefined ? { lastActivity } : {}),
				...(avatarUrl ? { avatarUrl } : {}),
			});
		}
		return out;
	}

	/**
	 * List the org/workspace people for the "People" section by aggregating members across ALL the
	 * spaces the signed-in user can see: GET /v1/spaces, then GET /v1/{space}/members per space
	 * (spaces.members.list), deduped by the `users/{id}` resource name. Requires the delegated
	 * `chat.memberships.readonly` scope. Each human member maps to IProviderMember { externalId: user
	 * resource name, displayName }. Google Chat memberships do NOT carry an email on the User block, so
	 * `email` is omitted. Google errors ({error:{code,message,status}}) are surfaced UNSWALLOWED by
	 * googleGetAll (the spaces.list / first members call); a single later per-space failure is logged
	 * and skipped so one inaccessible space does not blank the whole roster.
	 */
	async listMembers(connection: IProviderConnection): Promise<IProviderMember[]> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);

		const spaces = await googleGetAll<GoogleSpace>(`${CHAT_BASE}/spaces?pageSize=100`, 'spaces', tokens, onRefreshed);

		// Dedupe people across spaces by their `users/{id}` resource name (one person is in many spaces).
		const byUserId = new Map<string, IProviderMember>();
		let surfacedFirst = false;
		for (const space of spaces) {
			if (!space?.name) {
				continue;
			}
			let members: GoogleChatUser[];
			try {
				members = await fetchSpaceMembers(space.name, tokens, onRefreshed);
				surfacedFirst = true;
			} catch (err) {
				// Surface the FIRST failure unswallowed (likely the chat.memberships.readonly scope not yet
				// consented) so the caller shows a real error rather than a silently-empty roster. Once we've
				// read at least one space's members, tolerate a later per-space failure and keep going.
				if (!surfacedFirst) {
					throw err;
				}
				SystemLogger.debug({ msg: 'Google Chat listMembers member lookup failed for a space', space: space.name, err: String(err) });
				continue;
			}
			for (const m of members) {
				const externalId = m.name;
				if (!externalId || byUserId.has(externalId)) {
					continue;
				}
				// Skip non-human principals (Chat apps) from the People roster.
				if (m.type && m.type !== 'HUMAN') {
					continue;
				}
				byUserId.set(externalId, {
					externalId,
					displayName: m.displayName || externalId,
					// avatarUrl rides through ONLY if the membership User carries one — the Chat API does not
					// populate a photo on this block today, so in practice this stays undefined (see caveats).
					...(m.avatarUrl ? { avatarUrl: m.avatarUrl } : {}),
					// presence: the Chat API has no presence concept — left undefined (see caveats).
				});
			}
		}
		return [...byUserId.values()];
	}

	// ─── sync (read) — REAL ──────────────────────────────────────────────────────────────────────

	/**
	 * Read a space's messages: GET /v1/{space}/messages?pageSize=50&orderBy=createTime%20desc, paged via nextPageToken up to
	 * MAX_MESSAGE_PAGES. Fetches NEWEST messages first (descending order), then reverses to maintain the
	 * ascending order contract documented below. Each Google message is mapped to IProviderMessage — author from
	 * `sender.displayName` (falls back to the sender resource name), text from `text`, `ts` from
	 * `createTime`. Messages without text (pure attachments/cards) still flow through with empty text.
	 *
	 * `channelExternalId` is the `spaces/{id}` resource name listChannels emitted. `since` is an
	 * optional ISO timestamp; messages at/older than it are skipped client-side. Returns messages in
	 * ASCENDING create time order (oldest first).
	 */
	async *syncMessages(connection: IProviderConnection, channelExternalId: string, since?: string): AsyncIterable<IProviderMessage> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);
		const space = toSpaceName(channelExternalId);

		type GoogleSender = { name?: string; displayName?: string; type?: string };
		type GoogleMessage = {
			name?: string;
			text?: string;
			createTime?: string;
			lastUpdateTime?: string;
			sender?: GoogleSender;
		};

		const sinceMs = since ? Date.parse(since) : NaN;
		const hasSince = !Number.isNaN(sinceMs);

		let pageToken: string | undefined;
		let pages = 0;
		const collectedMessages: IProviderMessage[] = [];

		while (pages < MAX_MESSAGE_PAGES) {
			const url = new URL(`${CHAT_BASE}/${space}/messages`);
			url.searchParams.set('pageSize', String(MESSAGE_PAGE_SIZE));
			// Fetch newest messages first (descending order) so we get the latest messages in big spaces.
			url.searchParams.set('orderBy', 'createTime desc');
			if (pageToken) {
				url.searchParams.set('pageToken', pageToken);
			}

			const page = await googleFetch<{ messages?: GoogleMessage[]; nextPageToken?: string }>(url.toString(), tokens, {}, onRefreshed);
			pages++;

			for (const msg of page.messages || []) {
				if (!msg?.name) {
					continue;
				}
				const ts = msg.createTime || '';
				if (hasSince && ts) {
					const tsMs = Date.parse(ts);
					if (!Number.isNaN(tsMs) && tsMs <= sinceMs) {
						continue;
					}
				}

				const authorId = msg.sender?.name || '';
				const authorName = msg.sender?.displayName;

				collectedMessages.push({
					externalId: msg.name,
					channelExternalId,
					authorExternalId: authorId,
					// Display name rides on the message (`sender.displayName`), so the UI can render a name
					// without a separate resolveIdentity lookup. Falls back to the sender id at the client.
					...(authorName ? { authorDisplayName: authorName } : {}),
					text: msg.text || '',
					ts,
					...(msg.lastUpdateTime && msg.lastUpdateTime !== msg.createTime ? { editedTs: msg.lastUpdateTime } : {}),
				});
			}

			pageToken = page.nextPageToken;
			if (!pageToken) {
				break;
			}
		}

		// Reverse collected messages to restore ascending order (oldest first) before yielding.
		collectedMessages.reverse();
		for (const msg of collectedMessages) {
			yield msg;
		}
	}

	async subscribe(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_onMessage: InboundMessageHandler,
	): Promise<IProviderSubscription> {
		// TODO(next milestone): Google Chat has no generic per-space push to an OAuth client; the
		// realtime path is either polling on a per-connection toggle or a Chat app + Pub/Sub event sub.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── identity — NEXT MILESTONE ───────────────────────────────────────────────────────────────

	async resolveIdentity(_connection: IProviderConnection, _externalUserId: string): Promise<IProviderUser | null> {
		// TODO(next milestone): resolve from the message `sender` block carried in each payload.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── write — REAL ────────────────────────────────────────────────────────────────────────────

	/**
	 * Post a message to a space AS the signed-in user (delegated chat.messages.create):
	 * POST /v1/{space}/messages with `{ text }`. Returns the created message resource name as the
	 * externalId. Google API errors ({error:{code,message,status}}) are surfaced unswallowed by
	 * googleFetch.
	 *
	 * `channelExternalId` is the `spaces/{id}` resource name listChannels emitted.
	 */
	async postMessage(
		connection: IProviderConnection,
		channelExternalId: string,
		message: IOutboundMessage,
	): Promise<{ externalId: string }> {
		if (!isGoogleConfigured()) {
			return notConfigured();
		}
		const text = message?.text;
		if (typeof text !== 'string' || !text.trim()) {
			throw new Error('google_empty_message');
		}
		const { tokens, onRefreshed } = tokensAndHook(connection);
		const space = toSpaceName(channelExternalId);

		const created = await googleFetch<{ name?: string }>(
			`${CHAT_BASE}/${space}/messages`,
			tokens,
			{
				method: 'POST',
				body: { text },
			},
			onRefreshed,
		);
		if (!created?.name) {
			throw new Error('google_post_no_message_id');
		}
		return { externalId: created.name };
	}

	// ─── notifications / "feel-alive" — best-effort, HONEST ───────────────────────────────────────

	/**
	 * Mark a channel OR direct chat read in the external workspace. `externalId` is a `spaces/{id}`
	 * resource name (channel from listChannels OR direct chat from listDirectChats — both are spaces, so
	 * no detection branch is needed). NO-OP today: the Google Chat REST API has no cheap per-space
	 * mark-read for an app/user OAuth token (read state lives behind chat.users.readstate, which is not in
	 * our delegated scope set), so we resolve void without a call. The mark-read endpoint still acks ok —
	 * the service layer treats a no-op markRead as success. (See caveats.)
	 */
	async markRead(_connection: IProviderConnection, _externalId: string): Promise<void> {
		// Intentionally a no-op: no cheap Chat REST mark-read for a delegated OAuth token. Best-effort
		// contract satisfied; the caller's unread badge is driven by unreadSummary (which is honest 0/0).
	}

	/**
	 * Roll up this connection's total unread + mention counts. HONEST 0/0: the Google Chat REST API does
	 * not expose an unread/mention aggregate for an app/user OAuth token cheaply (no equivalent of Slack's
	 * counts or a per-space unread field on spaces.list), so rather than guess we report zero. Returns
	 * plain integers per the contract. (See caveats — this is a known Chat API limitation, not a stub bug.)
	 */
	async unreadSummary(_connection: IProviderConnection): Promise<{ unreadCount: number; mentionCount: number }> {
		return { unreadCount: 0, mentionCount: 0 };
	}
}
