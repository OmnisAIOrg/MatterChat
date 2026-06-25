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
	'/v1/external-workspaces.disconnect': {
		POST: (params: { connectionId: string }) => { disconnected: boolean };
	};
};
