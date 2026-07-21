/**
 * connectionService — per-user lifecycle for external-workspace connections.
 *
 * Thin server-side service the REST routes (and later the rail endpoints / BridgeCore) call.
 * EVERY operation is scoped to the authenticated user: a user manages only their OWN
 * connections. Ownership is enforced at the model layer (findOneByIdAndUserId /
 * deleteByIdAndUserId), so a user can never read or disconnect someone else's connection.
 *
 * Token handling: credentials are stored encrypted (tokenCrypto) and the encrypted blob is
 * NEVER returned to the client. `toClientConnection` strips it.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §4.
 */
import type { ExternalProvider, IExternalSentMessage, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
import { ExternalWorkspaceConnections, ExternalSentMessages } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import type { IProviderChannel, IProviderConnection, IProviderDirectChat, IProviderMember, IProviderMessage } from './ChatProvider';
import { encodeChannelKey, storeUnreadCounts } from './channelSeen';
import { providerRegistry } from './providerRegistry';
import { isGoogleConfigured } from './providers/google/config';
import { isSlackConfigured } from './providers/slack/config';
import { isTeamsConfigured } from './providers/teams/config';
import { toProviderConnection } from './runtimeConnection';
import { isEncryptionConfigured } from './tokenCrypto';
import { SystemLogger } from '../../../server/lib/logger/system';

// Boot-time key visibility (ops) — mirrors the LITBOX_TOKEN_ENC_KEY check in
// omnisai-oauth/server/litboxProxy.ts. Loud so a deploy without the secret is caught in the
// logs instead of silently persisting plaintext connector credentials.
if (!isEncryptionConfigured()) {
	if ((process.env.EXTERNAL_TOKEN_ENC_KEY || '').trim()) {
		SystemLogger.error({
			msg: 'EXTERNAL_TOKEN_ENC_KEY is set but INVALID (must be base64-encoded 32 bytes) — connector credential encryption is DISABLED: new connections will be stored in PLAINTEXT and previously encrypted ones will fail to decrypt (users must reconnect) until the key is fixed.',
		});
	} else {
		SystemLogger.warn({
			msg: 'EXTERNAL_TOKEN_ENC_KEY is not set — external-workspace connector credentials (Slack/Teams/Google) are stored in PLAINTEXT at rest. Set EXTERNAL_TOKEN_ENC_KEY (base64-encoded 32 bytes) on this deployment to enable encryption.',
		});
	}
}

/**
 * Client-safe projection of a connection — everything EXCEPT the encrypted credential blob.
 * This is what the list/disconnect endpoints return and what the rail renders.
 */
export type ClientConnection = Omit<IExternalWorkspaceConnection, 'credentials' | '_updatedAt'>;

function toClientConnection(doc: IExternalWorkspaceConnection): ClientConnection {
	const { credentials, _updatedAt, ...safe } = doc;
	return safe;
}

/** List the connections owned by a user (client-safe; no secrets). */
export async function listMyConnections(userId: string): Promise<ClientConnection[]> {
	const docs = await ExternalWorkspaceConnections.findByUserId(userId).toArray();
	return docs.map(toClientConnection);
}

/**
 * Build the provider's OAuth authorize URL for a user to begin connecting a workspace.
 *
 * TEAMS (real): returns the server-side `/_teams/oauth/start` URL. The client just
 * navigates there; the route mints PKCE + state (bound to the signed-in user via the login-token
 * cookie) and redirects on to Microsoft. PKCE stays entirely server-side — the client never sees a
 * verifier. Returns `authorizeUrl: null, implemented: false` when Teams is disabled or no client
 * secret is configured (standalone-safe), so the UI can show a disabled state.
 *
 * GOOGLE / SLACK (real): return the server-side `/_google/oauth/start` / `/_slack/oauth/start` URL.
 * Same pattern as Teams — the route binds the flow to the signed-in user and redirects on to the
 * provider. Returns `authorizeUrl: null, implemented: false` when the connector is disabled or no
 * client secret is configured (standalone-safe), so the UI can show a disabled state.
 */
export async function getProviderAuthUrl(
	// Bound to the user by the OAuth route via the login-token cookie; not needed to build the URL.
	_userId: string,
	provider: ExternalProvider,
): Promise<{ provider: ExternalProvider; authorizeUrl: string | null; implemented: boolean }> {
	if (!providerRegistry.has(provider)) {
		throw new Error('invalid-provider');
	}
	// Touch the provider so an unregistered/garbage key fails the same way callers will see later.
	providerRegistry.get(provider);

	if (provider === 'teams') {
		if (!isTeamsConfigured()) {
			// Disabled or no client secret pasted yet — signal "not ready" without throwing.
			return { provider, authorizeUrl: null, implemented: false };
		}
		// The route mounts at /_teams/oauth (NOT under /api — RC's REST router shadows /api/*).
		return { provider, authorizeUrl: Meteor.absoluteUrl('_teams/oauth/start'), implemented: true };
	}

	if (provider === 'google') {
		if (!isGoogleConfigured()) {
			// Disabled or no client secret pasted yet — signal "not ready" without throwing.
			return { provider, authorizeUrl: null, implemented: false };
		}
		// The route mounts at /_google/oauth (NOT under /api — RC's REST router shadows /api/*).
		return { provider, authorizeUrl: Meteor.absoluteUrl('_google/oauth/start'), implemented: true };
	}

	if (provider === 'slack') {
		if (!isSlackConfigured()) {
			// Disabled or no client secret pasted yet — signal "not ready" without throwing.
			return { provider, authorizeUrl: null, implemented: false };
		}
		// The route mounts at /_slack/oauth (NOT under /api — RC's REST router shadows /api/*).
		return { provider, authorizeUrl: Meteor.absoluteUrl('_slack/oauth/start'), implemented: true };
	}

	return { provider, authorizeUrl: null, implemented: false };
}

/**
 * Disconnect (tear down) one of the user's own connections.
 *
 * Ownership-scoped: returns false if the connection doesn't exist or isn't owned by the user.
 * Best-effort tells the provider to release live resources, then removes the record.
 */
export async function disconnectMyConnection(userId: string, connectionId: string): Promise<boolean> {
	const doc = await ExternalWorkspaceConnections.findOneByIdAndUserId(connectionId, userId);
	if (!doc) {
		return false;
	}

	// Best-effort provider teardown — with REAL decrypted credentials when available, so Teams can
	// delete its Graph change-notification subscriptions (the live-bridge inbound transport). We
	// swallow errors here — the record removal below is what the user asked for and must succeed.
	try {
		const provider = providerRegistry.get(doc.provider);
		const connection = toProviderConnection(doc) ?? {
			connectionId: doc._id,
			ownerUserId: doc.userId,
			externalOrgId: doc.externalOrgId,
			credentials: {},
		};
		await provider.disconnect(connection);
	} catch {
		// Provider not implemented yet, or live teardown failed — proceed to remove the record.
	}

	const result = await ExternalWorkspaceConnections.deleteByIdAndUserId(connectionId, userId);
	return result.deletedCount === 1;
}

/**
 * A channel as returned to the client by the "see your channels" view. Provider-native ids/names,
 * plus the team name split out of the provider's qualified label so the UI can group by team.
 */
export type ClientChannel = {
	/** Provider-native channel id (Teams: `19:…@thread.tacv2`). */
	externalId: string;
	/** The channel's own name (without the team prefix). */
	name: string;
	/** The team/workspace this channel belongs to (for grouping). */
	teamName: string;
	isPrivate: boolean;
	topic?: string;
	/** Feel-alive fields (optional; only set by providers that report them). lastActivity is epoch-ms. */
	unreadCount?: number;
	mentionCount?: number;
	lastActivity?: number;
};

/** Channels grouped by their team, for the "connected channels" panel. */
export type ClientChannelGroup = {
	teamName: string;
	channels: ClientChannel[];
};

/** Error payload surfaced to the client when listing channels fails (NOT swallowed — see spec WS-5). */
export type ListChannelsError = {
	/** Stable machine code, e.g. `teams_not_configured`, `graph_error`, `connection_not_found`. */
	error: string;
	/** Human-readable detail (the underlying Graph/auth message), safe to show plainly. */
	message: string;
	/** HTTP-ish status from the upstream provider when available (e.g. 401, 403, 429). */
	status?: number;
};

// Runtime connection building (decrypted creds + refresh-persistence hook) lives in
// ./runtimeConnection so the live message bridge can use it without importing this module
// (which imports the providerRegistry → providers — an import cycle otherwise). Re-exported
// here for existing callers.
export { toProviderConnection };

/** Split the provider's qualified `Team / Channel` label into its parts (falls back gracefully). */
function splitChannelLabel(channel: IProviderChannel, fallbackTeam: string): { teamName: string; name: string } {
	const sep = ' / ';
	const idx = channel.name.indexOf(sep);
	if (idx > 0) {
		return { teamName: channel.name.slice(0, idx), name: channel.name.slice(idx + sep.length) };
	}
	return { teamName: fallbackTeam, name: channel.name };
}

/**
 * Resolve ONE of the caller's OWN connections for a discovery view (channels / chats / members),
 * by id (ownership-scoped) or by provider (most-recent `connected`), and rebuild its runtime
 * credentials — or return the structured reason it can't be used (not found / wrong status /
 * undecryptable creds). Shared by listMyChannels / listMyDirectChats / listMyMembers so all three
 * gate IDENTICALLY. The `subject` word is spliced into the not-active/consent messages.
 */
async function resolveDiscoveryConnection(
	userId: string,
	opts: { connectionId?: string; provider?: ExternalProvider },
	subject: 'channels' | 'chats' | 'people',
): Promise<{ doc: IExternalWorkspaceConnection; connection: IProviderConnection } | ProviderError> {
	// Resolve which connection to read — by id (ownership-scoped) or by provider (most recent).
	let doc: IExternalWorkspaceConnection | null = null;
	if (opts.connectionId) {
		doc = await ExternalWorkspaceConnections.findOneByIdAndUserId(opts.connectionId, userId);
	} else if (opts.provider) {
		const docs = await ExternalWorkspaceConnections.findByUserIdAndProvider(userId, opts.provider).toArray();
		doc = docs.find((d) => d.status === 'connected') || docs[0] || null;
	}

	if (!doc) {
		return { error: 'connection_not_found', message: 'No connected workspace found for this account.', status: 404 };
	}

	if (doc.status !== 'connected') {
		return {
			error: `connection_${doc.status}`,
			message:
				doc.status === 'consent_required'
					? `This Teams connection needs admin consent before ${subject} can be read.`
					: 'This connection is not active — reconnect the workspace and try again.',
		};
	}

	const connection = toProviderConnection(doc);
	if (!connection) {
		return { error: 'credentials_unavailable', message: 'Stored credentials could not be read — reconnect the workspace.', status: 401 };
	}

	return { doc, connection };
}

/**
 * List the channels of ONE of the caller's OWN connections, grouped by team.
 *
 * Loads the connection (ownership-scoped), rebuilds the runtime credentials, calls
 * `providerRegistry.get(provider).listChannels(conn)` — the REAL Microsoft Graph call for Teams —
 * and returns the channels grouped by team. On a Graph/auth/config error it returns a structured
 * ListChannelsError (NOT swallowed) so the UI — and we — can see whether listChannels actually
 * works against real Teams. A successful call also persists any token the provider refreshed mid-call.
 *
 * `connectionId` is optional: when omitted, the user's most recent `connected` connection for
 * `provider` is used (the rail tile knows the provider, not necessarily the connection id).
 */
/** How far back store-computed unread looks. Older inbound noise ages out of the badge. */
const STORE_UNREAD_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const STORE_UNREAD_ROW_CAP = 2000;

/**
 * Store-computed unread per channel for ONE connection: inbound rows newer than the owner's
 * last-seen markers (see channelSeen.ts — this is what makes badges provider-independent; the
 * provider APIs report 0 for Slack non-Marketplace apps). Best-effort: any failure = empty map.
 */
async function storeUnreadForConnection(doc: IExternalWorkspaceConnection): Promise<Map<string, number>> {
	try {
		const rows = await ExternalSentMessages.col
			.find(
				{ userId: doc.userId, connectionId: doc._id, source: 'inbound', createdAt: { $gt: new Date(Date.now() - STORE_UNREAD_WINDOW_MS) } },
				{ projection: { channelExternalId: 1, createdAt: 1 }, limit: STORE_UNREAD_ROW_CAP },
			)
			.toArray();
		return storeUnreadCounts(rows as { channelExternalId: string; createdAt: Date }[], doc.lastSeenByChannel);
	} catch {
		return new Map();
	}
}

export async function listMyChannels(
	userId: string,
	opts: { connectionId?: string; provider?: ExternalProvider },
): Promise<{ groups: ClientChannelGroup[]; connection: ClientConnection } | ListChannelsError> {
	const resolved = await resolveDiscoveryConnection(userId, opts, 'channels');
	if ('error' in resolved) {
		return resolved;
	}
	const { doc, connection } = resolved;

	try {
		const provider = providerRegistry.get(doc.provider);
		const channels = await provider.listChannels(connection);

		// Token refresh: when the Graph client refreshed the access token mid-call (proactively or on a
		// 401), the connection's onCredentialsRefreshed hook (attached in toProviderConnection) already
		// re-encrypted + persisted the rotated tokens on the connection document.

		// Group the flat channel list by team (the provider qualifies names as `Team / Channel`).
		const storeCounts = await storeUnreadForConnection(doc);
		const byTeam = new Map<string, ClientChannel[]>();
		for (const ch of channels) {
			const { teamName, name } = splitChannelLabel(ch, doc.externalOrgName || 'Microsoft Teams');
			const storeUnread = storeCounts.get(ch.externalId) ?? 0;
			const entry: ClientChannel = {
				externalId: ch.externalId,
				name,
				teamName,
				isPrivate: ch.isPrivate,
				topic: ch.topic,
				// Store-computed unread wins over the provider's number when higher (provider reports 0
				// for Slack non-Marketplace apps; our own store sees every bridged inbound message).
				...(Math.max(ch.unreadCount ?? 0, storeUnread) > 0 ? { unreadCount: Math.max(ch.unreadCount ?? 0, storeUnread) } : {}),
				...(ch.mentionCount !== undefined ? { mentionCount: ch.mentionCount } : {}),
				...(ch.lastActivity !== undefined ? { lastActivity: ch.lastActivity } : {}),
			};
			const list = byTeam.get(teamName);
			if (list) {
				list.push(entry);
			} else {
				byTeam.set(teamName, [entry]);
			}
		}

		const groups: ClientChannelGroup[] = [...byTeam.entries()].map(([teamName, chans]) => ({ teamName, channels: chans }));
		return { groups, connection: toClientConnection(doc) };
	} catch (err) {
		// DO NOT swallow — surface the real Graph/auth error so the UI (and we) can see if listChannels
		// works against real Teams. graphFetch throws `graph_error:<code>:<message>` and stamps `status`.
		// A dead refresh token (invalid_grant) also flips the connection to `error` → reconnect.
		return providerErrorMarkingAuthDeath(doc, err, 'list_channels_failed');
	}
}

/**
 * A direct chat (1:1 or group DM) as returned to the client for the "Chats" section. The `externalId`
 * is the provider-native chat id — the SAME token the messages/sendMessage routes take (the provider
 * detects a chat id vs a channel id), so the frontend reads/posts a DM exactly like a channel.
 */
export type ClientDirectChat = {
	/** Provider-native chat id (Teams: a chat id, NOT a `teamId|channelId` composite). */
	externalId: string;
	/** Human label — the other member's name (1:1) or the group's topic / member names. */
	name: string;
	/** True for a group DM (3+ people), false for a 1:1. */
	isGroup: boolean;
	/** Feel-alive fields (optional; only set by providers that report them). lastActivity is epoch-ms. */
	unreadCount?: number;
	mentionCount?: number;
	lastActivity?: number;
	avatarUrl?: string;
	presence?: 'active' | 'away' | 'dnd' | 'offline';
};

/** A person in the org/workspace directory, as returned to the client for the "People" section. */
export type ClientMember = {
	/** Provider-native user id. */
	externalId: string;
	displayName: string;
	/** Email (Teams/Google) or handle (Slack), when the provider exposes it. */
	email?: string;
	/** Feel-alive fields (optional; only set by providers that report them). */
	avatarUrl?: string;
	presence?: 'active' | 'away' | 'dnd' | 'offline';
};

/**
 * List the direct chats (1:1 + group DMs) of ONE of the caller's OWN connections, for the "Chats"
 * section. Gates identically to listMyChannels (ownership / status / creds via
 * resolveDiscoveryConnection), then calls the provider's REAL `listDirectChats` (Microsoft Graph
 * `GET /me/chats` for Teams). On a Graph/auth/config error it returns a structured ProviderError (NOT
 * swallowed). A provider that doesn't implement DMs (`listDirectChats` absent) returns an empty list
 * so the UI simply shows no Chats section.
 *
 * `connectionId` is optional: when omitted, the user's most recent `connected` connection for
 * `provider` is used (same resolution as listMyChannels).
 */
export async function listMyDirectChats(
	userId: string,
	opts: { connectionId?: string; provider?: ExternalProvider },
): Promise<{ chats: ClientDirectChat[]; connection: ClientConnection } | ProviderError> {
	const resolved = await resolveDiscoveryConnection(userId, opts, 'chats');
	if ('error' in resolved) {
		return resolved;
	}
	const { doc, connection } = resolved;

	try {
		const provider = providerRegistry.get(doc.provider);
		// A provider with no DM concept omits listDirectChats — surface an empty Chats section, not an error.
		if (typeof provider.listDirectChats !== 'function') {
			return { chats: [], connection: toClientConnection(doc) };
		}
		const chats = await provider.listDirectChats(connection);
		const storeCounts = await storeUnreadForConnection(doc);
		const clientChats: ClientDirectChat[] = chats.map((c: IProviderDirectChat) => ({
			externalId: c.externalId,
			name: c.name,
			isGroup: c.isGroup,
			...(Math.max(c.unreadCount ?? 0, storeCounts.get(c.externalId) ?? 0) > 0
				? { unreadCount: Math.max(c.unreadCount ?? 0, storeCounts.get(c.externalId) ?? 0) }
				: {}),
			...(c.mentionCount !== undefined ? { mentionCount: c.mentionCount } : {}),
			...(c.lastActivity !== undefined ? { lastActivity: c.lastActivity } : {}),
			...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}),
			...(c.presence ? { presence: c.presence } : {}),
		}));
		return { chats: clientChats, connection: toClientConnection(doc) };
	} catch (err) {
		// DO NOT swallow — surface the real Graph/auth error (e.g. Chat.Read missing) so the UI can show it.
		// A dead refresh token (invalid_grant) also flips the connection to `error` → reconnect.
		return providerErrorMarkingAuthDeath(doc, err, 'list_direct_chats_failed');
	}
}

/**
 * List the org/workspace people of ONE of the caller's OWN connections, for the "People" section.
 * Gates identically to listMyChannels (ownership / status / creds), then calls the provider's REAL
 * `listMembers` (Microsoft Graph aggregated team members for Teams). On a Graph/auth/config error it
 * returns a structured ProviderError (NOT swallowed). A provider that doesn't implement a roster
 * (`listMembers` absent) returns an empty list so the UI simply shows no People section.
 *
 * `connectionId` is optional: when omitted, the user's most recent `connected` connection for
 * `provider` is used (same resolution as listMyChannels).
 */
export async function listMyMembers(
	userId: string,
	opts: { connectionId?: string; provider?: ExternalProvider },
): Promise<{ members: ClientMember[]; connection: ClientConnection } | ProviderError> {
	const resolved = await resolveDiscoveryConnection(userId, opts, 'people');
	if ('error' in resolved) {
		return resolved;
	}
	const { doc, connection } = resolved;

	try {
		const provider = providerRegistry.get(doc.provider);
		// A provider with no cheap roster omits listMembers — surface an empty People section, not an error.
		if (typeof provider.listMembers !== 'function') {
			return { members: [], connection: toClientConnection(doc) };
		}
		const members = await provider.listMembers(connection);
		const clientMembers: ClientMember[] = members.map((m: IProviderMember) => ({
			externalId: m.externalId,
			displayName: m.displayName,
			...(m.email ? { email: m.email } : {}),
			...(m.avatarUrl ? { avatarUrl: m.avatarUrl } : {}),
			...(m.presence ? { presence: m.presence } : {}),
		}));
		return { members: clientMembers, connection: toClientConnection(doc) };
	} catch (err) {
		// DO NOT swallow — surface the real Graph/auth error (e.g. TeamMember.Read.All missing) for the UI.
		// A dead refresh token (invalid_grant) also flips the connection to `error` → reconnect.
		return providerErrorMarkingAuthDeath(doc, err, 'list_members_failed');
	}
}

/**
 * Normalize any provider/Graph error into the structured ProviderError envelope the UI renders.
 * graphFetch throws `graph_error:<code>:<message>` and stamps `.status`/`.graphCode`; everything
 * else (config gate, decode, not_implemented) rides back as its message. NOT swallowed — see WS-5.
 */
function providerError(err: unknown, fallbackCode: string): ProviderError {
	const message = err instanceof Error ? err.message : String(err);
	const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined;
	const graphCode = (err as { graphCode?: string })?.graphCode;
	return { error: graphCode ? `graph_error:${graphCode}` : message.split(':')[0] || fallbackCode, message, status };
}

/**
 * Error strings that mean the stored token is DEAD (not a transient failure): the OAuth refresh
 * grant's `invalid_grant` (Teams/Google), plus Slack's auth-death codes — Slack has no refresh
 * grant, so a revoked/deactivated user token surfaces as `slack_error:invalid_auth` /
 * `token_revoked` / `account_inactive` on a regular Web API call. (Mirrored in bridgeService.)
 */
const AUTH_DEATH_MARKERS = ['invalid_grant', 'invalid_auth', 'token_revoked', 'account_inactive'];

/**
 * TOKEN DEATH (spec §3.7): external-tenant Conditional Access / admin revoke / password change
 * silently kills the refresh token — the token endpoint answers `invalid_grant` (Teams: thrown as
 * `teams_token_refresh_failed:invalid_grant`) — and a revoked Slack user token answers with the
 * Slack auth-death codes (see AUTH_DEATH_MARKERS). When a provider call died either way, flip the
 * connection to `error` so the rail/list surfaces "reconnect" instead of retrying a dead token
 * forever. Best-effort (a failed status write never masks the original error), and then normalizes
 * the error exactly like providerError.
 */
async function providerErrorMarkingAuthDeath(
	doc: IExternalWorkspaceConnection,
	err: unknown,
	fallbackCode: string,
): Promise<ProviderError> {
	const message = err instanceof Error ? err.message : String(err);
	if (AUTH_DEATH_MARKERS.some((marker) => message.includes(marker))) {
		try {
			await ExternalWorkspaceConnections.setStatusById(doc._id, 'error');
			SystemLogger.warn({ msg: 'External connection token dead — marked error (reconnect required)', connectionId: doc._id });
		} catch {
			// Status write failed — the original provider error below still tells the story.
		}
	}
	return providerError(err, fallbackCode);
}

/** A single message as returned to the client by the messages view (provider-native ids). */
export type ClientMessage = {
	/** Provider-native message id. */
	externalId: string;
	/** Display name of the author (falls back to the provider-native author id). */
	author: string;
	/** Author avatar URL, when the provider resolved it. */
	authorAvatarUrl?: string;
	/** Plain text (Teams HTML bodies are stripped to text by the provider). */
	text: string;
	/** ISO-8601 (or provider-native) creation timestamp. */
	createdAt: string;
	/** Set when the message has been edited. */
	editedAt?: string;
	/**
	 * Mentioned users resolved server-side: external user id → display name, for the mention tokens
	 * in `text` (Slack `<@U123>`). The text is NOT rewritten — the client renderer owns presentation.
	 */
	mentions?: Record<string, string>;
};

/** Same structured-error shape used everywhere a provider/Graph call can fail (alias of ListChannelsError). */
export type ProviderError = ListChannelsError;

/**
 * Load ONE of the caller's OWN connections (ownership-scoped) and rebuild its runtime credentials,
 * or return the structured reason it can't be used. Shared by the messages read/send paths so they
 * gate identically to listMyChannels (not found / wrong status / undecryptable creds).
 */
async function loadOwnedConnection(
	userId: string,
	connectionId: string,
): Promise<{ doc: IExternalWorkspaceConnection; connection: IProviderConnection } | ProviderError> {
	const doc = await ExternalWorkspaceConnections.findOneByIdAndUserId(connectionId, userId);
	if (!doc) {
		return { error: 'connection_not_found', message: 'No connected workspace found for this account.', status: 404 };
	}
	if (doc.status !== 'connected') {
		return {
			error: `connection_${doc.status}`,
			message:
				doc.status === 'consent_required'
					? 'This Teams connection needs admin consent before messages can be read or sent.'
					: 'This connection is not active — reconnect the workspace and try again.',
		};
	}
	const connection = toProviderConnection(doc);
	if (!connection) {
		return { error: 'credentials_unavailable', message: 'Stored credentials could not be read — reconnect the workspace.', status: 401 };
	}
	return { doc, connection };
}

/**
 * Read the messages of one channel in ONE of the caller's OWN connections.
 *
 * Ownership-scoped (loadOwnedConnection), decrypts creds, and calls the provider's REAL
 * `syncMessages` (Microsoft Graph for Teams; Slack stays a clear not_implemented error). Returns
 * newest-first. On any Graph/auth/config error it returns a structured ProviderError (NOT swallowed)
 * so the panel can render it plainly — including admin-consent / permission failures.
 */
/**
 * Provider history reads are heavily rate-limited — Slack throttles `conversations.history` to
 * roughly ONE request per minute for non-Marketplace apps like ours. The browse view now polls so
 * an open channel stays live, so polls are served from the durable store and the provider is only
 * topped up once per window per channel. Process-local by design: the throttle is a courtesy to the
 * provider, and a second pod simply gets its own window.
 */
const PROVIDER_HISTORY_THROTTLE_MS = 60_000;
const lastProviderHit = new Map<string, number>();

function shouldHitProvider(channelKey: string): boolean {
	const last = lastProviderHit.get(channelKey);
	return last === undefined || Date.now() - last >= PROVIDER_HISTORY_THROTTLE_MS;
}

function markProviderHit(channelKey: string): void {
	lastProviderHit.set(channelKey, Date.now());
	// Bound the map so a long-lived process across many channels can't grow it without limit.
	if (lastProviderHit.size > 5000) {
		const cutoff = Date.now() - PROVIDER_HISTORY_THROTTLE_MS;
		for (const [key, at] of lastProviderHit) {
			if (at < cutoff) {
				lastProviderHit.delete(key);
			}
		}
	}
}

export async function listMyMessages(
	userId: string,
	opts: { connectionId: string; channelExternalId: string; since?: string },
): Promise<{ messages: ClientMessage[]; connection: ClientConnection } | ProviderError> {
	const loaded = await loadOwnedConnection(userId, opts.connectionId);
	if ('error' in loaded) {
		return loaded;
	}

	const channelKey = `${loaded.doc._id}:${opts.channelExternalId}`;

	try {
		// The store is the SOURCE OF TRUTH for the browse view: once MatterChat has seen a message
		// it stays native here, so revisiting a channel never depends on the provider returning it
		// again. The provider read only tops the store up.
		const fetchedFresh = shouldHitProvider(channelKey);
		const messages: ClientMessage[] = [];

		if (fetchedFresh) {
			// Mark BEFORE the read: a failure (rate limit, outage) must also consume the window,
			// otherwise every poll would retry immediately and make throttling worse.
			markProviderHit(channelKey);
			const provider = providerRegistry.get(loaded.doc.provider);
			for await (const msg of provider.syncMessages(loaded.connection, opts.channelExternalId, opts.since)) {
				messages.push(toClientMessage(msg));
			}

			// Persist what we just read so it survives the provider's retention/rate limits. Best
			// effort — a store failure must never break the read.
			try {
				await ExternalSentMessages.recordSeenBatch(
					messages
						.filter((m) => m.externalId)
						.map((m) => ({
							userId,
							connectionId: loaded.doc._id,
							provider: loaded.doc.provider,
							channelExternalId: opts.channelExternalId,
							externalId: m.externalId,
							text: m.text,
							...(m.author ? { author: m.author } : {}),
							...(m.authorAvatarUrl ? { authorAvatarUrl: m.authorAvatarUrl } : {}),
							createdAt: new Date(m.createdAt),
							source: 'history' as const,
						})),
				);
			} catch (storeErr) {
				SystemLogger.warn({ msg: 'Connector browse: persisting history failed (read still served)', err: String(storeErr) });
			}
		}

		// Merge EVERYTHING MatterChat knows for this channel (our own sent messages, live inbound
		// events, and previously-persisted history) with whatever the provider just returned.
		// De-dupe by externalId, newest-first.
		const stored = await ExternalSentMessages.findForChannel(userId, loaded.doc._id, opts.channelExternalId);
		const seen = new Set(messages.map((m) => m.externalId).filter(Boolean));
		const extras: ClientMessage[] = stored
			.filter((s: IExternalSentMessage) => !seen.has(s.externalId))
			.map((s: IExternalSentMessage) => ({
				externalId: s.externalId,
				author: s.author ?? (s.source === 'sent' || !s.source ? 'You' : ''),
				...(s.authorAvatarUrl ? { authorAvatarUrl: s.authorAvatarUrl } : {}),
				text: s.text,
				createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
			}));

		const merged =
			extras.length > 0 ? [...messages, ...extras].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) : messages;

		return { messages: merged, connection: toClientConnection(loaded.doc) };
	} catch (err) {
		// The provider read failed (rate limit, dead token, outage). If MatterChat already holds
		// messages for this channel, serve them rather than showing the user an empty/error panel —
		// that is the whole point of the durable store.
		try {
			const stored = await ExternalSentMessages.findForChannel(userId, loaded.doc._id, opts.channelExternalId);
			if (stored.length > 0) {
				SystemLogger.warn({ msg: 'Connector browse: provider read failed — serving stored messages', err: String(err) });
				return {
					messages: stored.map((s: IExternalSentMessage) => ({
						externalId: s.externalId,
						author: s.author ?? (s.source === 'sent' || !s.source ? 'You' : ''),
						...(s.authorAvatarUrl ? { authorAvatarUrl: s.authorAvatarUrl } : {}),
						text: s.text,
						createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
					})),
					connection: toClientConnection(loaded.doc),
				};
			}
		} catch {
			// fall through to the structured provider error
		}
		// A dead refresh token (invalid_grant) also flips the connection to `error` → reconnect.
		return providerErrorMarkingAuthDeath(loaded.doc, err, 'list_messages_failed');
	}
}

/**
 * Normalize a provider timestamp to ISO-8601 for the client. Teams already sends ISO; Slack sends
 * its native `seconds.micros` epoch string ("1752796800.123456"), which the client date formatters
 * reject as an Invalid Date — date-fns THROWS on it, which crashed the whole external view the
 * moment a Slack conversation actually loaded messages. Unparseable input falls through unchanged.
 */
function toIsoTimestamp(ts: string): string {
	if (/^\d+(\.\d+)?$/.test(ts)) {
		const ms = Math.round(parseFloat(ts) * 1000);
		if (Number.isFinite(ms)) {
			return new Date(ms).toISOString();
		}
	}
	return ts;
}

/**
 * Project a provider message to the client shape; prefer the carried display name, fall back to the
 * author id. Avatar + server-resolved mentions ride through untouched. Exported for unit tests.
 */
export function toClientMessage(msg: IProviderMessage): ClientMessage {
	return {
		externalId: msg.externalId,
		author: msg.authorDisplayName || msg.authorExternalId,
		...(msg.authorAvatarUrl ? { authorAvatarUrl: msg.authorAvatarUrl } : {}),
		text: msg.text,
		createdAt: toIsoTimestamp(msg.ts),
		...(msg.editedTs ? { editedAt: toIsoTimestamp(msg.editedTs) } : {}),
		...(msg.mentions && Object.keys(msg.mentions).length ? { mentions: msg.mentions } : {}),
	};
}

/**
 * Per-pod cache of the CALLER's own resolved profile (display name + avatar), keyed by
 * connection + external user id — so the instant-send echo doesn't pay a users.info per send.
 * Unresolvable profiles are NOT cached, so a transient failure retries on the next send.
 */
const selfProfileCache = new Map<string, { author: string; authorAvatarUrl?: string }>();

/** Test hook: reset the per-pod self-profile cache. */
export function clearSelfProfileCache(): void {
	selfProfileCache.clear();
}

/**
 * Resolve the CALLER's own display name/avatar in the external workspace, for the instant-send
 * echo. The connection's own external user id (Slack: `externalSlackUserId`, stamped on the
 * credentials at connect time) is resolved through the provider's contract `resolveIdentity` —
 * the same capped users.info profile path — and cached per pod. Best-effort: no id / unresolvable
 * → `author: 'You'` (the client may substitute its own fallback), NEVER fails the send.
 */
async function resolveSelfProfile(
	doc: IExternalWorkspaceConnection,
	connection: IProviderConnection,
): Promise<{ author: string; authorAvatarUrl?: string }> {
	const selfExternalId =
		typeof connection.credentials.externalSlackUserId === 'string' && connection.credentials.externalSlackUserId
			? connection.credentials.externalSlackUserId
			: undefined;
	if (!selfExternalId) {
		return { author: 'You' };
	}
	const cacheKey = `${doc._id}:${selfExternalId}`;
	const cached = selfProfileCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	try {
		const provider = providerRegistry.get(doc.provider);
		const identity = await provider.resolveIdentity(connection, selfExternalId);
		if (identity?.displayName && identity.displayName !== selfExternalId) {
			const entry = { author: identity.displayName, ...(identity.avatarUrl ? { authorAvatarUrl: identity.avatarUrl } : {}) };
			selfProfileCache.set(cacheKey, entry);
			return entry;
		}
	} catch {
		// Attribution is cosmetic — never fail (or delay-retry) the send over it.
	}
	return { author: 'You' };
}

/**
 * Send a message to one channel in ONE of the caller's OWN connections, AS the caller.
 *
 * Ownership-scoped (loadOwnedConnection), decrypts creds, and calls the provider's REAL
 * `postMessage` (Microsoft Graph for Teams; Slack stays a clear not_implemented error). Returns the
 * created message id PLUS the created message in ClientMessage shape (`message`) so the client can
 * append it instantly without waiting for a refetch — author = the caller's own resolved external
 * display name ('You' when unresolvable), createdAt = the provider-echoed creation timestamp
 * (Slack's chat.postMessage `ts`, normalized to ISO) or now when the provider doesn't echo one.
 * On any Graph/auth/config error it returns a structured ProviderError (NOT swallowed) so the
 * panel can render it plainly.
 */
export async function sendMyMessage(
	userId: string,
	opts: { connectionId: string; channelExternalId: string; text: string },
): Promise<{ externalId: string; message: ClientMessage; connection: ClientConnection } | ProviderError> {
	if (typeof opts.text !== 'string' || !opts.text.trim()) {
		return { error: 'empty_message', message: 'A non-empty message is required.', status: 400 };
	}

	const loaded = await loadOwnedConnection(userId, opts.connectionId);
	if ('error' in loaded) {
		return loaded;
	}

	try {
		const provider = providerRegistry.get(loaded.doc.provider);
		const created = await provider.postMessage(loaded.connection, opts.channelExternalId, { text: opts.text });
		// Instant-echo message: the caller's own attribution + the provider-echoed creation ts.
		const self = await resolveSelfProfile(loaded.doc, loaded.connection);
		const createdAt = created.ts ? toIsoTimestamp(created.ts) : new Date().toISOString();
		const message: ClientMessage = {
			externalId: created.externalId,
			author: self.author,
			...(self.authorAvatarUrl ? { authorAvatarUrl: self.authorAvatarUrl } : {}),
			text: opts.text,
			createdAt,
		};
		// DURABLE RECORD: provider history APIs (Slack conversations.history) don't reliably return
		// the app's OWN sent messages, so persist what we sent — listMyMessages merges these back so
		// the user's sent messages stay visible forever, on every device. Best-effort: a store failure
		// never fails the send (the message already reached the provider).
		try {
			await ExternalSentMessages.recordSent({
				userId,
				connectionId: loaded.doc._id,
				provider: loaded.doc.provider,
				channelExternalId: opts.channelExternalId,
				externalId: created.externalId,
				text: opts.text,
				...(self.author ? { author: self.author } : {}),
				...(self.authorAvatarUrl ? { authorAvatarUrl: self.authorAvatarUrl } : {}),
				createdAt: created.ts ? new Date(createdAt) : new Date(),
			});
		} catch {
			// swallow — durable record is a best-effort enhancement, not part of the send contract.
		}
		return { externalId: created.externalId, message, connection: toClientConnection(loaded.doc) };
	} catch (err) {
		// A dead refresh token (invalid_grant) also flips the connection to `error` → reconnect.
		return providerErrorMarkingAuthDeath(loaded.doc, err, 'send_message_failed');
	}
}

/** One connection's rolled-up unread/mention counts, as returned to the rail "feel-alive" badges. */
export type UnreadSummary = { connectionId: string; unreadCount: number; mentionCount: number };

/**
 * Roll up unread + mention counts across ALL of the caller's OWN connections, for the rail badges.
 *
 * Enumerates the caller's connections (ownership-scoped via findByUserId), and for each `connected`
 * one calls the provider's optional `unreadSummary`. Best-effort PER connection: a connection whose
 * provider lacks the method, whose creds won't decrypt, or that isn't `connected`, or that throws, is
 * defaulted to 0/0 — one bad connection never fails the whole summary.
 */
export async function unreadSummaryForMyConnections(userId: string): Promise<UnreadSummary[]> {
	const docs = await ExternalWorkspaceConnections.findByUserId(userId).toArray();
	const summaries: UnreadSummary[] = [];

	for (const doc of docs) {
		// Default every connection to 0/0; only an actual provider report raises it.
		let unreadCount = 0;
		let mentionCount = 0;
		// Store-computed floor first (provider-independent; see storeUnreadForConnection).
		try {
			const storeCounts = await storeUnreadForConnection(doc);
			for (const n of storeCounts.values()) {
				unreadCount += n;
			}
		} catch {
			// keep 0 — best-effort
		}
		try {
			if (doc.status === 'connected') {
				const connection = toProviderConnection(doc);
				if (connection) {
					const provider = providerRegistry.get(doc.provider);
					const summary = await provider.unreadSummary?.(connection);
					if (summary) {
						unreadCount = Math.max(unreadCount, summary.unreadCount);
						mentionCount = summary.mentionCount;
					}
				}
			}
		} catch {
			// Provider can't report unreads (not implemented / Graph error) — keep this connection at 0/0.
		}
		summaries.push({ connectionId: doc._id, unreadCount, mentionCount });
	}

	return summaries;
}

/**
 * Mark a channel/chat read in ONE of the caller's OWN connections (best-effort).
 *
 * Ownership-scoped (loadOwnedConnection — so a real not-found / wrong-status / undecryptable-creds
 * failure rides back as a structured ProviderError), then calls the provider's optional `markRead`.
 * A provider that hasn't implemented it is a no-op success; only an ownership/auth failure surfaces.
 */
export async function markMyRead(
	userId: string,
	opts: { connectionId: string; externalId: string },
): Promise<{ ok: true } | ProviderError> {
	const loaded = await loadOwnedConnection(userId, opts.connectionId);
	if ('error' in loaded) {
		return loaded;
	}

	// OUR read-state first (authoritative for store-computed unread): stamp the last-seen marker on
	// the connection doc so badges clear regardless of whether the provider supports read-sync.
	try {
		await ExternalWorkspaceConnections.col.updateOne(
			{ _id: loaded.doc._id },
			{ $set: { [`lastSeenByChannel.${encodeChannelKey(opts.externalId)}`]: new Date() } },
		);
	} catch (err) {
		SystemLogger.warn({ msg: 'lastSeen marker write failed', connectionId: loaded.doc._id, err: String(err) });
	}

	try {
		const provider = providerRegistry.get(loaded.doc.provider);
		// Best-effort: providers without read-state support omit the method, leaving this a clean no-op.
		await provider.markRead?.(loaded.connection, opts.externalId);
	} catch (err) {
		// Best-effort TO THE CLIENT (still acks ok) — but never silent: the failure is logged and a
		// dead token (invalid_auth / token_revoked / invalid_grant) flips the connection to `error`
		// exactly like the read/send paths, so a broken read-sync (e.g. slack_error:missing_scope on
		// a pre-write-scope token) surfaces in logs + the reconnect UI instead of vanishing.
		const providerErr = await providerErrorMarkingAuthDeath(loaded.doc, err, 'mark_read_failed');
		SystemLogger.warn({
			msg: 'markRead failed (best-effort — acked ok to client)',
			connectionId: loaded.doc._id,
			provider: loaded.doc.provider,
			externalId: opts.externalId,
			error: providerErr.error,
			detail: providerErr.message,
		});
	}
	return { ok: true };
}
