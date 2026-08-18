import type { IBoard, IBoardMember } from '@rocket.chat/core-typings';
import { Boards } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../../app/authorization/server/functions/hasPermission';
import { isBoardInCallerFirm } from './firmScope';

/**
 * Board ACL roles in increasing privilege. `observer` may read + comment;
 * `member` may mutate cards/lists; `admin` may manage the board itself.
 */
export type BoardRole = IBoardMember['role'];

const ROLE_RANK: Record<BoardRole, number> = {
	observer: 0,
	member: 1,
	admin: 2,
};

/**
 * Resolve the calling user id or throw the canonical RC "invalid user" error.
 * Every Boards method/service entrypoint starts here.
 */
export function requireUid(method: string): string {
	const uid = Meteor.userId();
	if (!uid) {
		throw new Meteor.Error('error-invalid-user', 'Invalid user', { method });
	}
	return uid;
}

/**
 * Load a board the user is allowed to see, or throw. A user may see a board if
 * they hold the global `boards-admin` permission OR they are a board member.
 * Returns the board doc so callers avoid a second read.
 */
export async function getBoardForUser(boardId: string, uid: string, method: string): Promise<IBoard> {
	const board = await Boards.findOneById(boardId);
	if (!board || board.archived) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method });
	}

	const isMember = board.members.some((m) => m.userId === uid);

	// `boards-admin` is held by `partner` as well as `admin`, and a partner belongs
	// to a firm — so the membership bypass has to stay inside that firm or a partner
	// at one firm can open another firm's board by id. In a single-firm workspace
	// every board is in the caller's firm, so the bypass behaves exactly as before.
	if (await hasPermissionAsync(uid, 'boards-admin')) {
		if (isMember || (await isBoardInCallerFirm(board, uid, method))) {
			return board;
		}
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method });
	}

	if (!isMember) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method });
	}

	return board;
}

/**
 * Assert the user holds at least `minRole` on the given board (or is a global
 * boards-admin). Returns the board doc. The single guard every mutating board
 * service calls before writing.
 */
export async function assertBoardRole(boardId: string, uid: string, minRole: BoardRole, method: string): Promise<IBoard> {
	const board = await getBoardForUser(boardId, uid, method);

	if (await hasPermissionAsync(uid, 'boards-admin')) {
		return board;
	}

	const member = board.members.find((m) => m.userId === uid);
	const rank = member ? ROLE_RANK[member.role] : -1;
	if (rank < ROLE_RANK[minRole]) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method });
	}

	return board;
}
