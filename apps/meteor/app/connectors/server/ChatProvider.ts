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

	// ─── sync (read) ─────────────────────────────────────────────────────────────────────────

	/**
	 * Backfill historical messages for a channel (paged internally; yields oldest→newest or
	 * provider-native order — the bridge sorts). `since` is an optional cursor/timestamp.
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

	/** Post a message to an external channel AS the connection's signed-in user. */
	postMessage(connection: IProviderConnection, channelExternalId: string, message: IOutboundMessage): Promise<{ externalId: string }>;
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
