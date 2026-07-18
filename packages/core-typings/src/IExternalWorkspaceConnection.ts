import type { IRocketChatRecord } from './IRocketChatRecord';

/**
 * External chat providers MatterChat can connect to. Extend this union (and register
 * a matching provider in the server-side providerRegistry) to add a provider — callers
 * must NEVER branch on the value; they go through the registry + ChatProvider interface.
 */
export type ExternalProvider = 'slack' | 'teams' | 'google';

/**
 * Lifecycle status of a per-user external-workspace connection.
 *
 * - `connected`        — credentials valid; the bridge can sync/post.
 * - `consent_required` — the external tenant admin (Teams) or the user (Slack OAuth) has
 *                        not yet granted the scopes we need; surface a "grant access" link.
 * - `error`            — credentials present but failing (e.g. refresh-token death); needs reconnect.
 * - `disconnected`     — the user (or we) tore the connection down; kept for history/audit.
 */
export type ExternalWorkspaceConnectionStatus = 'connected' | 'consent_required' | 'error' | 'disconnected';

/**
 * An ENCRYPTED token reference. Raw OAuth tokens are NEVER stored in Mongo in plaintext —
 * `encryptedBlob` is the output of the AES-256-GCM helper (see
 * apps/meteor/app/connectors/server/tokenCrypto.ts), and `keyId` records which encryption
 * key version produced it so keys can be rotated without losing the ability to decrypt
 * older blobs. When no encryption key is configured the helper is a no-op (dev), but the
 * field shape is identical so the storage contract never changes.
 */
export interface IEncryptedTokenRef {
	/** The `enc:v1:<iv>:<authTag>:<ciphertext>` blob (or legacy plaintext when no key is set). */
	encryptedBlob: string;
	/** Identifier of the encryption key used (e.g. `v1`), for rotation. */
	keyId: string;
}

/**
 * A LIVE-BRIDGED channel on a connection: one external channel (or direct chat) mirrored into one
 * MatterChat room. Lives as a subdocument array on the connection — the "bridged-channel model" is
 * the ExternalConnection itself, not a parallel collection. The RC room is additionally tagged
 * `importIds: ['ext:<connectionId>:<channelExternalId>']` (the spec §4.3 namespaced value) so the
 * room side is discoverable via the existing `Rooms.findOneByImportId` primitive.
 */
export interface IBridgedChannel {
	/**
	 * Provider-native channel token — the SAME opaque id the discovery endpoints emit
	 * (Teams: the `teamId|channelId` composite from listChannels, or a bare chat id).
	 */
	channelExternalId: string;
	/**
	 * The RAW id the bridge was created from, when it differed from the canonical one — e.g. a Slack
	 * People-directory USER id (`U…`) that was resolved to its im conversation id (`D…`) before
	 * persisting. Lets the client match a bridge back to the sidebar selection that created it.
	 */
	sourceExternalId?: string;
	/** Display label captured at bridge time (e.g. `Team / Channel`). */
	name: string;
	/** The MatterChat room this channel is mirrored into. */
	rid: string;
	/**
	 * Graph change-notification subscription id, when webhook realtime is live for this bridge.
	 * Absent when the webhook prerequisites (public base URL + client-state secret) are missing, or
	 * when this bridge shares another connection's subscription for the same external channel
	 * (Graph allows ONE subscription per app+channel — inbound fan-out covers the sharers).
	 */
	subscriptionId?: string;
	/** When the Graph subscription expires (max ~3 days; renewed at ~T-12h by the renewal timer). */
	subscriptionExpiresAt?: Date;
	/** Creation time of the newest inbound message ingested — the catch-up cursor for `missed` backfill. */
	lastInboundAt?: Date;
	/** When this bridge was activated. */
	createdAt: Date;
}

/**
 * PER-USER external-workspace connection record. One document per (MatterChat user, external
 * workspace) pair. This is the durable store the org-switcher rail reads to show each user's
 * own connected Slack/Teams workspaces, and the bridge reads to know which credentials to use.
 *
 * Collection: `external_workspace_connections`. Indexed by `{ userId, provider }`.
 *
 * NOTE: this is the per-user shape from the connectors spec. The legacy workspace-level Slack
 * bridge (admin settings) is the degenerate case and is surfaced separately; nothing here
 * changes that path.
 */
export interface IExternalWorkspaceConnection extends IRocketChatRecord {
	/** The MatterChat (Rocket.Chat) user that owns this connection. */
	userId: string;
	/** Which external provider this connection targets. */
	provider: ExternalProvider;
	/**
	 * The external workspace/tenant identifier:
	 *  - Slack: the workspace/team id (e.g. `T01234567`).
	 *  - Teams: the Entra ID tenant id (the `tid` claim).
	 */
	externalOrgId: string;
	/** Human-readable external workspace/tenant name, for the rail tile label. */
	externalOrgName: string;
	/** Current lifecycle status. */
	status: ExternalWorkspaceConnectionStatus;
	/** OAuth scopes actually granted on this connection (empty until consent completes). */
	scopes: string[];
	/**
	 * Encrypted credential reference. Optional because a freshly-created `consent_required`
	 * connection may exist before any token is obtained.
	 */
	credentials?: IEncryptedTokenRef;
	/** When the connection record was first created. */
	createdAt: Date;
	/** Last successful sync against the external workspace, if any. */
	lastSyncAt?: Date;
	/** Channels of this connection live-bridged into MatterChat rooms (absent = nothing bridged). */
	bridgedChannels?: IBridgedChannel[];
}
