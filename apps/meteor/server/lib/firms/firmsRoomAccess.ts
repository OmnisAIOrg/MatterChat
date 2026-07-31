import { Settings } from '@rocket.chat/core-services';
import type { IRoom, IUser } from '@rocket.chat/core-typings';
import { Rooms, Subscriptions, Users } from '@rocket.chat/models';

/**
 * MATTERCHAT: firm cohort enforcement for room ACCESS (2026-07-30 fixer).
 *
 * firmsRoomScope.ts scopes DISCOVERY — the enumeration surfaces (directory,
 * channels.list, spotlight, teams.autocomplete). That alone is a UI curtain:
 * `_validateAccessToPublicRooms` in server/services/authorization/canAccessRoom.ts
 * returns true for ANY user holding `preview-c-room` (granted to role `user`),
 * so once a firm-A member learns another firm's room id or name — channel names
 * in this product are matter/case names, i.e. guessable — `channels.info`,
 * `channels.history`, `channels.members`, `channels.files` and `channels.join`
 * all succeed. This module closes that: a non-member whose cohort does not match
 * the room's `customFields.firmId` is denied at canAccessRoom, which covers every
 * one of those endpoints in one place.
 *
 * Deliberately does NOT import firmsService: that module pulls in
 * findOrCreateInvite → authorization, and canAccessRoom lives inside the
 * authorization service. Only lean model/settings imports here.
 *
 * Invariants preserved from the discovery scope:
 *  - a room WITHOUT a firmId is legacy / workspace-wide → always allowed;
 *  - MEMBERSHIP always wins: a user with a subscription keeps access regardless
 *    of the stamp (scoping never removes access to a room you are already in);
 *  - admins, feature-off and scoping-off are all no-ops.
 */

type RoomForFirmAccess = Pick<IRoom, '_id'> & { customFields?: IRoom['customFields'] };

const firmScopingEnabled = async (): Promise<boolean> =>
	(await Settings.get<boolean>('Firms_SelfServe_Enabled')) === true && (await Settings.get<boolean>('Firms_Scoped_Directory')) === true;

const readFirmId = (customFields: Record<string, unknown> | undefined): string | undefined => {
	const firmId = customFields?.firmId;
	return typeof firmId === 'string' && firmId ? firmId : undefined;
};

/**
 * True when `user` may access `room` as far as firm cohorts are concerned.
 * Returning true here does NOT grant access — the caller's other checks still
 * apply; this is purely an additional denial condition.
 */
export async function isRoomAllowedByFirmCohort(
	room: RoomForFirmAccess | undefined,
	user: Pick<IUser, '_id'> | undefined,
): Promise<boolean> {
	if (!room?._id) {
		return true;
	}
	if (!(await firmScopingEnabled())) {
		return true;
	}

	// `customFields` may not have been projected by the caller — re-read only then.
	let firmId = readFirmId(room.customFields as Record<string, unknown> | undefined);
	if (!firmId && room.customFields === undefined) {
		const full = await Rooms.findOneById<Pick<IRoom, '_id' | 'customFields'>>(room._id, { projection: { customFields: 1 } });
		firmId = readFirmId(full?.customFields as Record<string, unknown> | undefined);
	}
	if (!firmId) {
		return true; // unstamped / legacy room — workspace-wide
	}

	if (!user?._id) {
		return false; // anonymous callers never reach a firm-stamped room
	}

	const caller = await Users.findOneById<Pick<IUser, '_id' | 'roles' | 'customFields'>>(user._id, {
		projection: { roles: 1, customFields: 1 },
	});
	if (caller?.roles?.includes('admin')) {
		return true;
	}
	if (readFirmId(caller?.customFields as Record<string, unknown> | undefined) === firmId) {
		return true;
	}

	// Membership always wins over the stamp.
	const subscription = await Subscriptions.findOneByRoomIdAndUserId(room._id, user._id, { projection: { _id: 1 } });
	return Boolean(subscription);
}
