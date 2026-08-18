import type { IBoard } from '@rocket.chat/core-typings';

/**
 * MATTERCHAT: pure helpers for firm-scoping Boards/Leads reads — no Meteor or
 * model imports so they stay unit-testable (see tests/unit/server/lib/boards/).
 *
 * Boards carry NO tenant column (the durable fix is designed in
 * MATTERCHAT-TENANCY-PLAN.md at the repo root). Until they do, a board's firm is
 * derived from the one place tenancy already exists — its MEMBERS. A board is
 * reachable when the caller is a member of it, or when at least one of its
 * members sits in the caller's firm cohort.
 *
 * Cohorts mirror `firmsService.getFirmScopeExtraQuery` exactly: a user WITH a
 * `customFields.firmId` belongs to that firm; a user WITHOUT one belongs to the
 * unstamped cohort (accounts predating self-serve firms). A single-firm
 * workspace is therefore ONE cohort — every board qualifies, and every read
 * scoped through here returns exactly what the unscoped scan returned before.
 */

/** Read the firm stamp off a user's untyped `customFields` bag. */
export const firmIdOfUser = (user: { customFields?: Record<string, unknown> } | null | undefined): string | undefined => {
	const firmId = user?.customFields?.firmId;
	return typeof firmId === 'string' && firmId ? firmId : undefined;
};

/**
 * Narrow `boards` to the ones `uid` may reach. `memberFirmIds` maps a board
 * member's user id to that user's firm stamp; a member MISSING from the map is
 * unresolvable (e.g. a deleted account) and never grants reach — fail closed.
 * A present-but-`undefined` value is the unstamped cohort and does grant reach
 * to an unstamped caller.
 */
export const filterBoardsForFirm = (
	boards: IBoard[],
	uid: string,
	callerFirmId: string | undefined,
	memberFirmIds: Map<string, string | undefined>,
): IBoard[] =>
	boards.filter(
		(board) =>
			board.members.some((m) => m.userId === uid) ||
			board.members.some((m) => memberFirmIds.has(m.userId) && memberFirmIds.get(m.userId) === callerFirmId),
	);
