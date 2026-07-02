import { AppEvents, Apps } from '@rocket.chat/apps';
import { Message, Team } from '@rocket.chat/core-services';
import type { IRoom, IUser, AtLeast } from '@rocket.chat/core-typings';
import { Rooms } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { isRoomUnderLegalHold } from './rooms/legalHold';
import { roomCoordinator } from './rooms/roomCoordinator';
import { hasPermissionAsync } from '../../app/authorization/server/functions/hasPermission';
import { deleteRoom } from '../../app/lib/server/functions/deleteRoom';

export async function eraseRoom(roomOrId: string | IRoom, user: AtLeast<IUser, '_id' | 'name' | 'username'>): Promise<void> {
	const room = typeof roomOrId === 'string' ? await Rooms.findOneById(roomOrId) : roomOrId;

	if (!room) {
		throw new Meteor.Error('error-invalid-room', 'Invalid room', {
			method: 'eraseRoom',
		});
	}

	if (room.federated) {
		throw new Meteor.Error('error-cannot-delete-federated-room', 'Cannot delete federated room', {
			method: 'eraseRoom',
		});
	}

	if (
		!(await roomCoordinator
			.getRoomDirectives(room.t)
			?.canBeDeleted((permissionId, rid) => hasPermissionAsync(user._id, permissionId, rid), room))
	) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', {
			method: 'eraseRoom',
		});
	}

	const team = room.teamId && (await Team.getOneById(room.teamId, { projection: { roomId: 1 } }));
	if (team && !(await hasPermissionAsync(user._id, `delete-team-${room.t === 'c' ? 'channel' : 'group'}`, team.roomId))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', {
			method: 'eraseRoom',
		});
	}

	// Litigation hold: deleting the room would destroy held messages — refuse while a hold covers
	// it (the obvious loophole around the retention/purge guards). Release the hold first via the
	// legal-hold admin surface (`manage-legal-hold`). Checked AFTER authorization so hold status is
	// only disclosed to users who could otherwise delete the room. Re-fetch the flag by id:
	// callers sometimes pass a projected room object that legitimately lacks `retention`.
	if (isRoomUnderLegalHold(await Rooms.findOneById(room._id, { projection: { 'retention.legalHold.enabled': 1 } }))) {
		throw new Meteor.Error('error-room-under-legal-hold', 'This room is under a legal hold and cannot be deleted.', {
			method: 'eraseRoom',
		});
	}

	if (Apps.self?.isLoaded()) {
		const prevent = await Apps.self?.triggerEvent(AppEvents.IPreRoomDeletePrevent, room);
		if (prevent) {
			throw new Meteor.Error('error-app-prevented-deleting', 'A Rocket.Chat App prevented the room erasing.');
		}
	}

	await deleteRoom(room._id);

	if (team) {
		await Message.saveSystemMessage('user-deleted-room-from-team', team.roomId, room.name || '', user);
	}

	if (Apps.self?.isLoaded()) {
		void Apps.self?.triggerEvent(AppEvents.IPostRoomDeleted, room);
	}
}
