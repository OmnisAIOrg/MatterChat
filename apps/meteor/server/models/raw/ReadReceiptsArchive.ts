import type { IReadReceipt, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IReadReceiptsModel } from '@rocket.chat/model-typings';
import { BaseRaw } from '@rocket.chat/models';
import type { BulkWriteResult, Collection, Db, DeleteResult, FindCursor, IndexDescription } from 'mongodb';

/**
 * MATTERCHAT: MIT raw model for the read-receipts ARCHIVE collection
 * (`read_receipts_archive`). Upstream registered a model under the
 * `IReadReceiptsArchiveModel` namespace only from the EE tree; this fork keeps
 * read receipts as an MIT feature, so the model is re-provided here (clean-room,
 * written against the MIT `IReadReceiptsModel` interface — the type the
 * `ReadReceiptsArchive` proxy in `packages/models/src/index.ts` is declared with).
 *
 * Without this registration every dereference of the proxy throws
 * `Model IReadReceiptsArchiveModel not found` (packages/models/src/proxify.ts) —
 * e.g. deleting a message, pruning room history, deleting a user/guest, or
 * closing a livechat room.
 *
 * The archive itself is populated by `server/cron/readReceiptsArchive.ts`,
 * driven by the MIT `Message_Read_Receipt_Archive_*` settings.
 */
export class ReadReceiptsArchiveRaw extends BaseRaw<IReadReceipt> implements IReadReceiptsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IReadReceipt>>) {
		super(db, 'read_receipts_archive', trash);
	}

	protected override modelIndexes(): IndexDescription[] {
		return [{ key: { messageId: 1 } }, { key: { roomId: 1, userId: 1 } }, { key: { ts: -1 } }];
	}

	findByMessageId(messageId: string): FindCursor<IReadReceipt> {
		return this.find({ messageId });
	}

	removeByUserId(userId: string): Promise<DeleteResult> {
		return this.deleteMany({ userId });
	}

	removeByRoomId(roomId: string): Promise<DeleteResult> {
		return this.deleteMany({ roomId });
	}

	removeByRoomIds(roomIds: string[]): Promise<DeleteResult> {
		return this.deleteMany({ roomId: { $in: roomIds } });
	}

	removeByMessageId(messageId: string): Promise<DeleteResult> {
		return this.deleteMany({ messageId });
	}

	removeByMessageIds(messageIds: string[]): Promise<DeleteResult> {
		return this.deleteMany({ messageId: { $in: messageIds } });
	}

	findOlderThan(date: Date): FindCursor<IReadReceipt> {
		return this.find({ ts: { $lt: date } });
	}

	/** Idempotent bulk move-target: upserts by `_id`, so re-archiving after a partial run is safe. */
	saveReceipts(receipts: Omit<IReadReceipt, '_updatedAt'>[]): Promise<BulkWriteResult> {
		return this.col.bulkWrite(
			receipts.map(({ _id, ...receipt }) => ({
				updateOne: {
					filter: { _id },
					update: {
						$setOnInsert: { ...receipt, _updatedAt: new Date() },
					},
					upsert: true,
				},
			})),
			{ ordered: false },
		);
	}
}
