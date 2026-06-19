import type { IBoardNotification, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsNotificationsModel } from '@rocket.chat/model-typings';
import type {
	Collection,
	Db,
	Document,
	FindCursor,
	FindOptions,
	IndexDescription,
	InsertOneResult,
	UpdateResult,
} from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsNotificationsRaw extends BaseRaw<IBoardNotification> implements IBoardsNotificationsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IBoardNotification>>) {
		super(db, 'boards_notifications', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			// the bell: unread-first feed + count
			{ key: { userId: 1, read: 1, createdAt: -1 } },
			// the inbox feed (read + unread, newest first)
			{ key: { userId: 1, createdAt: -1 } },
		];
	}

	public createNotification(
		notification: Omit<IBoardNotification, '_id' | '_updatedAt'>,
	): Promise<InsertOneResult<IBoardNotification>> {
		return this.insertOne(notification);
	}

	public findUnreadByUser(userId: string, options?: FindOptions<IBoardNotification>): FindCursor<IBoardNotification> {
		return this.find({ userId, read: false }, { sort: { createdAt: -1 }, ...options });
	}

	public findByUser(userId: string, options?: FindOptions<IBoardNotification>): FindCursor<IBoardNotification> {
		return this.find({ userId }, { sort: { createdAt: -1 }, ...options });
	}

	public countUnread(userId: string): Promise<number> {
		return this.countDocuments({ userId, read: false });
	}

	public markRead(userId: string, notificationId: string): Promise<UpdateResult> {
		// scope by userId so a user can only mark their OWN notifications read
		return this.updateOne(
			{ _id: notificationId, userId },
			{ $set: { read: true, readAt: new Date() } },
		);
	}

	public markAllRead(userId: string): Promise<Document | UpdateResult> {
		return this.updateMany(
			{ userId, read: false },
			{ $set: { read: true, readAt: new Date() } },
		);
	}
}
