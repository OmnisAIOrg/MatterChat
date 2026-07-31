import { isBannedSubscription } from '@rocket.chat/core-typings';
import { Invites, Subscriptions, Users } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { validateInviteToken } from './validateInviteToken';
import { RoomMemberActions } from '../../../../definition/IRoomTypeConfig';
import { adoptUserIntoFirm, isSelfServeFirmsEnabled } from '../../../../server/lib/firms/firmsService';
import { roomCoordinator } from '../../../../server/lib/rooms/roomCoordinator';
import { addUserToRoom } from '../../../lib/server/functions/addUserToRoom';

export const useInviteToken = async (userId: string, token: string) => {
	if (!userId) {
		throw new Meteor.Error('error-invalid-user', 'The user is invalid', {
			method: 'useInviteToken',
			field: 'userId',
		});
	}

	if (!token) {
		throw new Meteor.Error('error-invalid-token', 'The invite token is invalid.', {
			method: 'useInviteToken',
			field: 'token',
		});
	}

	const { inviteData, room } = await validateInviteToken(token);

	if (!(await roomCoordinator.getRoomDirectives(room.t).allowMemberAction(room, RoomMemberActions.INVITE, userId))) {
		throw new Meteor.Error('error-room-type-not-allowed', "Can't join room of this type via invite", {
			method: 'useInviteToken',
			field: 'token',
		});
	}

	const user = await Users.findOneById(userId);
	if (!user) {
		throw new Meteor.Error('error-invalid-user', 'The user is invalid', {
			method: 'useInviteToken',
			field: 'userId',
		});
	}
	const subscription = await Subscriptions.findOneByRoomIdAndUserId(room._id, user._id);
	if (subscription && isBannedSubscription(subscription)) {
		throw new Meteor.Error('error-user-is-banned', 'User is banned from this room', {
			method: 'useInviteToken',
		});
	}

	await Users.updateInviteToken(user._id, token);

	if (!subscription) {
		// MATTERCHAT: validateInviteToken's `uses < maxUses` read and this increment used to
		// be two separate operations, so N parallel redemptions of the same link all passed
		// the check before any $inc committed. Firm invites now rely on maxUses as their only
		// finite guarantee (and each redemption runs adoptUserIntoFirm below), so consume the
		// use atomically and treat "nothing consumed" as expired.
		const consumed = await Invites.consumeUseById(inviteData._id);
		if (!consumed) {
			throw new Meteor.Error('error-invite-expired', 'The invite token has expired.', {
				method: 'useInviteToken',
				field: 'maxUses',
			});
		}
	}

	// If the user already has an username, then join the invite room,
	// If no username is set yet, then the the join will happen on the setUsername method
	if (user.username) {
		await addUserToRoom(room._id, user);
	}

	// MATTERCHAT: joining a firm team's main channel via invite adopts the user
	// into that firm (self-serve firms). Best-effort; never blocks the join.
	if (
		isSelfServeFirmsEnabled() &&
		room.teamMain &&
		room.teamId &&
		(room.customFields as Record<string, unknown> | undefined)?.firmTeam === true &&
		!(user.customFields as Record<string, unknown> | undefined)?.firmId
	) {
		const firmName = (room.customFields as Record<string, unknown> | undefined)?.firmName;
		await adoptUserIntoFirm(user._id, room.teamId, typeof firmName === 'string' ? firmName : undefined);
	}

	return {
		room: {
			rid: inviteData.rid,
			prid: room.prid,
			fname: room.fname,
			name: room.name,
			t: room.t,
		},
	};
};
