import type { IRoom } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Subscriptions } from '@rocket.chat/models';
import { Match, check } from 'meteor/check';
import { Meteor } from 'meteor/meteor';

import { notifyOnSubscriptionChangedByRoomIdAndUserId } from '../../lib/notifyListener';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		setRoomFolder(rid: IRoom['_id'], folder?: string): Promise<number>;
	}
}

/**
 * File (or unfile) the caller's subscription for a room under a sidebar folder.
 * Passing an empty/undefined folder removes the assignment. Mirrors toggleFavorite.
 */
export const setRoomFolderMethod = async (userId: string, rid: IRoom['_id'], folder?: string): Promise<number> => {
	const userSubscription = await Subscriptions.findOneByRoomIdAndUserId(rid, userId);
	if (!userSubscription) {
		throw new Meteor.Error('error-invalid-subscription', 'You must be part of a room to file it', { method: 'setRoomFolder' });
	}

	const { modifiedCount } = await Subscriptions.setFolderByRoomIdAndUserId(rid, userId, folder);

	if (modifiedCount) {
		void notifyOnSubscriptionChangedByRoomIdAndUserId(rid, userId);
	}

	return modifiedCount;
};

Meteor.methods<ServerMethods>({
	async setRoomFolder(rid, folder) {
		check(rid, String);
		check(folder, Match.Optional(String));
		const userId = Meteor.userId();

		if (!userId) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', { method: 'setRoomFolder' });
		}

		return setRoomFolderMethod(userId, rid, folder);
	},
});
