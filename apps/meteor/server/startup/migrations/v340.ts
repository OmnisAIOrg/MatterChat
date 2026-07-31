import type { IRoom } from '@rocket.chat/core-typings';
import { Rooms, Users } from '@rocket.chat/models';
import type { Filter } from 'mongodb';

import { addMigration } from '../../lib/migrations';

// MATTERCHAT: self-serve firms — backfill `customFields.firmId` on rooms created BEFORE
// firm-scoped room enumeration existed.
//
// Why a backfill (and not "legacy stays global"): Firms_SelfServe_Enabled is already ON in
// production with public registration, so firm-created public channels/teams exist TODAY.
// Without a backfill they would stay globally enumerable forever — exactly the cross-firm
// leak this workstream closes. Rooms whose creator has no firmId (admins, all OIDC users
// until the org-model link lands) stay unstamped = workspace-wide, which is the coherent
// legacy cohort.
//
// Priority mirrors the beforeCreateRoom stamp (server/lib/firms/stampRoomFirmId.ts):
//   1. firm home team rooms (customFields.firmTeam) — firmId IS the teamId by construction;
//   2. team MAIN rooms → their creator's firmId;
//   3. rooms INSIDE a team → the (now stamped) team main room's firmId;
//   4. standalone rooms → their creator's firmId;
//   5. discussions → the parent room's firmId (looped for nested discussions).
//
// ORDERING DEPENDENCY (load-bearing, do not break): migrations run from `performMigrationProcedure()`
// at main.ts top-level await, i.e. BEFORE orgBackfill.ts's `Meteor.startup` callback. That is why an
// OIDC-only workspace is safe here — at migration time no OIDC user carries customFields.firmId yet,
// so their rooms stay unstamped. If the org firmId backfill were ever moved AHEAD of migrations, this
// migration would stamp the whole room set with org #1's UUID. (The backfill is additionally opt-in
// behind MATTERCHAT_ORG_FIRM_COHORTS — see orgProvisionHelpers.orgFirmCohortsEnabled.)
//
// SAFETY: every pass filters on 'customFields.firmId': { $exists: false } — only fills the
// gap, never overwrites an existing stamp. Idempotent: re-running matches nothing. Only
// 'c'/'p' rooms; default rooms (#general etc.) are never stamped and an admin can un-stamp
// any room to make it workspace-wide again (see sanitizeRoomCustomFieldsForActor).

/** Only channels/groups, never already-stamped, never default rooms. */
const BASE: Filter<IRoom> = {
	't': { $in: ['c', 'p'] },
	'customFields.firmId': { $exists: false },
	'default': { $ne: true },
};

const getFirmId = (doc: { customFields?: Record<string, any> } | null | undefined): string | undefined => {
	const firmId = doc?.customFields?.firmId;
	return typeof firmId === 'string' && firmId ? firmId : undefined;
};

addMigration({
	version: 340,
	name: 'Backfill customFields.firmId on rooms created before firm-scoped room enumeration',
	async up() {
		// Pass 1: firm home team rooms — createFirm marks them customFields.firmTeam and the
		// team _id IS the firmId, so the room's own teamId is the stamp (pipeline update).
		await Rooms.col.updateMany({ ...BASE, 'customFields.firmTeam': true, 'teamId': { $exists: true } } as Filter<IRoom>, [
			{ $set: { 'customFields.firmId': '$teamId' } },
		]);

		// Pass 2: creator-stamp for team MAIN rooms and standalone (non-team, non-discussion)
		// rooms. Iterating users WITH a firmId keeps this bounded by firm membership, not by
		// room count; everyone else's rooms stay unstamped (workspace-wide).
		//
		// BOUNDED BY THE FIRM'S OWN CREATION TIME (2026-07-30 fixer): prod ran
		// Firms_SelfServe_Enabled with public registration long before firm scoping existed,
		// so a user who created ordinary workspace-wide channels years ago and later joined a
		// firm would otherwise have those legacy channels retro-stamped and pulled out of
		// /v1/directory, channels.list, spotlight and teams.autocomplete for everyone outside
		// that firm. Only rooms created at or after the firm's home team room stamp the
		// creator's firmId; anything older stays unstamped = workspace-wide, which is what the
		// documented "legacy rooms stay global" invariant promises. A firm whose home room
		// cannot be resolved gets no creator-stamping at all (the conservative direction).
		const firmStartTs = new Map<string, Date | null>();
		const getFirmStartTs = async (firmId: string): Promise<Date | null> => {
			if (firmStartTs.has(firmId)) {
				return firmStartTs.get(firmId) ?? null;
			}
			// createFirm marks the home room customFields.firmTeam and firmId === the team _id
			const home = await Rooms.findOne<Pick<IRoom, '_id' | 'ts'>>(
				{
					$or: [
						{ teamId: firmId, teamMain: true },
						{ 'customFields.firmId': firmId, 'customFields.firmTeam': true },
					],
				} as Filter<IRoom>,
				{ projection: { ts: 1 } },
			);
			const ts = home?.ts instanceof Date ? home.ts : null;
			firmStartTs.set(firmId, ts);
			return ts;
		};

		const firmUsers = Users.find({ 'customFields.firmId': { $type: 'string' } }, { projection: { _id: 1, customFields: 1 } });
		for await (const user of firmUsers) {
			const firmId = getFirmId(user);
			if (!firmId) {
				continue;
			}
			const startTs = await getFirmStartTs(firmId);
			if (!startTs) {
				continue;
			}
			await Rooms.updateMany(
				{
					...BASE,
					'u._id': user._id,
					'prid': { $exists: false },
					'ts': { $gte: startTs },
					'$or': [{ teamMain: true }, { teamId: { $exists: false } }],
				} as Filter<IRoom>,
				{ $set: { 'customFields.firmId': firmId } },
			);
		}

		// Pass 3: rooms INSIDE a team inherit the team main room's firmId (team wins over
		// creator, mirroring the creation-time priority). Only mains stamped by pass 1/2.
		const stampedMains = Rooms.find(
			{ 'teamMain': true, 'teamId': { $exists: true }, 'customFields.firmId': { $type: 'string' } },
			{ projection: { teamId: 1, customFields: 1 } },
		);
		for await (const main of stampedMains) {
			const firmId = getFirmId(main);
			if (!firmId || !main.teamId) {
				continue;
			}
			await Rooms.updateMany({ ...BASE, teamId: main.teamId, teamMain: { $ne: true }, prid: { $exists: false } } as Filter<IRoom>, {
				$set: { 'customFields.firmId': firmId },
			});
		}

		// Pass 4: discussions inherit their PARENT room's firmId. Looped so discussions of
		// discussions resolve too; each iteration only fills still-missing stamps, so this
		// terminates as soon as a round changes nothing (bounded for safety).
		for (let round = 0; round < 5; round++) {
			const parentIds = (await Rooms.col.distinct('prid', { ...BASE, prid: { $exists: true } } as Filter<IRoom>)).filter(
				(id): id is string => typeof id === 'string',
			);
			if (!parentIds.length) {
				break;
			}
			const stampedParents = await Rooms.find(
				{ '_id': { $in: parentIds }, 'customFields.firmId': { $type: 'string' } },
				{ projection: { customFields: 1 } },
			).toArray();
			if (!stampedParents.length) {
				break;
			}
			let modified = 0;
			for (const parent of stampedParents) {
				const firmId = getFirmId(parent);
				if (!firmId) {
					continue;
				}
				const result = await Rooms.updateMany({ ...BASE, prid: parent._id } as Filter<IRoom>, {
					$set: { 'customFields.firmId': firmId },
				});
				modified += result.modifiedCount ?? 0;
			}
			if (!modified) {
				break;
			}
		}
	},
});
