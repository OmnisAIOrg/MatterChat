import type { IReadReceipt } from '@rocket.chat/core-typings';
import type { BulkWriteResult, FindCursor, DeleteResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IReadReceiptsModel extends IBaseModel<IReadReceipt> {
	findByMessageId(messageId: string): FindCursor<IReadReceipt>;
	removeByUserId(userId: string): Promise<DeleteResult>;
	removeByRoomId(roomId: string): Promise<DeleteResult>;
	removeByRoomIds(roomIds: string[]): Promise<DeleteResult>;
	removeByMessageId(messageId: string): Promise<DeleteResult>;
	removeByMessageIds(messageIds: string[]): Promise<DeleteResult>;
	findOlderThan(date: Date): FindCursor<IReadReceipt>;
	saveReceipts(receipts: Omit<IReadReceipt, '_updatedAt'>[]): Promise<BulkWriteResult>;
}
