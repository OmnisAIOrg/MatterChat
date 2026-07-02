import type { ExternalProvider, IEncryptedTokenRef, IExternalWorkspaceConnection, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IExternalWorkspaceConnectionsModel, UpsertExternalWorkspaceConnection } from '@rocket.chat/model-typings';
import type { Collection, DeleteResult, Db, FindCursor, IndexDescription, UpdateResult } from 'mongodb';

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

	findOneByUserIdAndProviderAndOrg(
		userId: string,
		provider: ExternalProvider,
		externalOrgId: string,
	): Promise<IExternalWorkspaceConnection | null> {
		return this.findOne({ userId, provider, externalOrgId });
	}

	/**
	 * Create-or-update the single connection for a (user, provider, external org) triple. The OAuth
	 * callback calls this after a successful token exchange so re-connecting the same Teams tenant
	 * refreshes the stored credentials/status in place instead of piling up duplicate documents.
	 * Returns the connection's `_id` so the caller can reference it (e.g. for logging/redirects).
	 */
	async upsertUserConnection(
		userId: string,
		provider: ExternalProvider,
		externalOrgId: string,
		data: UpsertExternalWorkspaceConnection,
	): Promise<{ _id: string; result: UpdateResult }> {
		const now = new Date();
		const result = (await this.updateOne(
			{ userId, provider, externalOrgId },
			{
				$set: {
					externalOrgName: data.externalOrgName,
					status: data.status,
					scopes: data.scopes,
					...(data.credentials ? { credentials: data.credentials } : {}),
					...(data.lastSyncAt ? { lastSyncAt: data.lastSyncAt } : {}),
				},
				$setOnInsert: {
					userId,
					provider,
					externalOrgId,
					createdAt: now,
				},
			},
			{ upsert: true },
		)) as UpdateResult;

		const doc = await this.findOne({ userId, provider, externalOrgId }, { projection: { _id: 1 } });

		return { _id: doc?._id ?? String(result.upsertedId ?? ''), result };
	}

	deleteByIdAndUserId(id: string, userId: string): Promise<DeleteResult> {
		// Ownership-scoped delete: a user can only remove their OWN connection.
		return this.deleteOne({ _id: id, userId });
	}

	/**
	 * Persist a re-encrypted credential blob after a mid-call token refresh (rotated refresh token /
	 * new access token). Touches ONLY the credentials field — status/scopes/name are untouched. Not
	 * ownership-scoped: the caller (connectionService) already loaded the doc ownership-scoped and
	 * passes its own `_id` back.
	 */
	updateCredentialsById(id: string, credentials: IEncryptedTokenRef): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { credentials } });
	}

	/** Flip a connection's lifecycle status (e.g. `error` on refresh-token death — spec §3.7). */
	setStatusById(id: string, status: IExternalWorkspaceConnection['status']): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { status } });
	}
}
