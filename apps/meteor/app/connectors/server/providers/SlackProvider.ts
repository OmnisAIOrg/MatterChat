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
 * WHAT IS A TODO STUB (the realtime milestone):
 *   - subscribe          → Slack realtime is the Events API (HTTP event subscriptions) or socket-mode;
 *                          a polling fallback is the interim path. Keyed by (teamId, channelId).
 *   - resolveIdentity    → users.info, or from the message author block carried per payload.
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
import { getSlackConfig, isSlackConfigured, SLACK_TOKEN_ENDPOINT, redirectUri, SLACK_USER_SCOPES } from './slack/config';
import type { SlackTokens } from './slack/slackApi';
import { slackFetch, slackGetAll } from './slack/slackApi';

// Mounting the OAuth routes is a side-effect of importing this provider, so booting the connectors
// index (which constructs the registry with `new SlackProvider()`) also wires /_slack/oauth.
import './slack/routes';

const NEXT_MILESTONE =
	'SlackProvider: realtime is the next milestone (subscribe/resolveIdentity). The path is the Slack Events API / socket-mode, or polling on a per-connection toggle.';

function notConfigured(): never {
	throw new Error('slack_not_configured');
}

/** How many message pages (×limit) to read in one syncMessages call — a reasonable backfill cap. */
const MAX_MESSAGE_PAGES = 5;
const MESSAGE_PAGE_SIZE = 50;
/** Page size for the conversations/users list endpoints (Slack caps conversations.list at 1000). */
const LIST_PAGE_SIZE = 200;

/** Build the SlackTokens bundle the slackApi reads from stored credentials. */
function tokensFromCredentials(credentials: IProviderCredentials): SlackTokens {
	if (!credentials?.accessToken) {
		throw new Error('slack_missing_access_token');
	}
	return { accessToken: credentials.accessToken };
}

export class SlackProvider implements IChatProvider {
	readonly provider = 'slack' as const;

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
	 * Tear down live resources for this connection. No sockets/subscriptions exist yet (realtime is the
	 * next milestone), so this is a no-op today — disconnect at the record level is handled by
	 * connectionService.
	 */
	async disconnect(_connection: IProviderConnection): Promise<void> {
		// No live Slack subscriptions to delete until the realtime milestone; nothing to release.
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
			out.push({
				// The Slack conversation id is the channel id — passed straight to the messages endpoints.
				externalId: ch.id,
				name: ch.name || ch.id,
				isPrivate: Boolean(ch.is_private),
				...(ch.topic?.value ? { topic: ch.topic.value } : {}),
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
	 * channel `name` is the joined-handles label Slack already provides. Slack `ok:false` (e.g.
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
		};

		const conversations = await slackGetAll<SlackConversation>('conversations.list', 'channels', tokens, {
			types: 'im,mpim',
			exclude_archived: true,
			limit: LIST_PAGE_SIZE,
		});

		// Resolve 1:1 peer display names via users.info, cached so repeated peers cost one lookup.
		const nameCache = new Map<string, string>();
		const resolveUserName = async (userId: string): Promise<string> => {
			if (nameCache.has(userId)) {
				return nameCache.get(userId) as string;
			}
			try {
				const info = await slackFetch<{ user?: { real_name?: string; profile?: { display_name?: string; real_name?: string }; name?: string } }>(
					'users.info',
					tokens,
					{ method: 'GET', params: { user: userId } },
				);
				const u = info.user || {};
				const name = u.profile?.display_name || u.real_name || u.profile?.real_name || u.name || userId;
				nameCache.set(userId, name);
				return name;
			} catch (err) {
				// A single unresolved peer must not fail the whole list — fall back to the id.
				nameCache.set(userId, userId);
				return userId;
			}
		};

		const out: IProviderDirectChat[] = [];
		for (const conv of conversations) {
			if (!conv?.id || conv.is_user_deleted) {
				continue;
			}
			const isGroup = Boolean(conv.is_mpim);
			let name: string;
			if (isGroup) {
				// mpim: Slack's own joined-handles label is the most legible thing available cheaply.
				name = conv.name || conv.id;
			} else if (conv.user) {
				// 1:1 im: name by the OTHER member (resolved via users.info).
				name = await resolveUserName(conv.user);
			} else {
				name = conv.id;
			}

			out.push({
				externalId: conv.id,
				name,
				isGroup,
				...(conv.user ? { memberExternalIds: [conv.user] } : {}),
			});
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
			profile?: { display_name?: string; real_name?: string; email?: string };
		};

		const users = await slackGetAll<SlackUser>('users.list', 'members', tokens, { limit: LIST_PAGE_SIZE });

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
			out.push({
				externalId: u.id,
				displayName,
				...(email ? { email } : {}),
			});
		}
		return out;
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

		type SlackMessage = {
			ts?: string;
			user?: string;
			bot_id?: string;
			subtype?: string;
			text?: string;
			thread_ts?: string;
			edited?: { ts?: string };
		};

		// Slack `ts` is a `seconds.micros` string; numeric compare works for the early-stop cursor.
		const sinceNum = since ? Number(since) : NaN;
		const hasSince = !Number.isNaN(sinceNum);

		let cursor: string | undefined;
		let pages = 0;

		while (pages < MAX_MESSAGE_PAGES) {
			const page = await slackFetch<{ messages?: SlackMessage[] }>('conversations.history', tokens, {
				method: 'GET',
				params: {
					channel: channelExternalId,
					limit: MESSAGE_PAGE_SIZE,
					...(hasSince ? { oldest: since } : {}),
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

				yield {
					externalId: msg.ts,
					channelExternalId,
					authorExternalId: msg.user,
					text: msg.text || '',
					ts: msg.ts,
					...(msg.thread_ts && msg.thread_ts !== msg.ts ? { threadExternalId: msg.thread_ts } : {}),
					...(msg.edited?.ts ? { editedTs: msg.edited.ts } : {}),
				};
			}

			cursor = (page.response_metadata?.next_cursor as string) || undefined;
			if (!cursor) {
				break;
			}
		}
	}

	async subscribe(
		_connection: IProviderConnection,
		_channelExternalId: string,
		_onMessage: InboundMessageHandler,
	): Promise<IProviderSubscription> {
		// TODO(next milestone): Slack realtime is the Events API (HTTP event subscriptions verified by
		// the signing secret) or socket-mode; the interim path is polling conversations.history on a
		// per-connection toggle. Keyed by (teamId, channelId) and shared across users.
		throw new Error(NEXT_MILESTONE);
	}

	// ─── identity — NEXT MILESTONE ───────────────────────────────────────────────────────────────

	async resolveIdentity(_connection: IProviderConnection, _externalUserId: string): Promise<IProviderUser | null> {
		// TODO(next milestone): users.info on the external user id (or resolve from the message author
		// block carried per payload), mapped to IProviderUser. Requires the granted users:read scope.
		throw new Error(NEXT_MILESTONE);
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
	): Promise<{ externalId: string }> {
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

		const created = await slackFetch<{ ts?: string }>('chat.postMessage', tokens, {
			method: 'POST',
			params: {
				channel: channelExternalId,
				text,
				...(message.threadExternalId ? { thread_ts: message.threadExternalId } : {}),
			},
		});
		if (!created?.ts) {
			throw new Error('slack_post_no_message_ts');
		}
		return { externalId: created.ts };
	}
}
