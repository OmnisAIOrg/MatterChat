import type { CalendarProvider, IBoardCalendarConnection, IEncryptedTokenRef, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardCalendarConnectionsModel, UpsertBoardCalendarConnection } from '@rocket.chat/model-typings';
import type { Collection, DeleteResult, Db, FindCursor, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

/**
 * Raw model for the per-user `boards_calendar_connections` collection (final Mongo name:
 * `rocketchat_boards_calendar_connections` — BaseRaw adds the prefix).
 *
 * Stores one document per (MatterChat user, calendar provider). Encrypted token references live on the
 * document; raw tokens never do (identical contract to ExternalWorkspaceConnections — same tokenCrypto
 * scheme). Indexed by `{ userId, provider }`.
 */
export class BoardCalendarConnectionsRaw extends BaseRaw<IBoardCalendarConnection> implements IBoardCalendarConnectionsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IBoardCalendarConnection>>) {
		super(db, 'boards_calendar_connections', trash);
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			// Primary access pattern: "this user's calendar connection(s), optionally by provider".
			{ key: { userId: 1, provider: 1 }, unique: true },
			// Sync jobs scan all connected connections.
			{ key: { status: 1 } },
		];
	}

	findByUserId(userId: string): FindCursor<IBoardCalendarConnection> {
		return this.find({ userId }, { sort: { createdAt: -1 } });
	}

	findOneByUserIdAndProvider(userId: string, provider: CalendarProvider): Promise<IBoardCalendarConnection | null> {
		return this.findOne({ userId, provider });
	}

	findOneByIdAndUserId(id: string, userId: string): Promise<IBoardCalendarConnection | null> {
		// Ownership-scoped: returns null if the connection exists but belongs to someone else.
		return this.findOne({ _id: id, userId });
	}

	findConnected(provider?: CalendarProvider): FindCursor<IBoardCalendarConnection> {
		return this.find({ status: 'connected', ...(provider ? { provider } : {}) });
	}

	/**
	 * Create-or-update the single connection for a (user, provider) pair. The OAuth callback calls this
	 * after a successful token exchange so re-connecting refreshes credentials/status in place instead
	 * of piling up duplicate documents. Returns the connection's `_id`.
	 */
	async upsertUserConnection(
		userId: string,
		provider: CalendarProvider,
		data: UpsertBoardCalendarConnection,
	): Promise<{ _id: string; result: UpdateResult }> {
		const now = new Date();
		const result = await this.updateOne(
			{ userId, provider },
			{
				$set: {
					status: data.status,
					scopes: data.scopes,
					targetCalendarId: data.targetCalendarId,
					...(data.accountEmail ? { accountEmail: data.accountEmail } : {}),
					...(data.credentials ? { credentials: data.credentials } : {}),
					...(data.lastPushAt ? { lastPushAt: data.lastPushAt } : {}),
					...(data.lastPollAt ? { lastPollAt: data.lastPollAt } : {}),
				},
				$setOnInsert: {
					userId,
					provider,
					createdAt: now,
				},
			},
			{ upsert: true },
		);

		const doc = await this.findOne({ userId, provider }, { projection: { _id: 1 } });
		return { _id: doc?._id ?? String(result.upsertedId ?? ''), result };
	}

	deleteByIdAndUserId(id: string, userId: string): Promise<DeleteResult> {
		// Ownership-scoped delete: a user can only remove their OWN connection.
		return this.deleteOne({ _id: id, userId });
	}

	updateCredentialsById(id: string, credentials: IEncryptedTokenRef): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { credentials } });
	}

	setStatusById(id: string, status: IBoardCalendarConnection['status']): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { status } });
	}

	setSyncCursorById(id: string, syncCursor: string | undefined): Promise<UpdateResult> {
		return syncCursor
			? this.updateOne({ _id: id }, { $set: { syncCursor } })
			: this.updateOne({ _id: id }, { $unset: { syncCursor: 1 } });
	}

	setInboundBoardById(id: string, inboundBoardId: string | undefined, inboundListId: string | undefined): Promise<UpdateResult> {
		return inboundBoardId
			? this.updateOne({ _id: id }, { $set: { inboundBoardId, ...(inboundListId ? { inboundListId } : {}) } })
			: this.updateOne({ _id: id }, { $unset: { inboundBoardId: 1, inboundListId: 1 } });
	}

	setLastPushAtById(id: string, when: Date): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { lastPushAt: when } });
	}

	setLastPollAtById(id: string, when: Date): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { lastPollAt: when } });
	}
}
