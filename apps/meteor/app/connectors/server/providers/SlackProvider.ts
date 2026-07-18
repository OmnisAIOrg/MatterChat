/**
 * SlackProvider — Slack Web API implementation of IChatProvider.
 *
 * Per-user DELEGATED OAuth on the Slack Web API; clean-room from the Slack docs — nothing under
 * apps/meteor/ee/ was read or copied. Mirrors TeamsProvider + GoogleChatProvider. Slack is SIMPLER
 * than Teams on addressing: a conversation id (`C…`/`G…`/`D…`/`mpim`) IS the channel id, so there is
 * NO composite encode/decode — the `externalId` is passed straight to conversations.history /
 * chat.postMessage. Channels AND direct chats are both Slack "conversations", so reading/posting use
 * the same endpoints regardless of which list the id came from (listChannels vs listDirectChats).
 *
 * WHAT IS REAL:
 *   - connect            → completes the OAuth code exchange (the same exchange the
 *                          /_slack/oauth/callback route runs) and returns usable credentials. USER
 *                          token (authed_user.access_token); acts AS the signed-in user.
 *   - verifyCredentials  → auth.test (cheapest authenticated call) to confirm the token + resolve the
 *                          team id/name.
 *   - listChannels       → conversations.list types=public_channel,private_channel (cursor-paged),
 *                          each mapped to IProviderChannel { externalId: channel id, name, isPrivate }.
 *   - listDirectChats    → conversations.list types=im,mpim (cursor-paged); 1:1 (im) names resolved
 *                          via users.info on the `user` field, group (mpim) names from the channel name.
 *   - listMembers        → users.list (cursor-paged), bots + deleted skipped, mapped to IProviderMember.
 *   - syncMessages       → conversations.history?limit=50 (cursor-paged, newest-first), each mapped to
 *                          IProviderMessage (author from `user`, text, `ts`). Subtype/bot messages skipped.
 *   - postMessage        → chat.postMessage AS the signed-in user. Returns the created message `ts`.
 *
 *   - subscribe          → REAL (Events API): Slack realtime is the app-level Events API endpoint
 *                          (/_slack/events — see ./slack/events.ts), verified by the signing secret.
 *                          There is NO per-channel subscription to create (the app-level event
 *                          subscription covers every visible channel), so subscribe just confirms
 *                          the inbound transport is configured and returns a no-op handle.
 *   - resolveIdentity    → users.info on the external user id, mapped to IProviderUser.
 *
 * SLACK `ok:false` IS SURFACED, NEVER SWALLOWED: the Slack Web API returns HTTP 200 with
 * `{ ok:false, error }` for logical errors (missing_scope, channel_not_found, invalid_auth). slackApi
 * throws those as `slack_error:<error>` so a logical failure never masquerades as an empty success.
 *
 * STANDALONE-SAFE: every live method throws `slack_not_configured` when the connector is disabled or
 * no client secret is set, so a fresh MatterChat with Slack off has zero Slack behavior.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.1 + §3.
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
	getSlackConfig,
	isSlackConfigured,
	isSlackEventsConfigured,
	SLACK_TOKEN_ENDPOINT,
	redirectUri,
	SLACK_USER_SCOPES,
} from './slack/config';
import type { SlackTokens } from './slack/slackApi';
import { slackFetch, slackGetAll } from './slack/slackApi';

// Mounting the OAuth routes is a side-effect of importing this provider, so booting the connectors
// index (which constructs the registry with `new SlackProvider()`) also wires /_slack/oauth.
// (The /_slack/events inbound endpoint is mounted by the connectors server index, mirroring how
// the Teams webhook is mounted there.)
import './slack/routes';

function notConfigured(): never {
	throw new Error('slack_not_configured');
}

/** How many message pages (×limit) to read in one syncMessages call — a reasonable backfill cap. */
const MAX_MESSAGE_PAGES = 5;
const MESSAGE_PAGE_SIZE = 50;
/** Page size for the conversations/users list endpoints (Slack caps conversations.list at 1000). */
const LIST_PAGE_SIZE = 200;

/**
 * Cap on the number of per-user profile/presence lookups (users.info + users.getPresence) done while
 * enriching a list — so a huge workspace roster or DM list doesn't fan out into hundreds of extra
 * Slack calls and trip rate limits. Past the cap, name/avatar/presence simply stay at whatever was
 * already resolved (name still falls back to the user id; avatar/presence stay undefined).
 */
const MAX_PROFILE_LOOKUPS = 60;

/** Slack `ts` ("seconds.micros") → epoch ms, or undefined when absent/unparseable. */
function tsToEpochMs(ts?: string): number | undefined {
	if (!ts) {
		return undefined;
	}
	const seconds = parseFloat(ts);
	return Number.isNaN(seconds) ? undefined : Math.round(seconds * 1000);
}

/** Map a Slack `users.getPresence` presence string onto the contract enum. */
function mapPresence(presence?: string): 'active' | 'away' | 'dnd' | 'offline' | undefined {
	if (presence === 'active') {
		return 'active';
	}
	if (presence === 'away') {
		return 'away';
	}
	return undefined;
}

/** Build the SlackTokens bundle the slackApi reads from stored credentials. */
function tokensFromCredentials(credentials: IProviderCredentials): SlackTokens {
	if (!credentials?.accessToken) {
		throw new Error('slack_missing_access_token');
	}
	return { accessToken: credentials.accessToken };
}

/** A user's resolved profile (users.info): display name + avatar, shared by DMs + message enrichment. */
type SlackProfile = { name: string; avatarUrl?: string };

/** The users.info response slice the profile resolver reads. */
type SlackUserInfoResponse = {
	user?: {
		real_name?: string;
		profile?: { display_name?: string; real_name?: string; image_72?: string; image_48?: string };
		name?: string;
	};
};

/** Mention token pattern in raw Slack message text: `<@U123ABC>` / `<@W…>` (user/workspace-user ids). */
const MENTION_TOKEN = /<@([UW][A-Z0-9]+)>/g;

/**
 * Extract the UNIQUE mentioned user ids (`U…`/`W…`) from a raw Slack message text. Pure — channel
 * mentions (`<#C…>`), special mentions (`<!here>`) and plain `@name` text are ignored.
 */
export function extractMentionIds(text: string): string[] {
	const ids = new Set<string>();
	for (const match of text.matchAll(MENTION_TOKEN)) {
		ids.add(match[1]);
	}
	return [...ids];
}

/** The raw Slack history message slice syncMessages maps (already filtered to human messages). */
type SlackHistoryMessage = {
	ts: string;
	user: string;
	text?: string;
	thread_ts?: string;
	edited?: { ts?: string };
};

/**
 * Map ONE raw Slack history message to the enriched IProviderMessage:
 *  - author display name + avatar via the (capped, cached) profile resolver — omitted when the
 *    resolver fell back to the raw id, so the client's own id-fallback stays authoritative;
 *  - `<@U123>` mention tokens resolved to a { id → display name } map. The text itself is NOT
 *    rewritten — the client renderer owns presentation — and id-fallback entries are dropped.
 */
async function enrichSlackMessage(
	msg: SlackHistoryMessage,
	channelExternalId: string,
	resolveProfile: (userId: string) => Promise<SlackProfile>,
): Promise<IProviderMessage> {
	const authorProfile = await resolveProfile(msg.user);

	const text = msg.text || '';
	const mentions: Record<string, string> = {};
	for (const mentionId of extractMentionIds(text)) {
		const profile = await resolveProfile(mentionId);
		if (profile.name !== mentionId) {
			mentions[mentionId] = profile.name;
		}
	}

	return {
		externalId: msg.ts,
		channelExternalId,
		authorExternalId: msg.user,
		...(authorProfile.name !== msg.user ? { authorDisplayName: authorProfile.name } : {}),
		...(authorProfile.avatarUrl ? { authorAvatarUrl: authorProfile.avatarUrl } : {}),
		text,
		ts: msg.ts,
		...(Object.keys(mentions).length ? { mentions } : {}),
		...(msg.thread_ts && msg.thread_ts !== msg.ts ? { threadExternalId: msg.thread_ts } : {}),
		...(msg.edited?.ts ? { editedTs: msg.edited.ts } : {}),
	};
}

export class SlackProvider implements IChatProvider {
	readonly provider = 'slack' as const;

	/**
	 * Build a PER-CALL profile resolver: users.info per user, cached so a user appearing many times
	 * costs ONE lookup, capped at MAX_PROFILE_LOOKUPS so a huge roster/DM list/history can't fan out
	 * into hundreds of Slack calls and trip rate limits. Past the cap (or on any per-user error) the
	 * name falls back to the user id and the avatar stays undefined — a single unresolved user never
	 * fails the caller. Cache hits never count against the cap.
	 *
	 * Shared by listDirectChats (DM names/avatars) and syncMessages (author + mention enrichment) so
	 * both resolve identically: display_name || real_name || profile.real_name || name || id.
	 */
	private createProfileResolver(tokens: SlackTokens): (userId: string) => Promise<SlackProfile> {
		const profileCache = new Map<string, SlackProfile>();
		let profileLookups = 0;
		return async (userId: string): Promise<SlackProfile> => {
			const cached = profileCache.get(userId);
			if (cached) {
				return cached;
			}
			if (profileLookups >= MAX_PROFILE_LOOKUPS) {
				const fallback = { name: userId };
				profileCache.set(userId, fallback);
				return fallback;
			}
			profileLookups++;
			try {
				const info = await slackFetch<SlackUserInfoResponse>('users.info', tokens, { method: 'GET', params: { user: userId } });
				const u = info.user || {};
				const name = u.profile?.display_name || u.real_name || u.profile?.real_name || u.name || userId;
				const avatarUrl = u.profile?.image_72 || u.profile?.image_48 || undefined;
				const entry: SlackProfile = { name, ...(avatarUrl ? { avatarUrl } : {}) };
				profileCache.set(userId, entry);
				return entry;
			} catch (err) {
				// A single unresolved user must not fail the whole call — fall back to the id.
				const fallback = { name: userId };
				profileCache.set(userId, fallback);
				return fallback;
			}
		};
	}

	// ─── auth / lifecycle ──────────────────────────────────────────────────────────────────────

	/**
	 * Complete the OAuth code exchange and return usable credentials. The primary connect flow is the
	 * browser redirect handled by ./slack/routes.ts (which persists the connection itself); this method
	 * exists so the IChatProvider contract is honored and callers that already hold an auth code can
	 * complete the exchange programmatically. Returns the USER token (authed_user.access_token).
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
			ignoreSsrfValidation: true, // Slack token host, not user input
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
		// Slack reports failures via ok:false (HTTP 200) — surface, don't swallow.
		if (!tokens?.ok) {
			throw new Error(`slack_token_exchange_failed:${tokens?.error || res.status}`);
		}
		const authedUser = tokens.authed_user || {};
		if (!authedUser.access_token) {
			throw new Error('slack_no_user_token');
		}
		const team = tokens.team || {};

		return {
			accessToken: authedUser.access_token,
			externalOrgId: String(team.id || tokens.team_id || ''),
			externalSlackUserId: authedUser.id || undefined,
		};
	}

	/**
	 * Sanity-check credentials with auth.test (the cheapest authenticated Slack call; resolves the team
	 * id + name + the signed-in user). Returns `ok:false` rather than throwing so the caller can mark
	 * the connection `error`/`needs-reconnect` cleanly.
	 */
	async verifyCredentials(credentials: IProviderCredentials): Promise<IVerifiedConnection> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(credentials);
		try {
			const test = await slackFetch<{ team?: string; team_id?: string; user_id?: string }>('auth.test', tokens, { method: 'GET' });
			const externalOrgId = String(test.team_id || credentials.externalOrgId || '');
			const externalOrgName = test.team ? `Slack (${test.team})` : 'Slack';
			return {
				ok: Boolean(test.user_id),
				externalOrgId,
				externalOrgName,
				scopes: SLACK_USER_SCOPES,
			};
		} catch (err) {
			return { ok: false, externalOrgId: String(credentials.externalOrgId || ''), externalOrgName: '', scopes: [] };
		}
	}

	/**
	 * Tear down live resources for this connection. Slack realtime rides the APP-LEVEL Events API
	 * (nothing per-connection lives on Slack's side — unlike Teams' per-channel Graph
	 * subscriptions), so this is a no-op: once the connection record goes away, the events endpoint
	 * simply finds no bridge to fan out to. Disconnect at the record level is handled by
	 * connectionService.
	 */
	async disconnect(_connection: IProviderConnection): Promise<void> {
		// App-level Events API: no per-connection Slack-side resources to release.
	}

	// ─── discovery ─────────────────────────────────────────────────────────────────────────────

	/**
	 * List the public + private channels visible to this connection's user:
	 * conversations.list?types=public_channel,private_channel, cursor-paged via
	 * `response_metadata.next_cursor`. The conversation id IS the channel id (passed straight to the
	 * messages endpoints). `isPrivate` from the `is_private` flag; `topic` from `topic.value`.
	 * Archived channels are excluded (`exclude_archived=true`).
	 */
	async listChannels(connection: IProviderConnection): Promise<IProviderChannel[]> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(connection.credentials);

		type SlackChannel = {
			id?: string;
			name?: string;
			is_private?: boolean;
			is_archived?: boolean;
			topic?: { value?: string };
			/** Per-conversation unread count (only present with the right scope / on member channels). */
			unread_count_display?: number;
			/** The conversation's most-recent message, when Slack includes it. */
			latest?: { ts?: string };
		};

		const channels = await slackGetAll<SlackChannel>('conversations.list', 'channels', tokens, {
			types: 'public_channel,private_channel',
			exclude_archived: true,
			limit: LIST_PAGE_SIZE,
		});

		const out: IProviderChannel[] = [];
		for (const ch of channels) {
			if (!ch?.id) {
				continue;
			}
			// "Feel-alive" fields are additive and best-effort: a missing scope just leaves them absent.
			const lastActivity = tsToEpochMs(ch.latest?.ts);
			out.push({
				// The Slack conversation id is the channel id — passed straight to the messages endpoints.
				externalId: ch.id,
				name: ch.name || ch.id,
				isPrivate: Boolean(ch.is_private),
				...(ch.topic?.value ? { topic: ch.topic.value } : {}),
				...(typeof ch.unread_count_display === 'number' ? { unreadCount: ch.unread_count_display } : {}),
				// mentionCount intentionally left unset (defaults to 0 client-side) — Slack has no cheap
				// per-conversation mention count.
				...(lastActivity !== undefined ? { lastActivity } : {}),
			});
		}
		return out;
	}

	// ─── direct chats (DMs) — REAL ────────────────────────────────────────────────────────────────

	/**
	 * List the user's direct chats — 1:1 (im) and group DMs (mpim) — for the "Chats" section:
	 * conversations.list?types=im,mpim, cursor-paged. `externalId` is the conversation id (addressed via
	 * conversations.history / chat.postMessage — same endpoints as channels). For a 1:1 (im), Slack only
	 * carries the OTHER user's id on the `user` field, so we resolve the display name via users.info
	 * (cached per call so a user appearing in several DMs costs one lookup). For a group DM (mpim), the
	 * participant display names are resolved (conversations.members + users.info) into "A, B, C". Slack `ok:false` (e.g.
	 * missing im:read/mpim:read scope) is surfaced UNswallowed by slackApi.
	 */
	async listDirectChats(connection: IProviderConnection): Promise<IProviderDirectChat[]> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(connection.credentials);

		type SlackConversation = {
			id?: string;
			is_im?: boolean;
			is_mpim?: boolean;
			is_user_deleted?: boolean;
			/** 1:1 DM: the OTHER member's user id. */
			user?: string;
			/** group DM (mpim): Slack's joined-handles label, e.g. `mpdm-alice--bob--carol-1`. */
			name?: string;
			/** Per-conversation unread count for this DM ("feel-alive" badge), when scope allows. */
			unread_count_display?: number;
			/** The DM's most-recent message, when Slack includes it. */
			latest?: { ts?: string };
		};

		const conversations = await slackGetAll<SlackConversation>('conversations.list', 'channels', tokens, {
			types: 'im,mpim',
			exclude_archived: true,
			limit: LIST_PAGE_SIZE,
		});

		// Per-user profile cache (name+avatar) — the SHARED capped users.info resolver, so one user
		// costs one lookup regardless of how many DMs/groups they appear in.
		const resolveProfile = this.createProfileResolver(tokens);
		const presenceCache = new Map<string, 'active' | 'away' | 'dnd' | 'offline' | undefined>();

		// Name-only resolver kept for group-DM membership (where avatars/presence aren't surfaced).
		const resolveUserName = async (userId: string): Promise<string> => (await resolveProfile(userId)).name;

		// Resolve (and cache) a user's presence via users.getPresence. Capped (shares MAX with profile
		// lookups conceptually but tracked separately so presence still resolves for the first N peers).
		// A missing presence scope just leaves presence undefined — never throws the list.
		let presenceLookups = 0;
		const resolvePresence = async (userId: string): Promise<'active' | 'away' | 'dnd' | 'offline' | undefined> => {
			if (presenceCache.has(userId)) {
				return presenceCache.get(userId);
			}
			if (presenceLookups >= MAX_PROFILE_LOOKUPS) {
				presenceCache.set(userId, undefined);
				return undefined;
			}
			presenceLookups++;
			try {
				const res = await slackFetch<{ presence?: string }>('users.getPresence', tokens, {
					method: 'GET',
					params: { user: userId },
				});
				const presence = mapPresence(res.presence);
				presenceCache.set(userId, presence);
				return presence;
			} catch (err) {
				presenceCache.set(userId, undefined);
				return undefined;
			}
		};

		// conversations.list does NOT carry unread_count_display or `latest` — those need conversations.info
		// PER conversation. Fetch it (capped + cached) so DM unread badges + recency sort actually populate.
		// VERIFY LIVE: a USER token returns unread_count_display on conversations.info for the caller's own
		// DMs; Tier-3 rate limits bound how many we enrich per call (MAX_PROFILE_LOOKUPS), past which the
		// row simply has no badge rather than erroring.
		const infoCache = new Map<string, { unreadCount?: number; lastActivity?: number }>();
		let infoLookups = 0;
		const enrichUnread = async (channelId: string): Promise<{ unreadCount?: number; lastActivity?: number }> => {
			const cached = infoCache.get(channelId);
			if (cached) {
				return cached;
			}
			if (infoLookups >= MAX_PROFILE_LOOKUPS) {
				return {};
			}
			infoLookups++;
			try {
				const res = await slackFetch<{ channel?: { unread_count_display?: number; latest?: { ts?: string } } }>(
					'conversations.info',
					tokens,
					{ method: 'GET', params: { channel: channelId } },
				);
				const ch = res.channel || {};
				const entry: { unreadCount?: number; lastActivity?: number } = {};
				if (typeof ch.unread_count_display === 'number') {
					entry.unreadCount = ch.unread_count_display;
				}
				const ms = tsToEpochMs(ch.latest?.ts);
				if (ms !== undefined) {
					entry.lastActivity = ms;
				}
				infoCache.set(channelId, entry);
				return entry;
			} catch {
				return {};
			}
		};

		// The current user's id, so a group DM reads by the OTHER members (like Slack) — best-effort.
		let selfId: string | undefined;
		try {
			const auth = await slackFetch<{ user_id?: string }>('auth.test', tokens, { method: 'GET' });
			selfId = auth.user_id;
		} catch {
			selfId = undefined;
		}

		// Group-DM (mpim) name = the other participants' display names, e.g. "Gunit, Jaimin Vaghani" —
		// resolved from conversations.members + users.info (cached above). Falls back to Slack's raw
		// joined-handles label ONLY if membership can't be read (e.g. a scope gap), so a row is never blank.
		const resolveGroupName = async (channelId: string, fallback: string): Promise<{ name: string; memberIds: string[] }> => {
			try {
				const res = await slackFetch<{ members?: string[] }>('conversations.members', tokens, {
					method: 'GET',
					params: { channel: channelId, limit: 100 },
				});
				const ids = (res.members || []).filter((id) => Boolean(id) && id !== selfId);
				if (ids.length === 0) {
					return { name: fallback, memberIds: [] };
				}
				const names = await Promise.all(ids.map((id) => resolveUserName(id)));
				const shown = names.slice(0, 4).join(', ');
				return { name: names.length > 4 ? `${shown} +${names.length - 4}` : shown, memberIds: ids };
			} catch {
				return { name: fallback, memberIds: [] };
			}
		};

		const out: IProviderDirectChat[] = [];
		for (const conv of conversations) {
			if (!conv?.id || conv.is_user_deleted) {
				continue;
			}
			const isGroup = Boolean(conv.is_mpim);
			// Shared "feel-alive" fields — additive, best-effort. conversations.list omits unread/latest, so
			// conversations.info (capped, cached) supplies them; a missing scope/cap just leaves them absent.
			const enriched = await enrichUnread(conv.id);
			const unread = enriched.unreadCount !== undefined ? { unreadCount: enriched.unreadCount } : {};
			const lastActivity = enriched.lastActivity !== undefined ? { lastActivity: enriched.lastActivity } : {};
			if (isGroup) {
				// mpim: real participant names ("Gunit, Jaimin Vaghani"), not Slack's raw mpdm-… label.
				const { name, memberIds } = await resolveGroupName(conv.id, conv.name || conv.id);
				out.push({
					externalId: conv.id,
					name,
					isGroup,
					...(memberIds.length ? { memberExternalIds: memberIds } : {}),
					...unread,
					...lastActivity,
				});
			} else if (conv.user) {
				// 1:1 im: name + avatar + presence by the OTHER member (resolved via users.info / getPresence).
				const profile = await resolveProfile(conv.user);
				const presence = await resolvePresence(conv.user);
				out.push({
					externalId: conv.id,
					name: profile.name,
					isGroup,
					memberExternalIds: [conv.user],
					...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
					...(presence ? { presence } : {}),
					...unread,
					...lastActivity,
				});
			} else {
				out.push({ externalId: conv.id, name: conv.id, isGroup, ...unread, ...lastActivity });
			}
		}
		return out;
	}

	// ─── members (People) — REAL ──────────────────────────────────────────────────────────────────

	/**
	 * List the workspace people for the "People" section: users.list, cursor-paged. Bots, app users,
	 * and deactivated (deleted) accounts are SKIPPED — only real humans surface. Each maps to
	 * IProviderMember { externalId: user id, displayName, email }. The Slackbot pseudo-user is also
	 * skipped. Slack `ok:false` (e.g. missing users:read scope) is surfaced UNswallowed by slackApi.
	 */
	async listMembers(connection: IProviderConnection): Promise<IProviderMember[]> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		const tokens = tokensFromCredentials(connection.credentials);

		type SlackUser = {
			id?: string;
			name?: string;
			real_name?: string;
			deleted?: boolean;
			is_bot?: boolean;
			is_app_user?: boolean;
			profile?: { display_name?: string; real_name?: string; email?: string; image_72?: string; image_48?: string };
		};

		const users = await slackGetAll<SlackUser>('users.list', 'members', tokens, { limit: LIST_PAGE_SIZE });

		// Presence requires a per-user users.getPresence call (users.list doesn't carry it), so it's
		// capped — past MAX_PROFILE_LOOKUPS members, presence stays undefined to avoid a rate-limit
		// storm on a large roster. avatarUrl rides along on users.list for free (no extra call).
		let presenceLookups = 0;
		const resolvePresence = async (userId: string): Promise<'active' | 'away' | 'dnd' | 'offline' | undefined> => {
			if (presenceLookups >= MAX_PROFILE_LOOKUPS) {
				return undefined;
			}
			presenceLookups++;
			try {
				const res = await slackFetch<{ presence?: string }>('users.getPresence', tokens, {
					method: 'GET',
					params: { user: userId },
				});
				return mapPresence(res.presence);
			} catch (err) {
				// A missing presence scope (or a single failed lookup) just leaves presence undefined.
				return undefined;
			}
		};

		const out: IProviderMember[] = [];
		for (const u of users) {
			if (!u?.id) {
				continue;
			}
			// Skip bots/app users, deactivated accounts, and the Slackbot pseudo-user.
			if (u.is_bot || u.is_app_user || u.deleted || u.id === 'USLACKBOT') {
				continue;
			}
			const displayName = u.profile?.display_name || u.real_name || u.profile?.real_name || u.name || u.id;
			const email = u.profile?.email;
			const avatarUrl = u.profile?.image_72 || u.profile?.image_48 || undefined;
			const presence = await resolvePresence(u.id);
			out.push({
				externalId: u.id,
				displayName,
				...(email ? { email } : {}),
				...(avatarUrl ? { avatarUrl } : {}),
				...(presence ? { presence } : {}),
			});
		}
		return out;
	}

	// ─── conversation-id resolution ──────────────────────────────────────────────────────────────

	/**
	 * The People directory hands a USER id (`U…`/`W…`) through as a DM target, but Slack's message
	 * APIs only accept CONVERSATION ids (`C…`/`D…`/`G…`) — conversations.history with a user id answers
	 * `channel_not_found`. conversations.open resolves (creating if needed) the 1:1 im and returns its
	 * `D…` id. Cached per (connection, user) so each DM pays the extra call once per pod lifetime.
	 * Requires the `im:write` user scope (in SLACK_USER_SCOPES); tokens granted before that scope
	 * landed surface Slack's `missing_scope` — reconnecting re-grants.
	 */
	private dmIdCache = new Map<string, string>();

	private async resolveConversationId(connection: IProviderConnection, externalId: string, tokens: SlackTokens): Promise<string> {
		if (!/^[UW]/.test(externalId)) {
			return externalId;
		}
		const cacheKey = `${connection.connectionId}:${externalId}`;
		const cached = this.dmIdCache.get(cacheKey);
		if (cached) {
			return cached;
		}
		const opened = await slackFetch<{ channel?: { id?: string } }>('conversations.open', tokens, {
			method: 'POST',
			params: { users: externalId },
		});
		const id = opened.channel?.id;
		if (!id) {
			throw new Error('slack_dm_open_failed');
		}
		this.dmIdCache.set(cacheKey, id);
		return id;
	}

	/**
	 * Contract hook: canonicalize an id before it is PERSISTED (bridge records). A People-directory
	 * USER id resolves to its im CONVERSATION id — a bridge keyed by the user id can never match the
	 * event fan-out (events address the `D…` id), so it would silently receive nothing.
	 */
	async resolveBridgeChannelId(connection: IProviderConnection, channelExternalId: string): Promise<string> {
		if (!isSlackConfigured() || !channelExternalId) {
			return channelExternalId;
		}
		const tokens = tokensFromCredentials(connection.credentials);
		return this.resolveConversationId(connection, channelExternalId, tokens);
	}

	// ─── sync (read) — REAL ──────────────────────────────────────────────────────────────────────

	/**
	 * Read a channel's OR a direct chat's messages: conversations.history?channel=<id>&limit=50,
	 * cursor-paged via `response_metadata.next_cursor` up to MAX_MESSAGE_PAGES. Slack's history is
	 * NEWEST-FIRST. Each message is mapped to IProviderMessage — author from `user`, text from `text`,
	 * `ts` from the Slack `ts` (a `seconds.micros` epoch string, kept as-is per the contract). Thread
	 * replies carry `thread_ts`; edits carry `edited.ts`. Bot/system messages (a `subtype` like
	 * `channel_join`, or no `user`) are SKIPPED.
	 *
	 * `channelExternalId` is the conversation id from listChannels OR listDirectChats — Slack addresses
	 * both the same way, so no id-shape detection is needed (unlike Teams). `since` is an optional Slack
	 * `ts` cursor: passed as `oldest` so Slack filters server-side, and we also stop early once we cross
	 * it (newest-first feed).
	 */
	async *syncMessages(connection: IProviderConnection, channelExternalId: string, since?: string): AsyncIterable<IProviderMessage> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		if (!channelExternalId) {
			throw new Error('slack_invalid_channel_id');
		}
		const tokens = tokensFromCredentials(connection.credentials);
		// People-directory DM target: a user id must be resolved to its im conversation id first.
		const conversationId = await this.resolveConversationId(connection, channelExternalId, tokens);
		// Author + mention enrichment: the SHARED capped users.info resolver (same pattern as
		// listDirectChats), per-call cached so an author appearing in 50 messages costs ONE lookup.
		const resolveProfile = this.createProfileResolver(tokens);

		type SlackMessage = {
			ts?: string;
			user?: string;
			bot_id?: string;
			subtype?: string;
			text?: string;
			thread_ts?: string;
			edited?: { ts?: string };
		};

		// `since` is either a Slack `ts` ("seconds.micros") or an ISO-8601 timestamp (the bridge's
		// lastInboundAt cursor, which backfillBridge passes as an ISO string) — normalize both to
		// epoch seconds for the server-side `oldest` filter and the early-stop compare. A raw Slack
		// ts is forwarded verbatim (float round-tripping could clip the micros digits).
		const asNumber = since ? Number(since) : NaN;
		const asIsoMs = since && Number.isNaN(asNumber) ? Date.parse(since) : NaN;
		const sinceNum = !Number.isNaN(asNumber) ? asNumber : asIsoMs / 1000;
		const hasSince = Number.isFinite(sinceNum);
		const oldest = hasSince ? (Number.isNaN(asNumber) ? sinceNum.toFixed(3) : since) : undefined;

		let cursor: string | undefined;
		let pages = 0;

		while (pages < MAX_MESSAGE_PAGES) {
			const page = await slackFetch<{ messages?: SlackMessage[] }>('conversations.history', tokens, {
				method: 'GET',
				params: {
					channel: conversationId,
					limit: MESSAGE_PAGE_SIZE,
					...(oldest ? { oldest } : {}),
					...(cursor ? { cursor } : {}),
				},
			});
			pages++;

			for (const msg of page.messages || []) {
				if (!msg?.ts) {
					continue;
				}
				// Skip bot/system messages: a `subtype` (channel_join, bot_message, etc.) or a bot_id, or
				// no human `user`. These carry no human author for the bridge to map.
				if (msg.subtype || msg.bot_id || !msg.user) {
					continue;
				}

				// Newest-first feed: once we cross the `since` cursor we can stop entirely.
				if (hasSince) {
					const tsNum = Number(msg.ts);
					if (!Number.isNaN(tsNum) && tsNum <= sinceNum) {
						return;
					}
				}

				// Author + mention enrichment (capped, cached) — real display names/avatars + a resolved
				// mentions map instead of raw U-ids. See enrichSlackMessage.
				yield await enrichSlackMessage(msg as SlackHistoryMessage, channelExternalId, resolveProfile);
			}

			cursor = (page.response_metadata?.next_cursor as string) || undefined;
			if (!cursor) {
				break;
			}
		}
	}

	/**
	 * Begin receiving realtime updates for a channel — REAL via the Slack Events API. Unlike Teams
	 * (one Graph subscription per channel), Slack event subscriptions are APP-LEVEL: the app's
	 * Event Subscriptions config (Request URL `/_slack/events`, USER events `message.channels` +
	 * `message.groups` + `message.im` + `message.mpim`) delivers every visible conversation's
	 * messages — channels AND direct chats — in one stream, verified per
	 * request by the signing secret. So there is nothing per-channel to create here — the bridge's
	 * channel mapping (the bridgedChannels record the bridgeService keeps) IS the subscription, and
	 * the events endpoint fans each delivery out to every connection bridging that (team, channel).
	 *
	 * Fail-closed gate: when the signing secret is unset, inbound realtime is OFF (the events
	 * endpoint processes nothing) — throw so the caller knows this bridge is outbound-only until
	 * the admin sets `Slack_Signing_Secret` / `SLACK_SIGNING_SECRET`. `onMessage` is unused: the
	 * events endpoint routes through bridgeCore directly, exactly like the Teams webhook does.
	 */
	async subscribe(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_onMessage: InboundMessageHandler,
	): Promise<IProviderSubscription> {
		if (!isSlackEventsConfigured()) {
			throw new Error('slack_events_not_configured');
		}
		// App-level Events API: nothing to create, nothing to tear down per channel.
		return { stop: async () => undefined };
	}

	// ─── identity — REAL ─────────────────────────────────────────────────────────────────────────

	/**
	 * Resolve an external user id to its profile via users.info (delegated users:read scope), for
	 * alias/attribution rendering. Returns null (rather than throwing) for an unknown/unreadable
	 * user so a single unresolved author never fails an ingest.
	 */
	async resolveIdentity(connection: IProviderConnection, externalUserId: string): Promise<IProviderUser | null> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		if (!externalUserId) {
			return null;
		}
		const tokens = tokensFromCredentials(connection.credentials);
		try {
			const info = await slackFetch<{
				user?: {
					id?: string;
					name?: string;
					real_name?: string;
					is_bot?: boolean;
					profile?: { display_name?: string; real_name?: string; email?: string; image_72?: string; image_48?: string };
				};
			}>('users.info', tokens, { method: 'GET', params: { user: externalUserId } });
			const u = info.user;
			if (!u?.id) {
				return null;
			}
			const avatarUrl = u.profile?.image_72 || u.profile?.image_48 || undefined;
			return {
				externalId: u.id,
				displayName: u.profile?.display_name || u.real_name || u.profile?.real_name || u.name || u.id,
				...(u.profile?.email ? { email: u.profile.email } : {}),
				isBot: Boolean(u.is_bot),
				...(avatarUrl ? { avatarUrl } : {}),
			};
		} catch {
			// user_not_found / missing scope / transient failure — attribution falls back to the id.
			return null;
		}
	}

	// ─── write — REAL ────────────────────────────────────────────────────────────────────────────

	/**
	 * Post a message to a channel OR a direct chat AS the signed-in user (delegated chat:write):
	 * chat.postMessage with `{ channel, text }` (and `thread_ts` when replying in a thread). Returns the
	 * created message `ts` as the externalId. Slack `ok:false` (e.g. not_in_channel, channel_not_found,
	 * missing chat:write scope) is surfaced UNswallowed by slackApi.
	 *
	 * `channelExternalId` is the conversation id from listChannels OR listDirectChats — Slack posts to
	 * both the same way.
	 */
	async postMessage(
		connection: IProviderConnection,
		channelExternalId: string,
		message: IOutboundMessage,
	): Promise<{ externalId: string; ts: string }> {
		if (!isSlackConfigured()) {
			return notConfigured();
		}
		if (!channelExternalId) {
			throw new Error('slack_invalid_channel_id');
		}
		const text = message?.text;
		if (typeof text !== 'string' || !text.trim()) {
			throw new Error('slack_empty_message');
		}
		const tokens = tokensFromCredentials(connection.credentials);
		// People-directory DM target: a user id must be resolved to its im conversation id first.
		const conversationId = await this.resolveConversationId(connection, channelExternalId, tokens);

		const created = await slackFetch<{ ts?: string }>('chat.postMessage', tokens, {
			method: 'POST',
			params: {
				channel: conversationId,
				text,
				...(message.threadExternalId ? { thread_ts: message.threadExternalId } : {}),
			},
		});
		if (!created?.ts) {
			throw new Error('slack_post_no_message_ts');
		}
		// chat.postMessage echoes the created message `ts` — surfaced as BOTH the externalId and the
		// provider-native creation timestamp so the service can build an instant-echo ClientMessage.
		return { externalId: created.ts, ts: created.ts };
	}

	// ─── read state — REAL (best-effort) ──────────────────────────────────────────────────────────

	/**
	 * Mark a channel OR direct chat read in Slack: conversations.mark with `channel=externalId` and
	 * `ts=` the conversation's latest message ts. `externalId` is the conversation id from listChannels
	 * OR listDirectChats — Slack marks both the same way (a conversation id IS the channel id).
	 *
	 * We first read the conversation's most-recent message ts (conversations.history limit=1), then
	 * mark up to it. conversations.mark needs the per-type WRITE scope (channels:write /
	 * groups:write / im:write / mpim:write — requested since the read-sync scope set landed; tokens
	 * granted BEFORE that lack them and fail with `slack_error:missing_scope` until the user
	 * reconnects). Failures are THROWN, not swallowed (same posture as TeamsProvider.markRead): the
	 * service layer (markMyRead) still acks ok:true to the client, but logs the failure and stamps
	 * auth-death (invalid_auth/token_revoked → connection status `error`) so a silently-broken
	 * read-sync is visible instead of vanishing.
	 */
	async markRead(connection: IProviderConnection, externalId: string): Promise<void> {
		if (!isSlackConfigured() || !externalId) {
			return;
		}
		const tokens = tokensFromCredentials(connection.credentials);
		// People-directory DM target: a user id must be resolved to its im conversation id first.
		const conversationId = await this.resolveConversationId(connection, externalId, tokens);
		// Newest message ts to mark up to. limit=1 keeps this cheap.
		const page = await slackFetch<{ messages?: Array<{ ts?: string }> }>('conversations.history', tokens, {
			method: 'GET',
			params: { channel: conversationId, limit: 1 },
		});
		const latestTs = page.messages?.[0]?.ts;
		if (!latestTs) {
			// Nothing to mark (empty conversation) — genuinely nothing to do.
			return;
		}
		await slackFetch('conversations.mark', tokens, {
			method: 'POST',
			params: { channel: conversationId, ts: latestTs },
		});
	}

	/**
	 * Roll up THIS connection's unread count for the org-tile badge. conversations.list does NOT carry
	 * unread, so the only documented source is conversations.info PER conversation — far too many to scan
	 * every channel on a 30s poll across every org. So we bound it to the user's DMs (im,mpim — "new
	 * chats", the primary at-a-glance signal) and CAP the info fan-out. APPROXIMATE by design (channel
	 * unread isn't included) and rate-limit-bounded. mentionCount stays 0 (Slack exposes no cheap per-
	 * conversation mention count). VERIFY LIVE: at this poll cadence the conversations.info fan-out sits
	 * near Slack's Tier-3 budget — lower SUMMARY_INFO_CAP or raise the poll interval if 429s appear.
	 *
	 * Returns plain integers (>=0). A hard list failure throws (slackGetAll) and the service's
	 * per-connection try/catch defaults that connection to 0/0; a per-conversation info failure is
	 * swallowed so one bad DM never zeroes the rest.
	 */
	async unreadSummary(connection: IProviderConnection): Promise<{ unreadCount: number; mentionCount: number }> {
		if (!isSlackConfigured()) {
			return { unreadCount: 0, mentionCount: 0 };
		}
		const tokens = tokensFromCredentials(connection.credentials);

		const dms = await slackGetAll<{ id?: string }>('conversations.list', 'channels', tokens, {
			types: 'im,mpim',
			exclude_archived: true,
			limit: LIST_PAGE_SIZE,
		});

		const SUMMARY_INFO_CAP = 20;
		let unreadCount = 0;
		let lookups = 0;
		for (const conv of dms) {
			if (lookups >= SUMMARY_INFO_CAP) {
				break;
			}
			if (!conv?.id) {
				continue;
			}
			lookups++;
			try {
				const res = await slackFetch<{ channel?: { unread_count_display?: number } }>('conversations.info', tokens, {
					method: 'GET',
					params: { channel: conv.id },
				});
				const n = res.channel?.unread_count_display;
				if (typeof n === 'number' && n > 0) {
					unreadCount += n;
				}
			} catch {
				// best-effort per conversation — one bad DM doesn't zero the rest.
			}
		}
		// mentionCount: Slack has no cheap per-conversation mention count — leave 0 (see caveats).
		return { unreadCount, mentionCount: 0 };
	}
}
