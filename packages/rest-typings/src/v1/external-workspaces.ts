/**
 * REST typings for the per-user external-workspace connectors (Slack / Teams).
 *
 * These type the endpoints registered in apps/meteor/app/api/server/v1/external-workspaces.ts so the
 * client can call them through `useEndpoint` with full type-safety (params + result). Mirrors the
 * server's `ClientConnection` / `ClientChannelGroup` projections — the encrypted credential blob is
 * NEVER part of the client type.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §4.
 */
import type { ExternalProvider, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';

/** Client-safe connection projection — everything EXCEPT the encrypted credential blob. */
export type ExternalWorkspaceClientConnection = Omit<IExternalWorkspaceConnection, 'credentials' | '_updatedAt'>;

/** A single external channel, as shown in the "connected channels" view. */
export type ExternalWorkspaceChannel = {
	externalId: string;
	name: string;
	teamName: string;
	isPrivate: boolean;
	topic?: string;
	/** Unread message count for this channel, when the provider reports it ("feel-alive" badge). */
	unreadCount?: number;
	/** Count of messages that @-mention the connection's user, when the provider reports it. */
	mentionCount?: number;
	/** Epoch-ms of the last activity in this channel, when the provider reports it (sort/recency). */
	lastActivity?: number;
};

/** Channels grouped by their team. */
export type ExternalWorkspaceChannelGroup = {
	teamName: string;
	channels: ExternalWorkspaceChannel[];
};

/**
 * The "list channels" result. A discriminated union delivered inside a 200 envelope: a real
 * Graph/auth/config failure rides back as `{ ok:false, error, message, status }` (NOT swallowed) so
 * the UI can show it plainly — the RC REST client rejects 4xx bodies with the raw Response, which
 * would otherwise hide the message.
 */
export type ExternalWorkspaceChannelsResult =
	| { ok: true; groups: ExternalWorkspaceChannelGroup[]; connection: ExternalWorkspaceClientConnection }
	| { ok: false; error: string; message: string; status?: number };

/**
 * A single direct chat (1:1 or group DM) in the "Chats" section. `externalId` is the provider-native
 * chat id — the SAME token the messages/sendMessage endpoints take (the provider detects a chat id vs
 * a channel id), so the client reads/posts a DM exactly like a channel.
 */
export type ExternalWorkspaceDirectChat = {
	externalId: string;
	name: string;
	/** True for a group DM (3+ people), false for a 1:1. */
	isGroup: boolean;
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
};

/**
 * The "list direct chats" result. Same 200-envelope discriminated union as channels: a real
 * Graph/auth/config failure rides back as `{ ok:false, error, message, status }` (NOT swallowed).
 */
export type ExternalWorkspaceDirectChatsResult =
	| { ok: true; chats: ExternalWorkspaceDirectChat[]; connection: ExternalWorkspaceClientConnection }
	| { ok: false; error: string; message: string; status?: number };

/** A single person in the org/workspace directory, for the "People" section. */
export type ExternalWorkspaceMember = {
	externalId: string;
	displayName: string;
	/** Email (Teams/Google) or handle (Slack), when the provider exposes it. */
	email?: string;
	/** Profile avatar URL, when the provider exposes it. */
	avatarUrl?: string;
	/** Presence/status, when the provider exposes it. */
	presence?: 'active' | 'away' | 'dnd' | 'offline';
};

/**
 * The "list members" result. Same 200-envelope discriminated union as channels: a real
 * Graph/auth/config failure rides back as `{ ok:false, error, message, status }` (NOT swallowed).
 */
export type ExternalWorkspaceMembersResult =
	| { ok: true; members: ExternalWorkspaceMember[]; connection: ExternalWorkspaceClientConnection }
	| { ok: false; error: string; message: string; status?: number };

/** A single message in the "channel messages" view (provider-native ids; newest-first). */
export type ExternalWorkspaceMessage = {
	externalId: string;
	author: string;
	text: string;
	createdAt: string;
	editedAt?: string;
};

/**
 * The "read messages" result. Same 200-envelope discriminated union as channels: a real
 * Graph/auth/config failure rides back as `{ ok:false, error, message, status }` (NOT swallowed) so
 * the UI can show it plainly — admin-consent / permission errors included.
 */
export type ExternalWorkspaceMessagesResult =
	| { ok: true; messages: ExternalWorkspaceMessage[]; connection: ExternalWorkspaceClientConnection }
	| { ok: false; error: string; message: string; status?: number };

/** The "send message" result. The created provider-native message id, in the same 200 envelope. */
export type ExternalWorkspaceSendMessageResult =
	| { ok: true; externalId: string; connection: ExternalWorkspaceClientConnection }
	| { ok: false; error: string; message: string; status?: number };

/**
 * The "unread summary" result — one rolled-up unread/mention count per connection, for the rail
 * "feel-alive" badges. A connection whose provider can't report unreads (or throws) is defaulted to
 * 0/0 rather than failing the whole call. Same 200-envelope discriminated union as the other views.
 */
export type ExternalWorkspaceUnreadSummaryResult =
	| { ok: true; summaries: Array<{ connectionId: string; unreadCount: number; mentionCount: number }> }
	| { ok: false; error: string; message: string; status?: number };

/** The "mark read" result. Best-effort acknowledgement in the same 200 envelope. */
export type ExternalWorkspaceMarkReadResult = { ok: true } | { ok: false; error: string; message: string; status?: number };

export type ExternalWorkspacesEndpoints = {
	'/v1/external-workspaces.list': {
		GET: () => { connections: ExternalWorkspaceClientConnection[] };
	};
	'/v1/external-workspaces.authUrl': {
		GET: (params: { provider: ExternalProvider }) => { provider: ExternalProvider; authorizeUrl: string | null; implemented: boolean };
	};
	'/v1/external-workspaces.channels': {
		GET: (params: { connectionId?: string; provider?: ExternalProvider }) => ExternalWorkspaceChannelsResult;
	};
	'/v1/external-workspaces.directChats': {
		GET: (params: { connectionId?: string; provider?: ExternalProvider }) => ExternalWorkspaceDirectChatsResult;
	};
	'/v1/external-workspaces.members': {
		GET: (params: { connectionId?: string; provider?: ExternalProvider }) => ExternalWorkspaceMembersResult;
	};
	// `channelExternalId` is EITHER a channel id (from .channels) OR a direct-chat id (from .directChats);
	// the provider detects which (Teams: `teamId|channelId` composite = channel, bare id = DM).
	'/v1/external-workspaces.messages': {
		GET: (params: { connectionId: string; channelExternalId: string; since?: string }) => ExternalWorkspaceMessagesResult;
	};
	'/v1/external-workspaces.sendMessage': {
		POST: (params: { connectionId: string; channelExternalId: string; text: string }) => ExternalWorkspaceSendMessageResult;
	};
	'/v1/external-workspaces.disconnect': {
		POST: (params: { connectionId: string }) => { disconnected: boolean };
	};
	// Rolled-up unread/mention counts for ALL of the caller's connections — drives the rail badges.
	// No params: it enumerates the caller's own connections server-side.
	'/v1/external-workspaces.unreadSummary': {
		GET: () => ExternalWorkspaceUnreadSummaryResult;
	};
	// Mark a channel/chat read in the external workspace (best-effort). `externalId` is EITHER a channel
	// id (from .channels) OR a direct-chat id (from .directChats) — the provider detects which.
	'/v1/external-workspaces.markRead': {
		POST: (params: { connectionId: string; externalId: string }) => ExternalWorkspaceMarkReadResult;
	};
};
