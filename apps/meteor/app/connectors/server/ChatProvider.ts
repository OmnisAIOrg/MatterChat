/**
 * IChatProvider — the provider-pluggable abstraction for external-workspace connectors.
 *
 * This is the "interface freeze" that unblocks parallel build streams. Both the Slack
 * connector (which wraps the existing MIT SlackBridge) and the Teams connector (greenfield
 * Microsoft Graph) implement THIS interface. Callers — the org-switcher rail, the room-list
 * filter, the future provider-agnostic BridgeCore — go through the providerRegistry and the
 * IChatProvider interface; they MUST NEVER branch on the concrete provider.
 *
 * Source of truth: /Users/davidnguyen/MatterChat-staging/MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md
 *
 * Architectural rules baked into this interface:
 *  - PROVIDERS SPEAK ONLY EXTERNAL VOCABULARY. They take/return external channel/user/message
 *    ids — never Rocket.Chat _ids. The RC<->external mapping lives in BridgeCore (not built
 *    here), so providers never touch Mongo and can be unit-tested against the external API alone.
 *  - PER-USER. A IProviderConnection is owned by one MatterChat user and carries that user's own
 *    (decrypted-at-use-time) credentials. Workspace-level Slack is the degenerate case.
 *  - DELEGATED, NOT APPLICATION (Teams). The connection acts AS the signed-in user so messages
 *    post as the real human. See the spec §3.1.
 *
 * Clean-room note: this abstraction is extracted only from MIT `apps/meteor/app/slackbridge/`
 * and the Microsoft Graph docs. Nothing under `apps/meteor/ee/` was read or copied.
 */

import type { ExternalProvider } from '@rocket.chat/core-typings';

export type { ExternalProvider };

/**
 * A channel in the external workspace, in the provider's own vocabulary.
 *  - Slack: a channel/group (`C…`/`G…`).
 *  - Teams: a channel under a team (id like `19:…@thread.tacv2`).
 */
export interface IProviderChannel {
	/** Provider-native channel id. */
	externalId: string;
	name: string;
	isPrivate: boolean;
	topic?: string;
	/** Provider-native ids of the channel members, when cheaply available. */
	memberExternalIds?: string[];
	/** Unread message count for this channel, when the provider reports it ("feel-alive" badge). */
	unreadCount?: number;
	/** Count of messages that @-mention the connection's user, when the provider reports it. */
	mentionCount?: number;
	/** Epoch-ms of the last activity in this channel, when the provider reports it (sort/recency). */
	lastActivity?: number;
}

/** A user in the external workspace, in the provider's own vocabulary. */
export interface IProviderUser {
	/** Provider-native user id. */
	externalId: string;
	displayName: string;
	email?: string;
	isBot: boolean;
	avatarUrl?: string;
}

/**
 * A direct chat (1:1 or group DM) visible to the connection's user, in the provider's own
 * vocabulary. Modeled as an IProviderChannel-like item so the "Chats" section renders with the same
 * shape as channels — `externalId` is the provider-native chat id, addressed for read/post WITHOUT a
 * team (Teams: `/chats/{chatId}/messages`, not `/teams/.../channels/...`).
 */
export interface IProviderDirectChat {
	/** Provider-native chat id (Teams: `19:…@unq.gbl.spaces` 1:1 or `19:…@thread.v2` group). */
	externalId: string;
	/** Human label — the OTHER member's name (1:1) or the group's topic / joined member names. */
	name: string;
	/** True for a group DM (3+ people), false for a 1:1 — lets the UI badge group chats. */
	isGroup: boolean;
	/** Provider-native ids of the chat's members, when cheaply available. */
	memberExternalIds?: string[];
	/** Unread message count for this chat, when the provider reports it ("feel-alive" badge). */
	unreadCount?: number;
	/** Count of messages that @-mention the connection's user, when the provider reports it. */
	mentionCount?: number;
	/** Epoch-ms of the last activity in this chat, when the provider reports it (sort/recency). */
	lastActivity?: number;
	/** The other member's (1:1) / chat's avatar URL, when the provider exposes it. */
	avatarUrl?: string;
	/** The other member's presence (1:1), when the provider exposes it. */
	presence?: 'active' | 'away' | 'dnd' | 'offline';
}

/**
 * A person in the org/workspace directory, for the "People" section. Provider-native id + the
 * cheaply-available profile fields (display name, email/handle). This is the directory-roster shape;
 * IProviderUser is the per-message identity shape. They overlap but are surfaced for different views.
 */
export interface IProviderMember {
	/** Provider-native user id. */
	externalId: string;
	displayName: string;
	/** Email (Teams/Google) or handle (Slack `@…`), when the provider exposes it. */
	email?: string;
	/** Profile avatar URL, when the provider exposes it. */
	avatarUrl?: string;
	/** Presence/status, when the provider exposes it. */
	presence?: 'active' | 'away' | 'dnd' | 'offline';
}

/** A reference to a file/attachment carried by an external message. */
export interface IProviderFileRef {
	externalId: string;
	name?: string;
	mimeType?: string;
	/** Provider-native URL (may require provider auth to fetch). */
	url?: string;
	size?: number;
}

/** A message read FROM the external workspace, in the provider's own vocabulary. */
export interface IProviderMessage {
	/** Provider-native message id / timestamp (Slack `ts`, Teams message id). */
	externalId: string;
	channelExternalId: string;
	authorExternalId: string;
	/**
	 * Author display name when the provider carries it on the message itself (Teams `from.user.
	 * displayName`) — lets the bridge/UI render a name without a separate resolveIdentity lookup.
	 * Optional: not every provider/message has it (system messages, providers that only ship ids).
	 */
	authorDisplayName?: string;
	/** Plain/normalized text. Provider-specific rich formatting is normalized by the provider. */
	text: string;
	/** ISO-8601 (or provider-native) timestamp string. */
	ts: string;
	/** Thread root id when this message is a threaded reply. */
	threadExternalId?: string;
	/** Edit timestamp when the message has been edited. */
	editedTs?: string;
	files?: IProviderFileRef[];
}

/** A message to send TO the external workspace. */
export interface IOutboundMessage {
	text: string;
	/** Thread root id to reply into, when threading. */
	threadExternalId?: string;
	files?: IProviderFileRef[];
}

/**
 * Decrypted, ready-to-use credentials for a single connection. The shape is provider-specific;
 * the registry/BridgeCore obtain these by decrypting the connection's stored IEncryptedTokenRef
 * at use-time (via tokenCrypto). Raw tokens NEVER live in plaintext at rest.
 */
export interface IProviderCredentials {
	/** OAuth access token (delegated, Teams) or bot/user token (Slack). */
	accessToken?: string;
	/** OAuth refresh token, when the provider issues one (`offline_access`). */
	refreshToken?: string;
	/** External tenant/team id this credential is bound to. */
	externalOrgId?: string;
	/** Anything provider-specific (e.g. Slack app/signing config, Teams homeAccountId). */
	[key: string]: unknown;
}

/**
 * Everything a provider needs to act on behalf of ONE connection. Built by the registry/
 * BridgeCore from an IExternalWorkspaceConnection document: the connection id + owner +
 * credentials decrypted at use-time.
 */
export interface IProviderConnection {
	/** `_id` of the external_workspace_connections document. */
	connectionId: string;
	/** The MatterChat user that owns this connection (per-user model). */
	ownerUserId: string;
	/** The external workspace/tenant id. */
	externalOrgId: string;
	/** Decrypted credentials, valid for the duration of the call. */
	credentials: IProviderCredentials;
	/**
	 * OPTIONAL persistence hook the CALLER (connectionService / future BridgeCore) attaches when it
	 * builds the connection. A provider that refreshes tokens mid-call (e.g. the Teams Graph client's
	 * 401-refresh / refresh-before-expiry) invokes it with the refreshed credential FIELDS
	 * (accessToken / rotated refreshToken / expiresAt) so the caller can merge + re-encrypt + persist
	 * them on the connection document — providers still NEVER touch Mongo themselves. Absent hook =
	 * refresh stays in-memory for the call (the pre-existing behavior); best-effort by design.
	 *
	 * ADDITIVE, optional — no frozen method signature changes; existing providers/callers ignore it.
	 */
	onCredentialsRefreshed?: (refreshed: IProviderCredentials) => void | Promise<void>;
}

/** Result of verifying/establishing credentials against the external workspace. */
export interface IVerifiedConnection {
	ok: boolean;
	externalOrgId: string;
	externalOrgName: string;
	/** Scopes actually granted, echoed back for storage on the connection. */
	scopes: string[];
}

/**
 * Inbound message handler the bridge registers with `subscribe`. The provider invokes it for
 * each new/updated external message; the bridge (not the provider) maps it into Rocket.Chat.
 */
export type InboundMessageHandler = (message: IProviderMessage) => void | Promise<void>;

/** Handle returned by `subscribe`, used to stop receiving updates for a channel. */
export interface IProviderSubscription {
	/** Stop the subscription (close socket listener / delete Graph subscription / stop poll). */
	stop(): Promise<void>;
}

/**
 * The provider-pluggable connector contract. Add a provider = implement this once + register it
 * in the providerRegistry. Callers never change.
 */
export interface IChatProvider {
	/** Which provider this implementation is. The registry keys on this. */
	readonly provider: ExternalProvider;

	// ─── auth / lifecycle ────────────────────────────────────────────────────────────────────

	/**
	 * Exchange an OAuth authorization (auth code, or a provider-specific credential payload) for
	 * usable credentials. Called by the OAuth callback route after the user grants consent.
	 *
	 * NOTE: the full OAuth redirect dance (authorize URL, PKCE, token exchange) is owned by the
	 * provider's own route module (cloned from the `/_omnisai` pattern). `connect` is the
	 * server-side completion step that yields credentials to persist.
	 */
	connect(input: IProviderOAuthInput): Promise<IProviderCredentials>;

	/** Sanity-check credentials and resolve the external org id/name + granted scopes. */
	verifyCredentials(credentials: IProviderCredentials): Promise<IVerifiedConnection>;

	/** Tear down any live resources for this connection (sockets, Graph subscriptions, polls). */
	disconnect(connection: IProviderConnection): Promise<void>;

	// ─── discovery ───────────────────────────────────────────────────────────────────────────

	/** List the channels visible to this connection's user. */
	listChannels(connection: IProviderConnection): Promise<IProviderChannel[]>;

	/**
	 * List the user's direct chats — 1:1 and group DMs — as IProviderChannel-like items so the UI can
	 * render a "Chats" section. The returned `externalId` is the provider-native chat id; reading and
	 * posting reuse `syncMessages`/`postMessage` with that id, which providers MUST accept alongside a
	 * channel id (each provider detects which it was handed — see TeamsProvider's id-shape detection).
	 *
	 * Optional in the contract: a provider that has no DM concept may omit it (callers treat a missing
	 * implementation / `not_implemented` as "no Chats section").
	 */
	listDirectChats?(connection: IProviderConnection): Promise<IProviderDirectChat[]>;

	/**
	 * List the org/workspace people for a "People" section — id, display name, email/handle. Sourced
	 * from the provider's directory (Teams: aggregated team members; Slack: users.list; Google: the
	 * directory). Deduped by external id by the provider.
	 *
	 * Optional in the contract: a provider with no cheap roster may omit it (callers treat a missing
	 * implementation / `not_implemented` as "no People section").
	 */
	listMembers?(connection: IProviderConnection): Promise<IProviderMember[]>;

	// ─── sync (read) ─────────────────────────────────────────────────────────────────────────

	/**
	 * Backfill historical messages for a channel OR a direct chat (paged internally; yields
	 * oldest→newest or provider-native order — the bridge sorts). `since` is an optional
	 * cursor/timestamp. The id may be either a channel `externalId` (from `listChannels`) or a direct
	 * chat `externalId` (from `listDirectChats`); the provider detects which and addresses the right
	 * endpoint (Teams: `/teams/{teamId}/channels/{channelId}/messages` vs `/chats/{chatId}/messages`).
	 */
	syncMessages(connection: IProviderConnection, channelExternalId: string, since?: string): AsyncIterable<IProviderMessage>;

	/**
	 * Begin receiving real-time updates for a channel. Slack uses its socket; Teams uses Graph
	 * change-notifications (or a polling fallback). Returns a handle to stop. The bridge supplies
	 * the handler that maps each message into Rocket.Chat.
	 */
	subscribe(connection: IProviderConnection, channelExternalId: string, onMessage: InboundMessageHandler): Promise<IProviderSubscription>;

	// ─── identity ────────────────────────────────────────────────────────────────────────────

	/** Resolve an external user id to its profile (for ghost/alias rendering). */
	resolveIdentity(connection: IProviderConnection, externalUserId: string): Promise<IProviderUser | null>;

	// ─── write ───────────────────────────────────────────────────────────────────────────────

	/**
	 * Post a message to an external channel OR a direct chat AS the connection's signed-in user. The id
	 * may be either a channel `externalId` (from `listChannels`) or a direct chat `externalId` (from
	 * `listDirectChats`); the provider detects which and posts to the right endpoint.
	 */
	postMessage(connection: IProviderConnection, channelExternalId: string, message: IOutboundMessage): Promise<{ externalId: string }>;

	// ─── notifications / "feel-alive" ──────────────────────────────────────────────────────────

	/**
	 * Mark a channel OR direct chat read in the external workspace (clears its unread badge there). The
	 * id may be either a channel `externalId` (from `listChannels`) or a direct chat `externalId` (from
	 * `listDirectChats`); the provider detects which and addresses the right endpoint.
	 *
	 * Optional in the contract: a provider with no read-state concept may omit it (callers treat a
	 * missing implementation as a best-effort no-op — the mark-read endpoint still returns ok).
	 */
	markRead?(connection: IProviderConnection, externalId: string): Promise<void>;

	/**
	 * Roll up this connection's total unread + mention counts for the rail "feel-alive" badge — one
	 * cheap aggregate call rather than summing per-channel.
	 *
	 * Optional in the contract: a provider that can't report unreads may omit it (callers default that
	 * connection to 0/0 rather than failing the whole summary).
	 */
	unreadSummary?(connection: IProviderConnection): Promise<{ unreadCount: number; mentionCount: number }>;
}

/**
 * Input handed to `connect` once the OAuth redirect completes. Kept loose on purpose: Slack
 * (bot/app tokens or future user OAuth) and Teams (auth code + PKCE verifier + redirect) carry
 * different fields, and the concrete provider validates what it needs.
 */
export interface IProviderOAuthInput {
	/** The MatterChat user this connection belongs to. */
	ownerUserId: string;
	/** OAuth authorization code, when the provider used the auth-code flow. */
	authCode?: string;
	/** PKCE code verifier paired with the auth code. */
	codeVerifier?: string;
	/** Redirect URI used in the authorize request (must match at the token endpoint). */
	redirectUri?: string;
	/** Anything else a provider needs to complete (e.g. Slack tokens supplied directly). */
	[key: string]: unknown;
}
