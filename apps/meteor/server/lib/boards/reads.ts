import type { IBoard, IBoardList, IBoardCard, IBoardActivity } from '@rocket.chat/core-typings';
import { Boards, BoardsLists, BoardsCards, BoardsActivities } from '@rocket.chat/models';
import type { Filter, FindOptions } from 'mongodb';

import { getBoardForUser } from './permissions';

/**
 * Shared read helpers for the REST surface. Each enforces board visibility via
 * getBoardForUser before returning rows, then pages with the offset/count the
 * caller resolved through getPaginationItems.
 *
 * Paging is pushed down to MongoDB (skip/limit on an indexed, deterministic
 * sort + a countDocuments for `total`) via the models' findPaginated, so the
 * server never materializes an unbounded result set in memory — boards stay
 * fast as cards/activities pile up. `count: 0` maps to Mongo's `limit: 0`
 * (no limit), which is only reachable when API_Allow_Infinite_Count permits it.
 */

type Paging = { offset: number; count: number; sort?: FindOptions<any>['sort'] };

/** Boards the user can see (member or boards-admin), paged. */
export async function listBoardsForUser(
	uid: string,
	filter: { pipelineType?: IBoard['pipelineType']; starred?: boolean },
	paging: Paging,
): Promise<{ boards: IBoard[]; total: number }> {
	// same filters the model finders (findStarred / findByMember) apply, composed
	// with the optional pipelineType so the page + total come from one query
	const query: Filter<IBoard> = {
		...(filter.starred ? { starredBy: uid } : { 'members.userId': uid }),
		...(filter.pipelineType ? { pipelineType: filter.pipelineType } : {}),
		archived: { $ne: true },
	};
	const { cursor, totalCount } = Boards.findPaginated(query, {
		// creation order (with _id as tie-break) — deterministic so pages never skip/repeat
		// rows, and it matches the insertion-ish order the home grid always showed
		sort: paging.sort ?? { createdAt: 1, _id: 1 },
		skip: paging.offset,
		limit: paging.count || 0,
	});
	const [boards, total] = await Promise.all([cursor.toArray(), totalCount]);
	return { boards, total };
}

export async function getListsForBoard(uid: string, boardId: string): Promise<{ board: IBoard; lists: IBoardList[] }> {
	const board = await getBoardForUser(boardId, uid, 'boards.lists');
	const lists = await BoardsLists.findByBoard(boardId).toArray();
	return { board, lists };
}

/** Cards on a board (optionally narrowed to a single list), paged. */
export async function getCardsForBoard(
	uid: string,
	boardId: string,
	listId: string | undefined,
	paging: Paging,
): Promise<{ cards: IBoardCard[]; total: number }> {
	await getBoardForUser(boardId, uid, 'boards.cards');
	// boardId stays in the filter even when a listId is given, so a cross-board
	// list id pages to an empty set (the guard the old in-memory filter provided)
	const query: Filter<IBoardCard> = {
		boardId,
		...(listId ? { listId } : {}),
		archived: { $ne: true },
	};
	const { cursor, totalCount } = BoardsCards.findPaginated(query, {
		sort: paging.sort ?? { position: 1, _id: 1 },
		skip: paging.offset,
		limit: paging.count || 0,
	});
	const [cards, total] = await Promise.all([cursor.toArray(), totalCount]);
	return { cards, total };
}

export async function getCardForUser(uid: string, cardId: string): Promise<IBoardCard> {
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Error('error-card-not-found');
	}
	await getBoardForUser(card.boardId, uid, 'boards.card');
	return card;
}

/** Activity feed for a card or a board (ts desc), paged. */
export async function getActivities(
	uid: string,
	scope: { boardId: string; cardId?: string },
	paging: Paging,
): Promise<{ activities: IBoardActivity[]; total: number }> {
	await getBoardForUser(scope.boardId, uid, 'boards.activities');
	// boardId scopes the card feed too, so a cardId from another board can't
	// leak rows past the boardId permission check above
	const query: Filter<IBoardActivity> = scope.cardId ? { boardId: scope.boardId, cardId: scope.cardId } : { boardId: scope.boardId };
	const { cursor, totalCount } = BoardsActivities.findPaginated(query, {
		sort: paging.sort ?? { ts: -1, _id: -1 },
		skip: paging.offset,
		limit: paging.count || 0,
	});
	const [activities, total] = await Promise.all([cursor.toArray(), totalCount]);
	return { activities, total };
}

/**
 * "My Day": every card assigned to the user that has a due date, across all the boards they belong
 * to (ANY card type — the list needs only title + due date, so it is CasePro-free). Bucketing into
 * Overdue/Today/This-week is done client-side.
 *
 * `paging` is optional for backward compatibility: the planner/calendar clients (and CHI's tools)
 * consume the FULL set and bucket it themselves, so callers that pass no paging keep getting
 * everything. Paged or not, rows come back dueDate-asc (deterministic) with `total` alongside.
 */
export async function getMyDayCards(
	uid: string,
	paging?: Pick<Paging, 'offset' | 'count'>,
): Promise<{ cards: IBoardCard[]; total: number }> {
	const boards = await Boards.findByMember(uid).toArray();
	const boardIds = boards.filter((b) => !b.archived).map((b) => b._id);
	if (!boardIds.length) {
		return { cards: [], total: 0 };
	}
	// double-cast: `dueDate: { $ne: null }` is valid Mongo but not expressible on Condition<Date>
	const query = {
		boardId: { $in: boardIds },
		assignees: uid,
		dueDate: { $exists: true, $ne: null },
		archived: { $ne: true },
	} as unknown as Filter<IBoardCard>;
	const { cursor, totalCount } = BoardsCards.findPaginated(query, {
		sort: { dueDate: 1, _id: 1 },
		...(paging ? { skip: paging.offset, limit: paging.count || 0 } : {}),
	});
	const [cards, total] = await Promise.all([cursor.toArray(), totalCount]);
	return { cards, total };
}

/**
 * Global search across the user's cards (title + description) over every board they belong to.
 * Case-insensitive substring match (regex-escaped). Powers a cross-board search + CHI's search_cards.
 *
 * Unpaged callers keep the historical cap of 50 hits (now enforced by Mongo's limit instead of an
 * in-memory slice); callers that pass paging get offset/count pages plus the match `total`.
 */
export async function searchCards(
	uid: string,
	text: string,
	paging?: Pick<Paging, 'offset' | 'count'>,
): Promise<{ cards: IBoardCard[]; total: number }> {
	const q = (text || '').trim();
	if (!q) {
		return { cards: [], total: 0 };
	}
	const boards = await Boards.findByMember(uid).toArray();
	const boardIds = boards.filter((b) => !b.archived).map((b) => b._id);
	if (!boardIds.length) {
		return { cards: [], total: 0 };
	}
	const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
	const query = {
		boardId: { $in: boardIds },
		archived: { $ne: true },
		$or: [{ title: rx }, { description: rx }],
	} as Filter<IBoardCard>;
	const { cursor, totalCount } = BoardsCards.findPaginated(query, {
		sort: { _id: 1 },
		skip: paging?.offset ?? 0,
		limit: paging ? paging.count || 0 : 50,
	});
	const [cards, total] = await Promise.all([cursor.toArray(), totalCount]);
	return { cards, total };
}
