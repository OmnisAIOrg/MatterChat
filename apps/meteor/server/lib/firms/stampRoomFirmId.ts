import type { IRoom, ITeam, IUser } from '@rocket.chat/core-typings';
import { Rooms, Team, Users } from '@rocket.chat/models';

import { isSelfServeFirmsEnabled } from './firmsService';
import { beforeCreateRoomCallback } from '../callbacks/beforeCreateRoomCallback';

/**
 * MATTERCHAT: self-serve firms — stamp `customFields.firmId` on rooms at
 * creation so the firm-scoped enumeration surfaces (spotlight, directory,
 * channels.list, teams autocomplete) can tell firms apart.
 *
 * Runs inside createRoom's beforeCreateRoom hook, the single funnel every
 * 'c'/'p' room goes through (channels.create/groups.create REST, the
 * createChannel/createPrivateGroup DDP methods, discussions, importers,
 * connector bridges, and Team.create via the Room core service). DMs are out
 * of scope (PR #166 already blocks cross-firm DMs).
 *
 * Resolution priority (mirrored by the v340 backfill):
 *   1. discussions (prid) inherit the PARENT room's firmId;
 *   2. rooms inside a team inherit the team MAIN room's firmId;
 *   3. otherwise the creator's own firmId.
 * No resolved firmId → no stamp → the room stays workspace-wide, which is the
 * legacy/global cohort by convention. Default rooms (#general etc.) are never
 * stamped.
 *
 * KNOWN EXCEPTION: the firm's own home team room cannot be stamped here — in
 * createFirm the owner's firmId is written only AFTER Team.create returns, so
 * this callback sees an unstamped owner. createFirm stamps that room itself.
 */

const getRoomFirmId = async (roomId: string | undefined): Promise<string | undefined> => {
	if (!roomId) {
		return undefined;
	}
	const room = await Rooms.findOneById<Pick<IRoom, '_id' | 'customFields'>>(roomId, { projection: { customFields: 1 } });
	const firmId = (room?.customFields as Record<string, unknown> | undefined)?.firmId;
	return typeof firmId === 'string' && firmId ? firmId : undefined;
};

beforeCreateRoomCallback.add(
	async ({ owner, room }: { owner: IUser; room: Omit<IRoom, '_id' | '_updatedAt'> }): Promise<void> => {
		if (room.t !== 'c' && room.t !== 'p') {
			return;
		}

		// channels.create REST / createChannel DDP / importers merge CALLER-SUPPLIED
		// customFields straight into the room doc — never trust an inbound firmId
		// (forgery vector), even while the firms feature is off.
		if (room.customFields && 'firmId' in room.customFields) {
			delete (room.customFields as Record<string, unknown>).firmId;
		}

		if (!isSelfServeFirmsEnabled()) {
			return;
		}

		// default rooms (#general etc.) are workspace-wide by definition
		if (room.default === true) {
			return;
		}

		let firmId: string | undefined;
		if (room.prid) {
			firmId = await getRoomFirmId(room.prid);
		} else if (room.teamId) {
			const team = await Team.findOneById<Pick<ITeam, '_id' | 'roomId'>>(room.teamId, { projection: { roomId: 1 } });
			firmId = await getRoomFirmId(team?.roomId);
		} else {
			// re-read from the DB — callers reach createRoom with variously-projected
			// owner docs, so the in-memory owner may lack customFields
			const creator = await Users.findOneById<Pick<IUser, '_id' | 'customFields'>>(owner._id, { projection: { customFields: 1 } });
			const creatorFirmId = (creator?.customFields as Record<string, unknown> | undefined)?.firmId;
			firmId = typeof creatorFirmId === 'string' && creatorFirmId ? creatorFirmId : undefined;
		}

		if (!firmId) {
			return;
		}

		room.customFields = { ...(room.customFields ?? {}), firmId };
	},
	undefined, // default priority
	'firms-stamp-room-firm-id',
);
