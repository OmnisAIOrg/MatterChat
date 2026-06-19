import type { IBoardNotification } from '@rocket.chat/core-typings';
import type { Document, FindCursor, FindOptions, InsertOneResult, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsNotificationsModel extends IBaseModel<IBoardNotification> {
	/** Append a notification row (the delivery seam writes one per watcher). */
	createNotification(notification: Omit<IBoardNotification, '_id' | '_updatedAt'>): Promise<InsertOneResult<IBoardNotification>>;

	/** The bell's unread feed (newest first). */
	findUnreadByUser(userId: string, options?: FindOptions<IBoardNotification>): FindCursor<IBoardNotification>;

	/** The inbox feed (read + unread, newest first; paginated via options). */
	findByUser(userId: string, options?: FindOptions<IBoardNotification>): FindCursor<IBoardNotification>;

	/** The bell badge count. */
	countUnread(userId: string): Promise<number>;

	/** Flip one notification to read (scoped to its owner). */
	markRead(userId: string, notificationId: string): Promise<UpdateResult>;

	/** Flip every unread notification for a user to read ("mark all read"). */
	markAllRead(userId: string): Promise<Document | UpdateResult>;
}
