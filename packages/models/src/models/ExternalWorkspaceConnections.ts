import type {
	ExternalProvider,
	IBridgedChannel,
	IEncryptedTokenRef,
	IExternalWorkspaceConnection,
	RocketChatRecordDeleted,
} from '@rocket.chat/core-typings';
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
			// Outbound bridge lookup: "which connection bridges this MatterChat room?" (afterSaveMessage).
			// Sparse — most connections carry no bridgedChannels array at all.
			{ key: { 'bridgedChannels.rid': 1 }, sparse: true },
			// Inbound webhook dispatch: "which connection owns this Graph subscription?".
			{ key: { 'bridgedChannels.subscriptionId': 1 }, sparse: true },
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
	 * EVERY connection on one external workspace, bridged or not. Inbound provider events must
	 * reach the browse view even when a channel has no bridged room, so this deliberately does
	 * NOT filter on `bridgedChannels`.
	 */
	findByProviderAndOrg(provider: ExternalProvider, externalOrgId: string): FindCursor<IExternalWorkspaceConnection> {
		return this.find({ provider, externalOrgId });
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
		const result = await this.updateOne(
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
		);

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

	// ─── live message bridge (bridged channels live as subdocs on the connection) ───────────────

	/**
	 * Add a bridged channel to a connection. Guarded so the same external channel is never bridged
	 * twice on one connection (the $push only matches when no element carries the channel id).
	 */
	addBridgedChannel(connectionId: string, bridge: IBridgedChannel): Promise<UpdateResult> {
		return this.updateOne(
			{ '_id': connectionId, 'bridgedChannels.channelExternalId': { $ne: bridge.channelExternalId } },
			{ $push: { bridgedChannels: bridge } },
		);
	}

	removeBridgedChannel(connectionId: string, channelExternalId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: connectionId }, { $pull: { bridgedChannels: { channelExternalId } } });
	}

	/** The connection carrying the bridge mapped to a MatterChat room (outbound lookup). */
	findOneByBridgedRoomId(rid: string): Promise<IExternalWorkspaceConnection | null> {
		return this.findOne({ 'bridgedChannels.rid': rid });
	}

	/** The connection carrying a Graph subscription id (inbound webhook dispatch). */
	findOneByBridgedSubscriptionId(subscriptionId: string): Promise<IExternalWorkspaceConnection | null> {
		return this.findOne({ 'bridgedChannels.subscriptionId': subscriptionId });
	}

	/**
	 * Every connection (any user) bridging the SAME external channel of the SAME external org —
	 * inbound fan-out: Graph allows ONE subscription per app+channel, so one user's subscription
	 * delivers for everyone bridging that channel; this finder locates all their rooms.
	 */
	findByBridgedChannel(
		provider: ExternalProvider,
		externalOrgId: string,
		channelExternalId: string,
	): FindCursor<IExternalWorkspaceConnection> {
		return this.find({ provider, externalOrgId, 'bridgedChannels.channelExternalId': channelExternalId });
	}

	/** Every connection with at least one bridged channel (renewal timer / boot reconcile scan). */
	findAllWithBridges(provider?: ExternalProvider): FindCursor<IExternalWorkspaceConnection> {
		return this.find({
			...(provider ? { provider } : {}),
			'bridgedChannels.0': { $exists: true },
		});
	}

	/** Persist the Graph subscription (id + expiry) on one bridged channel. */
	setBridgedChannelSubscription(
		connectionId: string,
		channelExternalId: string,
		subscriptionId: string | undefined,
		subscriptionExpiresAt: Date | undefined,
	): Promise<UpdateResult> {
		return this.updateOne(
			{ '_id': connectionId, 'bridgedChannels.channelExternalId': channelExternalId },
			subscriptionId
				? {
						$set: {
							'bridgedChannels.$.subscriptionId': subscriptionId,
							...(subscriptionExpiresAt ? { 'bridgedChannels.$.subscriptionExpiresAt': subscriptionExpiresAt } : {}),
						},
					}
				: {
						$unset: { 'bridgedChannels.$.subscriptionId': 1, 'bridgedChannels.$.subscriptionExpiresAt': 1 },
					},
		);
	}

	/** Advance the inbound catch-up cursor for one bridged channel (only ever moves forward). */
	setBridgedChannelLastInboundAt(connectionId: string, channelExternalId: string, lastInboundAt: Date): Promise<UpdateResult> {
		return this.updateOne(
			{
				_id: connectionId,
				bridgedChannels: {
					$elemMatch: {
						channelExternalId,
						$or: [{ lastInboundAt: { $exists: false } }, { lastInboundAt: { $lt: lastInboundAt } }],
					},
				},
			},
			{ $set: { 'bridgedChannels.$.lastInboundAt': lastInboundAt } },
		);
	}
}
