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
};
