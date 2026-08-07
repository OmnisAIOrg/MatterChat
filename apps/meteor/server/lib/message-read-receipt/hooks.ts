import { isEditedMessage } from '@rocket.chat/core-typings';
import type { IRoom, IUser } from '@rocket.chat/core-typings';
import { ReadReceipts } from '@rocket.chat/models';

import { settings } from '../../settings';
import { callbacks } from '../callbacks';
import { ReadReceipt } from './ReadReceipt';

const READ_DEBOUNCE_MS = 2000;

const pendingReads = new Map<string, { timer: NodeJS.Timeout; lastSeen: Date }>();

/** Debounces bursts of read events per room+user, keeping the earliest `lastSeen` so no message is skipped. */
const scheduleMarkMessagesAsRead = (roomId: IRoom['_id'], userId: IUser['_id'], lastSeen: Date): void => {
	const key = `${roomId}:${userId}`;

	const pending = pendingReads.get(key);
	if (pending) {
		clearTimeout(pending.timer);
		lastSeen = pending.lastSeen < lastSeen ? pending.lastSeen : lastSeen;
	}

	const timer = setTimeout(() => {
		pendingReads.delete(key);
		void ReadReceipt.markMessagesAsRead(roomId, userId, lastSeen);
	}, READ_DEBOUNCE_MS);

	pendingReads.set(key, { timer, lastSeen });
};

// write-path hooks only run while the feature is enabled
settings.watch<boolean>('Message_Read_Receipt_Enabled', (enabled) => {
	if (!enabled) {
		callbacks.remove('afterSaveMessage', 'message-read-receipt-after-save-message');
		callbacks.remove('afterReadMessages', 'message-read-receipt-after-read-messages');
		return;
	}

	callbacks.add(
		'afterSaveMessage',
		async (message, { room }) => {
			// edits don't create receipts; livechat visitors are out of scope for the MVP
			if (isEditedMessage(message) || room.t === 'l') {
				return;
			}

			await ReadReceipt.markMessageAsReadBySender(message, room._id, message.u._id);
		},
		callbacks.priority.MEDIUM,
		'message-read-receipt-after-save-message',
	);

	callbacks.add(
		'afterReadMessages',
		(room, { uid, lastSeen, tmid }) => {
			// thread read receipts are out of scope for the MVP
			if (tmid || !lastSeen || room.t === 'l') {
				return;
			}

			scheduleMarkMessagesAsRead(room._id, uid, lastSeen);
		},
		callbacks.priority.MEDIUM,
		'message-read-receipt-after-read-messages',
	);
});

// receipts of a deleted room are gone regardless of the setting state
callbacks.add(
	'afterDeleteRoom',
	async (rid) => {
		await ReadReceipts.removeByRoomId(rid);
		return rid;
	},
	callbacks.priority.LOW,
	'message-read-receipt-after-delete-room',
);
