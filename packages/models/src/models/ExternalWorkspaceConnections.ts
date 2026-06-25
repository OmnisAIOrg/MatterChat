import type { ExternalProvider, IExternalWorkspaceConnection, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IExternalWorkspaceConnectionsModel } from '@rocket.chat/model-typings';
import type { Collection, DeleteResult, Db, FindCursor, IndexDescription } from 'mongodb';

import { BaseRaw } from './BaseRaw';

/**
 * Raw model for the per-user `external_workspace_connections` collection (final Mongo name:
 * `rocketchat_external_workspace_connections` — BaseRaw adds the prefix).
 *
 * Stores one document per (MatterChat user, external Slack/Teams workspace). Encrypted token
 * references live on the document; raw tokens never do. Indexed by `{ userId, provider }` so the
 * rail/list endpoint can fetch a user's connections cheaply.
 */
export class ExternalWorkspaceConnectionsRaw extends BaseRaw<IExternalWorkspaceConnection> implements IExternalWorkspaceConnectionsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IExternalWorkspaceConnection>>) {
		super(db, 'external_workspace_connections', trash);
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			// Primary access pattern: "list this user's connections (optionally by provider)".
			{ key: { userId: 1, provider: 1 } },
			// Look up the connection(s) for a given external workspace (e.g. shared-subscription fan-out).
			{ key: { provider: 1, externalOrgId: 1 } },
		];
	}

	findByUserId(userId: string): FindCursor<IExternalWorkspaceConnection> {
		return this.find({ userId }, { sort: { createdAt: -1 } });
	}

	findByUserIdAndProvider(userId: string, provider: ExternalProvider): FindCursor<IExternalWorkspaceConnection> {
		return this.find({ userId, provider }, { sort: { createdAt: -1 } });
	}

	findOneByIdAndUserId(id: string, userId: string): Promise<IExternalWorkspaceConnection | null> {
		// Ownership-scoped: returns null if the connection exists but belongs to someone else.
		return this.findOne({ _id: id, userId });
	}

	deleteByIdAndUserId(id: string, userId: string): Promise<DeleteResult> {
		// Ownership-scoped delete: a user can only remove their OWN connection.
		return this.deleteOne({ _id: id, userId });
	}
}
