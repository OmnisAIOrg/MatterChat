import type { IMessage, IReadReceipt, IReadReceiptWithUser, IRoom, IUser } from '@rocket.chat/core-typings';
import { Messages, ReadReceipts, Users } from '@rocket.chat/models';

import { notifyOnMessageChange } from '../notifyListener';
import { settings } from '../../settings';

const buildReceiptId = (messageId: IMessage['_id'], userId: IUser['_id']): string => `${messageId}-${userId}`;

/**
 * Core (MIT) read receipts service.
 *
 * Tracks which users have seen which messages:
 * - a receipt is stored per user per message (composite `_id` keeps them deduplicated);
 * - the message `unread` flag (set on send when the feature is enabled) is unset once
 *   another user reads the room, which flips the client indicator from single to double check.
 */
export const ReadReceipt = {
	/** Stores receipts for everything `userId` just read in `roomId` and flips the `unread` flag of other users' messages. */
	async markMessagesAsRead(roomId: IRoom['_id'], userId: IUser['_id'], userLastSeen?: Date): Promise<void> {
		if (!settings.get('Message_Read_Receipt_Enabled')) {
			return;
		}

		const now = new Date();
		// when the user never read this room before, all visible messages count
		const after = userLastSeen ?? new Date(0);

		// receipts are recorded for every visible message the user had not seen yet,
		// regardless of the `unread` flag (which only tracks the first reader)
		const justReadMessages = await Messages.findVisibleByRoomIdBetweenTimestampsNotContainingTypes(
			roomId,
			after,
			now,
			[],
			{ projection: { _id: 1 } },
			false,
		).toArray();

		await this.storeReadReceipts(
			justReadMessages.map(({ _id }) => ({
				_id: buildReceiptId(_id, userId),
				messageId: _id,
				roomId,
				userId,
				ts: now,
			})),
		);

		const unreadMessages = await Messages.findVisibleUnreadMessagesByRoomAndDate(roomId, after).toArray();

		// never flip the reader's own messages: only a different user viewing them counts as "read"
		const result = await Messages.setVisibleMessagesAsRead(roomId, now, userId);
		if (result.modifiedCount) {
			for (const { _id } of unreadMessages) {
				void notifyOnMessageChange({ id: _id });
			}
		}
	},

	/** The sender has trivially seen their own message; store their receipt right away. */
	async markMessageAsReadBySender(message: IMessage, roomId: IRoom['_id'], userId: IUser['_id']): Promise<void> {
		if (!settings.get('Message_Read_Receipt_Enabled')) {
			return;
		}

		await this.storeReadReceipts([
			{
				_id: buildReceiptId(message._id, userId),
				messageId: message._id,
				roomId,
				userId,
				ts: message.ts,
			},
		]);
	},

	async storeReadReceipts(receipts: Omit<IReadReceipt, '_updatedAt'>[]): Promise<void> {
		if (!settings.get('Message_Read_Receipt_Store_Users') || receipts.length === 0) {
			return;
		}

		await ReadReceipts.saveReceipts(receipts);
	},

	/** Returns the receipts of a message with the reader's data hydrated, ordered by read time. */
	async getReceipts(messageId: IMessage['_id']): Promise<IReadReceiptWithUser[]> {
		const receipts = await ReadReceipts.findByMessageId(messageId).toArray();
		if (receipts.length === 0) {
			return [];
		}

		const users = await Users.findByIds<Pick<IUser, '_id' | 'name' | 'username'>>(
			receipts.map(({ userId }) => userId),
			{ projection: { _id: 1, name: 1, username: 1 } },
		).toArray();
		const usersById = new Map(users.map((user) => [user._id, user]));

		return receipts
			.map((receipt) => ({
				...receipt,
				user: usersById.get(receipt.userId),
			}))
			.sort((a, b) => a.ts.getTime() - b.ts.getTime());
	},
};
