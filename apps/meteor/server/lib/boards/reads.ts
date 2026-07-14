import type { IBoard, IBoardList, IBoardCard, IBoardActivity } from '@rocket.chat/core-typings';
import { Boards, BoardsLists, BoardsCards, BoardsActivities } from '@rocket.chat/models';
import type { FindOptions } from 'mongodb';

import { getBoardForUser } from './permissions';

/**
 * Shared read helpers for the REST surface. Each enforces board visibility via
 * getBoardForUser before returning rows, then pages with the offset/count the
 * caller resolved through getPaginationItems.
 */

type Paging = { offset: number; count: number; sort?: FindOptions<any>['sort'] };

/** Boards the user can see (member or boards-admin), paged. */
export async function listBoardsForUser(
	uid: string,
	filter: { pipelineType?: IBoard['pipelineType']; starred?: boolean },
	paging: Paging,
): Promise<{ boards: IBoard[]; total: number }> {
	const cursor = filter.starred ? Boards.findStarred(uid) : Boards.findByMember(uid);
	let boards = await cursor.toArray();
	if (filter.pipelineType) {
		boards = boards.filter((b) => b.pipelineType === filter.pipelineType);
	}
	boards = boards.filter((b) => !b.archived);
	const total = boards.length;
	const page = boards.slice(paging.offset, paging.offset + (paging.count || total));
	return { boards: page, total };
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
	const cursor = listId ? BoardsCards.findByList(listId) : BoardsCards.findByBoard(boardId);
	let cards = await cursor.toArray();
	if (listId) {
		// findByList isn't board-scoped at the model level; guard cross-board ids
		cards = cards.filter((c) => c.boardId === boardId);
	}
	const total = cards.length;
	const page = cards.slice(paging.offset, paging.offset + (paging.count || total));
	return { cards: page, total };
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
	const cursor = scope.cardId ? BoardsActivities.findByCard(scope.cardId) : BoardsActivities.findByBoard(scope.boardId);
	const activities = await cursor.toArray();
	const total = activities.length;
	const page = activities.slice(paging.offset, paging.offset + (paging.count || total));
	return { activities: page, total };
}

/**
 * "My Day": every card assigned to the user that has a due date, across all the boards they belong
 * to (ANY card type — the list needs only title + due date, so it is CasePro-free). Bucketing into
 * Overdue/Today/This-week is done client-side.
 */
export async function getMyDayCards(uid: string): Promise<{ cards: IBoardCard[] }> {
	const boards = await Boards.findByMember(uid).toArray();
	const boardIds = boards.filter((b) => !b.archived).map((b) => b._id);
	if (!boardIds.length) {
		return { cards: [] };
	}
	const cards = await BoardsCards.find({
		boardId: { $in: boardIds },
		assignees: uid,
		dueDate: { $exists: true, $ne: null },
		archived: { $ne: true },
	} as any).toArray();
	return { cards };
}

/**
 * Global search across the user's cards (title + description) over every board they belong to.
 * Case-insensitive substring match (regex-escaped). Powers a cross-board search + CHI's search_cards.
 */
export async function searchCards(uid: string, text: string, limit = 50): Promise<{ cards: IBoardCard[] }> {
	const q = (text || '').trim();
	if (!q) {
		return { cards: [] };
	}
	const boards = await Boards.findByMember(uid).toArray();
	const boardIds = boards.filter((b) => !b.archived).map((b) => b._id);
	if (!boardIds.length) {
		return { cards: [] };
	}
	const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
	const cards = await BoardsCards.find({
		boardId: { $in: boardIds },
		archived: { $ne: true },
		$or: [{ title: rx }, { description: rx }],
	} as any).toArray();
	return { cards: cards.slice(0, limit) };
}
