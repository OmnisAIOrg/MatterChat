import type { ExternalProvider, IEncryptedTokenRef, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
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
}
