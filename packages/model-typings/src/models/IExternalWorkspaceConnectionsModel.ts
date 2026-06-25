import type { ExternalProvider, IExternalWorkspaceConnection } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

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
	/** Delete a connection only if it belongs to `userId`. */
	deleteByIdAndUserId(id: string, userId: string): Promise<DeleteResult>;
}
