import type { IBoard, ILead, BoardsPipelineType } from '@rocket.chat/core-typings';
import { Boards, Users } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';
import type { Filter } from 'mongodb';

import { filterBoardsForFirm, firmIdOfUser } from './firmScopeHelpers';

/**
 * MATTERCHAT: the scope every collection-wide Boards/Leads read must carry.
 *
 * Before this existed, five call sites ran `BoardsLeads.find({ archived: { $ne:
 * true } })` across the WHOLE database and `ensureLeadsBoard` returned any
 * non-archived leads board regardless of membership — so with a second firm on
 * the workspace, one firm's intake could read another's. Boards have no tenant
 * column to filter on (see MATTERCHAT-TENANCY-PLAN.md for the durable fix), so
 * reach is derived from board membership + the caller's `customFields.firmId`.
 *
 * FAIL CLOSED: an unresolvable caller throws rather than falling back to an
 * unscoped read. A caller with no reachable boards gets an EMPTY scope, which
 * matches no lead — never an absent filter.
 *
 * SINGLE-FIRM DEPLOYMENTS SEE NO CHANGE: with one firm (or none, when every
 * account predates self-serve firms) all users share one cohort, so every board
 * is reachable and every scoped query returns what the unscoped scan returned.
 */

/** The caller's firm stamp. Throws when the user cannot be resolved — fail closed. */
async function getCallerFirmId(uid: string, method: string): Promise<string | undefined> {
	const user = uid ? await Users.findOneById(uid, { projection: { customFields: 1 } }) : null;
	if (!user) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method });
	}
	return firmIdOfUser(user);
}

/**
 * Non-archived boards the caller may reach, optionally narrowed to one pipeline.
 * Resolves firm stamps only for users who actually sit on a board, so the extra
 * read is bounded by board membership rather than by workspace size.
 */
export async function findBoardsForFirm(uid: string, method: string, pipelineType?: BoardsPipelineType): Promise<IBoard[]> {
	const boards = await (pipelineType ? Boards.findByPipelineType(pipelineType) : Boards.find({ archived: { $ne: true } })).toArray();
	if (!boards.length) {
		return [];
	}

	const callerFirmId = await getCallerFirmId(uid, method);
	const memberIds = [...new Set(boards.flatMap((b) => b.members.map((m) => m.userId)))];
	const members = await Users.find({ _id: { $in: memberIds } }, { projection: { customFields: 1 } }).toArray();
	const memberFirmIds = new Map(members.map((u) => [u._id, firmIdOfUser(u)]));

	return filterBoardsForFirm(boards, uid, callerFirmId, memberFirmIds);
}

/** Ids of every board the caller may reach. */
export async function firmScopedBoardIds(uid: string, method: string): Promise<string[]> {
	return (await findBoardsForFirm(uid, method)).map((b) => b._id);
}

/**
 * `{ boardId: { $in: [...] } }` — merged into a lead query so it can never span
 * firms. An empty id list matches nothing, which is the fail-closed outcome.
 */
export async function firmScopedLeadFilter(uid: string, method: string): Promise<Filter<ILead>> {
	return { boardId: { $in: await firmScopedBoardIds(uid, method) } } as Filter<ILead>;
}

/** True when `board` sits in the caller's firm — the membership-free check the boards-admin bypass needs. */
export async function isBoardInCallerFirm(board: IBoard, uid: string, method: string): Promise<boolean> {
	const callerFirmId = await getCallerFirmId(uid, method);
	const memberIds = board.members.map((m) => m.userId);
	const members = await Users.find({ _id: { $in: memberIds } }, { projection: { customFields: 1 } }).toArray();
	const memberFirmIds = new Map(members.map((u) => [u._id, firmIdOfUser(u)]));

	return filterBoardsForFirm([board], uid, callerFirmId, memberFirmIds).length > 0;
}
