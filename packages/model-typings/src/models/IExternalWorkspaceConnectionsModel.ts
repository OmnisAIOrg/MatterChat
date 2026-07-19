import type { ExternalProvider, IBridgedChannel, IEncryptedTokenRef, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

/**
 * The mutable fields the OAuth callback writes when creating/refreshing a connection. The identity
 * triple (userId, provider, externalOrgId) is supplied separately to upsertUserConnection.
 */
export type UpsertExternalWorkspaceConnection = {
	externalOrgName: string;
	status: IExternalWorkspaceConnection['status'];
	scopes: string[];
	credentials?: IEncryptedTokenRef;
	lastSyncAt?: Date;
};

/**
 * Model for the per-user `external_workspace_connections` collection.
 *
 * Every method here is scoped by `userId` by design — a user manages only their OWN
 * connections. Callers (REST routes / methods) must pass the authenticated user's id; the
 * model never returns another user's connection from these helpers.
 */
export interface IExternalWorkspaceConnectionsModel extends IBaseModel<IExternalWorkspaceConnection> {
	/** All connections owned by a user (any status), newest first. */
	findByUserId(userId: string): FindCursor<IExternalWorkspaceConnection>;
	/** All connections a user has for a specific provider. */
	findByUserIdAndProvider(userId: string, provider: ExternalProvider): FindCursor<IExternalWorkspaceConnection>;
	/** A single connection by id, but only if it belongs to `userId` (ownership-scoped lookup). */
	findOneByIdAndUserId(id: string, userId: string): Promise<IExternalWorkspaceConnection | null>;
	/** A single connection by the (user, provider, external org) identity triple. */
	findOneByUserIdAndProviderAndOrg(
		userId: string,
		provider: ExternalProvider,
		externalOrgId: string,
	): Promise<IExternalWorkspaceConnection | null>;
	/** Create-or-update the connection for a (user, provider, external org); returns its `_id`. */
	upsertUserConnection(
		userId: string,
		provider: ExternalProvider,
		externalOrgId: string,
		data: UpsertExternalWorkspaceConnection,
	): Promise<{ _id: string; result: UpdateResult }>;
	/** Delete a connection only if it belongs to `userId`. */
	deleteByIdAndUserId(id: string, userId: string): Promise<DeleteResult>;
	/**
	 * Persist a re-encrypted credential blob after a mid-call token refresh (rotated refresh token /
	 * new access token). Touches ONLY the credentials field — status/scopes/name are untouched.
	 */
	updateCredentialsById(id: string, credentials: IEncryptedTokenRef): Promise<UpdateResult>;
	/** Flip a connection's lifecycle status (e.g. `error` on refresh-token death — spec §3.7). */
	setStatusById(id: string, status: IExternalWorkspaceConnection['status']): Promise<UpdateResult>;

	// ─── live message bridge (bridged channels live as subdocs on the connection) ───────────────

	/** Add a bridged channel to a connection (no-op if the channel is already bridged there). */
	addBridgedChannel(connectionId: string, bridge: IBridgedChannel): Promise<UpdateResult>;
	/** Remove a bridged channel from a connection. */
	removeBridgedChannel(connectionId: string, channelExternalId: string): Promise<UpdateResult>;
	/** The connection carrying the bridge mapped to a MatterChat room (outbound lookup). */
	findOneByBridgedRoomId(rid: string): Promise<IExternalWorkspaceConnection | null>;
	/** The connection carrying a Graph subscription id (inbound webhook dispatch). */
	findOneByBridgedSubscriptionId(subscriptionId: string): Promise<IExternalWorkspaceConnection | null>;
	/**
	 * Every connection (any user) bridging the SAME external channel of the SAME external org —
	 * inbound fan-out: one Graph subscription per app+channel is shared across all bridging users.
	 */
	findByBridgedChannel(provider: ExternalProvider, externalOrgId: string, channelExternalId: string): FindCursor<IExternalWorkspaceConnection>;
	/** EVERY connection on one external workspace, bridged or not (inbound events → browse view). */
	findByProviderAndOrg(provider: ExternalProvider, externalOrgId: string): FindCursor<IExternalWorkspaceConnection>;
	/** Every connection with at least one bridged channel (renewal timer / boot reconcile scan). */
	findAllWithBridges(provider?: ExternalProvider): FindCursor<IExternalWorkspaceConnection>;
	/** Persist the Graph subscription (id + expiry) on one bridged channel. */
	setBridgedChannelSubscription(
		connectionId: string,
		channelExternalId: string,
		subscriptionId: string | undefined,
		subscriptionExpiresAt: Date | undefined,
	): Promise<UpdateResult>;
	/** Advance the inbound catch-up cursor for one bridged channel (only ever moves forward). */
	setBridgedChannelLastInboundAt(connectionId: string, channelExternalId: string, lastInboundAt: Date): Promise<UpdateResult>;
}
