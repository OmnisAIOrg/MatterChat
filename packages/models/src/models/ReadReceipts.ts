import type { IReadReceipt, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IReadReceiptsModel } from '@rocket.chat/model-typings';
import type { BulkWriteResult, Collection, Db, DeleteResult, FindCursor, IndexDescription } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class ReadReceiptsRaw extends BaseRaw<IReadReceipt> implements IReadReceiptsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IReadReceipt>>) {
		super(db, 'read_receipts', trash);
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
