import type { IMessage, IReadReceiptWithUser } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Messages } from '@rocket.chat/models';
import { check } from 'meteor/check';
import { Meteor } from 'meteor/meteor';

import { canAccessRoomIdAsync } from '../../lib/authorization/canAccessRoom';
import { ReadReceipt } from '../../lib/message-read-receipt/ReadReceipt';
import { settings } from '../../settings';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		getReadReceipts(params: { messageId: IMessage['_id'] }): IReadReceiptWithUser[];
	}
}

export const getReadReceipts = async (messageId: IMessage['_id'], uid: string): Promise<IReadReceiptWithUser[]> => {
	if (!settings.get('Message_Read_Receipt_Enabled') || !settings.get('Message_Read_Receipt_Store_Users')) {
		throw new Meteor.Error('error-not-allowed', 'Read receipts are not enabled', { method: 'getReadReceipts' });
	}

	const message = await Messages.findOneById(messageId);
	if (!message) {
		throw new Meteor.Error('error-invalid-message', 'Invalid message', { method: 'getReadReceipts' });
	}

	if (!(await canAccessRoomIdAsync(message.rid, uid))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'getReadReceipts' });
	}

	return ReadReceipt.getReceipts(messageId);
};

Meteor.methods<ServerMethods>({
	async getReadReceipts({ messageId }) {
		const uid = Meteor.userId();
		if (!uid) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', { method: 'getReadReceipts' });
		}

		check(messageId, String);

		return getReadReceipts(messageId, uid);
	},
});
