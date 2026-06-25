import type {
	IBoard,
	IBoardList,
	IBoardCard,
	IBoardLabelDef,
	IChecklist,
	IChecklistItem,
	ITimeEntry,
	BoardsPipelineType,
	BoardsStatus,
	BoardsCardType,
	IBoardCardLink,
} from '@rocket.chat/core-typings';
import { Boards, BoardsLists, BoardsCards, BoardsActivities } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { Meteor } from 'meteor/meteor';

import { assertBoardRole, getBoardForUser } from './permissions';
import { hasPermissionAsync } from '../../../app/authorization/server/functions/hasPermission';
import { emitBoardEvent } from './events';

/**
 * Shared board service functions. Both the in-app Meteor methods AND the REST
 * routes call these so the mutation logic (permission gate → write → bump rev →
 * audit → automation seam) lives in exactly one place.
 *
 * Convention for every mutating fn: assert role → mutate model → bump rev →
 * BoardsActivities.log(...) → emitBoardEvent(...) → return the fresh doc.
 */

const POSITION_STEP = 1024; // gap between sibling positions; midpoints subdivide it

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export type CreateBoardParams = {
	title: string;
	pipelineType?: BoardsPipelineType;
	description?: string;
	teamId?: string;
};

export async function createBoard(uid: string, params: CreateBoardParams): Promise<IBoard> {
	const title = params.title?.trim();
	if (!title) {
		throw new Meteor.Error('error-invalid-board-title', 'Invalid board title', { method: 'boards.createBoard' });
	}

	const now = new Date();
	const doc: Omit<IBoard, '_id' | '_updatedAt'> = {
		title,
		pipelineType: params.pipelineType ?? 'general',
		...(params.description ? { description: params.description } : {}),
		...(params.teamId ? { teamId: params.teamId } : {}),
		// creator is seeded as board admin so they immediately pass assertBoardRole
		members: [{ userId: uid, role: 'admin' }],
		labelDefs: [],
		fieldDefs: [],
		visibility: 'team',
		cardCounter: 0,
		schemaVersion: 1,
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};

	const { insertedId } = await Boards.insertOne(doc);
	const board = await Boards.findOneById(insertedId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.createBoard' });
	}

	await BoardsActivities.log({ boardId: board._id, actor: uid, verb: 'board.created', to: { title: board.title }, ts: now });
	emitBoardEvent('board.created', { boardId: board._id, actor: uid });

	return board;
}

export type UpdateBoardPatch = Partial<Pick<IBoard, 'title' | 'description' | 'icon' | 'background' | 'visibility'>>;

export async function updateBoard(uid: string, boardId: string, patch: UpdateBoardPatch): Promise<IBoard> {
	await assertBoardRole(boardId, uid, 'admin', 'boards.updateBoard');

	const set: UpdateBoardPatch = {};
	if (typeof patch.title === 'string' && patch.title.trim()) {
		set.title = patch.title.trim();
	}
	if (typeof patch.description === 'string') {
		set.description = patch.description;
	}
	if (typeof patch.icon === 'string') {
		set.icon = patch.icon;
	}
	if (patch.background) {
		set.background = patch.background;
	}
	if (patch.visibility) {
		set.visibility = patch.visibility;
	}

	await Boards.updateOne({ _id: boardId }, { $set: set, $inc: { rev: 1 } });
	const board = await Boards.findOneById(boardId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.updateBoard' });
	}

	await BoardsActivities.log({ boardId, actor: uid, verb: 'board.updated', to: set, ts: new Date() });
	emitBoardEvent('board.updated', { boardId, actor: uid });

	return board;
}

export async function archiveBoard(uid: string, boardId: string): Promise<{ ok: true }> {
	await assertBoardRole(boardId, uid, 'admin', 'boards.archiveBoard');

	await Boards.archiveBoard(boardId);
	// cascade: archive lists + cards belonging to the board
	await BoardsLists.archiveByBoard(boardId);
	await BoardsCards.archiveByBoard(boardId);

	await BoardsActivities.log({ boardId, actor: uid, verb: 'board.archived', ts: new Date() });
	emitBoardEvent('board.archived', { boardId, actor: uid });

	return { ok: true };
}

/**
 * Set a board's lifecycle status ('active' | 'on_hold' | 'completed' | 'archived').
 * Keeps the legacy boolean `archived` flag coherent: status 'archived' archives the
 * board (and cascades to its lists/cards, matching archiveBoard); any other status
 * un-archives it. Requires the same 'admin' role as updateBoard/archiveBoard.
 */
export async function setBoardStatus(uid: string, boardId: string, status: BoardsStatus): Promise<IBoard> {
	// Archived-tolerant admin check: unlike assertBoardRole (which hides archived
	// boards), setStatus must be able to RE-activate an archived board, so we
	// load the raw doc and assert admin here.
	const current = await Boards.findOneById(boardId);
	if (!current) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.setStatus' });
	}
	const isBoardsAdmin = await hasPermissionAsync(uid, 'boards-admin');
	if (!isBoardsAdmin) {
		const member = current.members.find((m) => m.userId === uid);
		if (!member || member.role !== 'admin') {
			throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.setStatus' });
		}
	}

	const archived = status === 'archived';
	await Boards.updateOne({ _id: boardId }, { $set: { status, archived }, $inc: { rev: 1 } });

	// keep lists/cards in step with the board's archived state, like archiveBoard's cascade
	if (archived) {
		await BoardsLists.archiveByBoard(boardId);
		await BoardsCards.archiveByBoard(boardId);
	} else if (current.archived) {
		// Re-activating a previously-archived board: reverse the cascade so the
		// lists/cards hidden by the archive come back. Without this the board has
		// no usable lists and cards can't be added to it (error-list-not-found).
		await BoardsLists.updateMany({ boardId }, { $set: { archived: false } });
		await BoardsCards.updateMany({ boardId }, { $set: { archived: false } });
	}

	const board = await Boards.findOneById(boardId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.setStatus' });
	}

	await BoardsActivities.log({ boardId, actor: uid, verb: 'board.updated', to: { status }, ts: new Date() });
	emitBoardEvent('board.updated', { boardId, actor: uid });

	return board;
}

/** Board + its (non-archived) lists in one shot — feeds the board-open path. */
export async function getBoardInfo(uid: string, boardId: string): Promise<{ board: IBoard; lists: IBoardList[] }> {
	const board = await getBoardForUser(boardId, uid, 'boards.info');
	const lists = await BoardsLists.findByBoard(boardId).toArray();
	return { board, lists };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type CreateListParams = { boardId: string; title: string; position?: number; caseproStageId?: string };

export async function createList(uid: string, params: CreateListParams): Promise<IBoardList> {
	await assertBoardRole(params.boardId, uid, 'member', 'boards.listCreate');

	const title = params.title?.trim();
	if (!title) {
		throw new Meteor.Error('error-invalid-list-title', 'Invalid list title', { method: 'boards.listCreate' });
	}

	const position = typeof params.position === 'number' ? params.position : (await BoardsLists.maxPosition(params.boardId)) + POSITION_STEP;

	const doc: Omit<IBoardList, '_id' | '_updatedAt'> = {
		boardId: params.boardId,
		title,
		position,
		...(params.caseproStageId ? { caseproStageId: params.caseproStageId } : {}),
		archived: false,
		rev: 0,
	};

	const { insertedId } = await BoardsLists.insertOne(doc);
	const list = await BoardsLists.findOneById(insertedId);
	if (!list) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.listCreate' });
	}

	await BoardsActivities.log({ boardId: params.boardId, listId: list._id, actor: uid, verb: 'list.created', to: { title }, ts: new Date() });
	emitBoardEvent('list.created', { boardId: params.boardId, listId: list._id, actor: uid });

	return list;
}

export type UpdateListPatch = Partial<Pick<IBoardList, 'title' | 'wipLimit' | 'subStatuses' | 'collapsed' | 'color'>>;

export async function updateList(uid: string, listId: string, patch: UpdateListPatch): Promise<IBoardList> {
	const current = await BoardsLists.findOneById(listId);
	if (!current) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.listUpdate' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.listUpdate');

	const set: UpdateListPatch = {};
	const unset: Record<string, 1> = {};
	if (typeof patch.title === 'string' && patch.title.trim()) {
		set.title = patch.title.trim();
	}
	if (typeof patch.wipLimit === 'number') {
		set.wipLimit = patch.wipLimit;
	}
	if (Array.isArray(patch.subStatuses)) {
		set.subStatuses = patch.subStatuses;
	}
	if (typeof patch.collapsed === 'boolean') {
		set.collapsed = patch.collapsed;
	}
	if (typeof patch.color === 'string') {
		// a raw CSS color string sets the accent; an empty string clears it
		const color = patch.color.trim();
		if (color) {
			set.color = color;
		} else {
			unset.color = 1;
		}
	}

	const update: Record<string, unknown> = { $set: set, $inc: { rev: 1 } };
	if (Object.keys(unset).length) {
		update.$unset = unset;
	}
	await BoardsLists.updateOne({ _id: listId }, update);
	const list = await BoardsLists.findOneById(listId);
	if (!list) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.listUpdate' });
	}

	await BoardsActivities.log({ boardId: current.boardId, listId, actor: uid, verb: 'list.updated', to: set, ts: new Date() });
	emitBoardEvent('list.updated', { boardId: current.boardId, listId, actor: uid });

	return list;
}

export async function moveList(uid: string, listId: string, position: number): Promise<IBoardList> {
	const current = await BoardsLists.findOneById(listId);
	if (!current) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.listMove' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.listMove');

	await BoardsLists.updatePosition(listId, position);
	const list = await BoardsLists.findOneById(listId);
	if (!list) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.listMove' });
	}

	await BoardsActivities.log({
		boardId: current.boardId,
		listId,
		actor: uid,
		verb: 'list.moved',
		from: { position: current.position },
		to: { position },
		ts: new Date(),
	});
	emitBoardEvent('list.moved', { boardId: current.boardId, listId, actor: uid });

	return list;
}

/**
 * Reorder the (non-archived) lists/columns of a board. Two shapes:
 *  - `{ boardId, listIds }`: an explicit full ordering — each given list is assigned a sequential
 *    position (POSITION_STEP, 2·STEP, …) in the order supplied, persisting the new sequence so
 *    `boards.lists` (which sorts by `position`) returns them in that order. listIds must all belong
 *    to the board; any board list omitted from the array keeps its current position (and would sort
 *    after the reordered ones).
 *  - `{ listId, position }`: a single-list move to an absolute fractional rank — mirrors `moveList`
 *    / the `boards.card.move` position handling.
 * Same 'member' board gate as the other list mutations.
 */
export async function reorderLists(
	uid: string,
	params: { boardId?: string; listIds?: string[]; listId?: string; position?: number },
): Promise<IBoardList[]> {
	// Single-list move form: { listId, position }
	if (params.listId && typeof params.position === 'number') {
		const current = await BoardsLists.findOneById(params.listId);
		if (!current) {
			throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.listReorder' });
		}
		await assertBoardRole(current.boardId, uid, 'member', 'boards.listReorder');

		await BoardsLists.updatePosition(params.listId, params.position);

		await BoardsActivities.log({
			boardId: current.boardId,
			listId: params.listId,
			actor: uid,
			verb: 'list.moved',
			from: { position: current.position },
			to: { position: params.position },
			ts: new Date(),
		});
		emitBoardEvent('list.moved', { boardId: current.boardId, listId: params.listId, actor: uid });

		return BoardsLists.findByBoard(current.boardId).toArray();
	}

	// Full-ordering form: { boardId, listIds }
	const { boardId, listIds } = params;
	if (!boardId || !Array.isArray(listIds) || listIds.length === 0) {
		throw new Meteor.Error('error-invalid-params', 'Provide either { listId, position } or { boardId, listIds }', {
			method: 'boards.listReorder',
		});
	}
	await assertBoardRole(boardId, uid, 'member', 'boards.listReorder');

	// every id must be a (non-archived) list of this board — guard cross-board/bogus ids
	const boardLists = await BoardsLists.findByBoard(boardId).toArray();
	const byId = new Map(boardLists.map((l) => [l._id, l]));
	for (const id of listIds) {
		if (!byId.has(id)) {
			throw new Meteor.Error('error-list-not-found', 'List not found on board', { method: 'boards.listReorder' });
		}
	}

	// assign sequential positions in the supplied order (STEP, 2·STEP, …)
	let position = POSITION_STEP;
	for (const id of listIds) {
		await BoardsLists.updatePosition(id, position);
		position += POSITION_STEP;
	}

	await BoardsActivities.log({
		boardId,
		actor: uid,
		verb: 'list.moved',
		to: { listIds },
		ts: new Date(),
	});
	emitBoardEvent('list.moved', { boardId, actor: uid });

	return BoardsLists.findByBoard(boardId).toArray();
}

export async function archiveList(uid: string, listId: string): Promise<{ ok: true }> {
	const current = await BoardsLists.findOneById(listId);
	if (!current) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.listArchive' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.listArchive');

	await BoardsLists.archiveList(listId);
	await BoardsCards.archiveByList(listId); // cascade

	await BoardsActivities.log({ boardId: current.boardId, listId, actor: uid, verb: 'list.archived', ts: new Date() });
	emitBoardEvent('list.archived', { boardId: current.boardId, listId, actor: uid });

	return { ok: true };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type CreateCardParams = {
	boardId: string;
	listId: string;
	title: string;
	position?: number;
	cardType?: BoardsCardType;
	link?: IBoardCardLink;
	description?: string;
};

export async function createCard(uid: string, params: CreateCardParams): Promise<IBoardCard> {
	await assertBoardRole(params.boardId, uid, 'member', 'boards.cardCreate');

	const title = params.title?.trim();
	if (!title) {
		throw new Meteor.Error('error-invalid-card-title', 'Invalid card title', { method: 'boards.cardCreate' });
	}

	const list = await BoardsLists.findOneById(params.listId);
	if (!list || list.boardId !== params.boardId || list.archived) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.cardCreate' });
	}

	const position = typeof params.position === 'number' ? params.position : (await BoardsCards.maxPosition(params.listId)) + POSITION_STEP;
	const cardNumber = await Boards.nextCardNumber(params.boardId);

	const now = new Date();
	const doc: Omit<IBoardCard, '_id' | '_updatedAt'> = {
		boardId: params.boardId,
		listId: params.listId,
		title,
		...(params.description ? { description: params.description } : {}),
		position,
		cardType: params.cardType ?? 'task',
		...(params.link ? { link: params.link } : {}),
		labels: [],
		assignees: [],
		watchers: [],
		fieldValues: {},
		checklists: [],
		attachments: [],
		comments: [],
		cardNumber,
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};

	const { insertedId } = await BoardsCards.insertOne(doc);
	const card = await BoardsCards.findOneById(insertedId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardCreate' });
	}

	await BoardsActivities.log({
		boardId: params.boardId,
		listId: params.listId,
		cardId: card._id,
		actor: uid,
		verb: 'card.created',
		to: { title, cardNumber },
		ts: now,
	});
	emitBoardEvent('card.created', { boardId: params.boardId, listId: params.listId, cardId: card._id, actor: uid });

	return card;
}

export type UpdateCardPatch = Partial<
	Pick<
		IBoardCard,
		| 'title'
		| 'description'
		| 'startDate'
		| 'dueDate'
		| 'dueComplete'
		| 'cover'
		| 'subStatus'
		| 'assignees'
		| 'watchers'
		| 'priority'
		| 'timeEstimateMinutes'
	>
>;

export async function updateCard(uid: string, cardId: string, patch: UpdateCardPatch): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardUpdate' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');

	const set: Record<string, unknown> = {};
	if (typeof patch.title === 'string' && patch.title.trim()) {
		set.title = patch.title.trim();
	}
	if (typeof patch.description === 'string') {
		set.description = patch.description;
	}
	if (patch.startDate !== undefined) {
		set.startDate = patch.startDate;
	}
	if (patch.dueDate !== undefined) {
		set.dueDate = patch.dueDate;
	}
	if (typeof patch.dueComplete === 'boolean') {
		set.dueComplete = patch.dueComplete;
	}
	if (patch.cover !== undefined) {
		set.cover = patch.cover;
	}
	if (typeof patch.subStatus === 'string') {
		set.subStatus = patch.subStatus;
	}
	if (Array.isArray(patch.assignees)) {
		set.assignees = patch.assignees;
	}
	if (Array.isArray(patch.watchers)) {
		set.watchers = patch.watchers;
	}
	if (patch.priority !== undefined) {
		set.priority = patch.priority;
	}
	if (patch.timeEstimateMinutes !== undefined) {
		// Normalize: reject negative/NaN, round fractional minutes; 0 clears the estimate.
		const est = Number(patch.timeEstimateMinutes);
		set.timeEstimateMinutes = Number.isFinite(est) && est > 0 ? Math.round(est) : 0;
	}

	await BoardsCards.updateOne({ _id: cardId }, { $set: set, $inc: { rev: 1 } });
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardUpdate' });
	}

	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: set,
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });

	// Recurring "routine" tasks: completing a card that carries a recurrence rule spawns the next
	// occurrence. Never let a failure here block the completion itself.
	if (patch.dueComplete === true && current.dueComplete !== true && current.recurrence) {
		try {
			await materializeRecurrence(uid, current);
		} catch {
			/* the card is still completed even if the next occurrence couldn't be created */
		}
	}

	return card;
}

// ---------------------------------------------------------------------------
// Recurring "routine" tasks
// ---------------------------------------------------------------------------

function advanceDate(from: Date, freq: 'daily' | 'weekly' | 'monthly', interval: number): Date {
	const d = new Date(from);
	const n = Math.max(1, interval || 1);
	if (freq === 'daily') {
		d.setDate(d.getDate() + n);
	} else if (freq === 'weekly') {
		d.setDate(d.getDate() + 7 * n);
	} else {
		d.setMonth(d.getMonth() + n);
	}
	return d;
}

/** Set or clear a card's recurrence rule. */
export async function setRecurrence(uid: string, cardId: string, rule: IBoardCard['recurrence'] | null): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardRecurrence' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');

	if (rule && (rule.freq === 'daily' || rule.freq === 'weekly' || rule.freq === 'monthly')) {
		const clean: IBoardCard['recurrence'] = {
			freq: rule.freq,
			interval: Math.max(1, Number(rule.interval) || 1),
			basis: rule.basis === 'dueDate' ? 'dueDate' : 'completion',
			...(typeof rule.count === 'number' && rule.count > 0 ? { count: rule.count } : {}),
			occurrencesDone: current.recurrence?.occurrencesDone ?? 0,
		};
		await BoardsCards.updateOne({ _id: cardId }, { $set: { recurrence: clean }, $inc: { rev: 1 } });
	} else {
		await BoardsCards.updateOne({ _id: cardId }, { $unset: { recurrence: 1 }, $inc: { rev: 1 } });
	}

	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardRecurrence' });
	}
	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { recurrence: rule ? rule.freq : 'none' },
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

/**
 * Clone a recurring card into its next occurrence: a fresh due date (advanced from the completion
 * date or the prior due date), checklists reset, comments/attachments not carried over. The rule
 * moves onto the new card; the source keeps no recurrence so it cannot re-spawn on toggle.
 */
export async function materializeRecurrence(uid: string, card: IBoardCard): Promise<IBoardCard | undefined> {
	const rec = card.recurrence;
	if (!rec) {
		return undefined;
	}
	const done = (rec.occurrencesDone ?? 0) + 1;
	if (typeof rec.count === 'number' && done >= rec.count) {
		// series complete — drop the rule from the source and stop.
		await BoardsCards.updateOne({ _id: card._id }, { $unset: { recurrence: 1 } });
		return undefined;
	}

	const basisDate = rec.basis === 'dueDate' && card.dueDate ? new Date(card.dueDate) : new Date();
	const nextDue = advanceDate(basisDate, rec.freq, rec.interval);
	const now = new Date();
	const position = (await BoardsCards.maxPosition(card.listId)) + POSITION_STEP;
	const cardNumber = await Boards.nextCardNumber(card.boardId);

	const doc: Omit<IBoardCard, '_id' | '_updatedAt'> = {
		boardId: card.boardId,
		listId: card.listId,
		title: card.title,
		...(card.description ? { description: card.description } : {}),
		position,
		cardType: card.cardType,
		...(card.link ? { link: card.link } : {}),
		...(card.subStatus ? { subStatus: card.subStatus } : {}),
		labels: [...(card.labels || [])],
		assignees: [...(card.assignees || [])],
		watchers: [...(card.watchers || [])],
		...(card.startDate ? { startDate: advanceDate(card.startDate, rec.freq, rec.interval) } : {}),
		dueDate: nextDue,
		dueComplete: false,
		...(card.cover ? { cover: card.cover } : {}),
		fieldValues: { ...(card.fieldValues || {}) },
		checklists: (card.checklists || []).map((cl) => ({ ...cl, items: cl.items.map((it) => ({ ...it, done: false })) })),
		attachments: [],
		comments: [],
		cardNumber,
		recurrence: { ...rec, occurrencesDone: done },
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};

	const { insertedId } = await BoardsCards.insertOne(doc);
	const next = await BoardsCards.findOneById(insertedId);
	if (!next) {
		return undefined;
	}
	// The rule now lives on the new occurrence; the completed source becomes a plain record.
	await BoardsCards.updateOne({ _id: card._id }, { $unset: { recurrence: 1 } });
	await BoardsActivities.log({
		boardId: card.boardId,
		listId: card.listId,
		cardId: next._id,
		actor: uid,
		verb: 'card.created',
		to: { title: card.title, cardNumber, recurredFrom: card._id },
		ts: now,
	});
	emitBoardEvent('card.created', { boardId: card.boardId, listId: card.listId, cardId: next._id, actor: uid });
	return next;
}

// ---------------------------------------------------------------------------
// Card completion (Asana-style task-level "done", distinct from dueComplete + archive)
// ---------------------------------------------------------------------------

/** Mark a card complete/incomplete. Completing a recurring card also spawns the next occurrence. */
export async function completeCard(uid: string, cardId: string, value = true): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardComplete' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');

	const update: Record<string, unknown> = value
		? { $set: { completed: true, completedAt: new Date(), completedBy: uid }, $inc: { rev: 1 } }
		: { $set: { completed: false }, $unset: { completedAt: 1, completedBy: 1 }, $inc: { rev: 1 } };
	await BoardsCards.updateOne({ _id: cardId }, update);

	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardComplete' });
	}
	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { completed: value },
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });

	if (value && !current.completed && current.recurrence) {
		try {
			await materializeRecurrence(uid, current);
		} catch {
			/* never fail completion because the next occurrence couldn't be created */
		}
	}
	return card;
}

// ---------------------------------------------------------------------------
// Card checklists / sub-tasks
// ---------------------------------------------------------------------------

// Title of the implicit default checklist created on the first item add. Cards carry a
// `checklists: IChecklist[]` array (a checklist groups items); the granular endpoints operate on a
// single default checklist so callers can think purely in terms of items.
const DEFAULT_CHECKLIST_TITLE = 'Checklist';

/** Locate the item with `itemId` across every checklist on a card. */
function findChecklistItem(card: IBoardCard, itemId: string): { checklist: IChecklist; item: IChecklistItem } | undefined {
	for (const checklist of card.checklists || []) {
		const item = checklist.items.find((it) => it.id === itemId);
		if (item) {
			return { checklist, item };
		}
	}
	return undefined;
}

/**
 * Add a sub-task to a card. Items live in the card's default checklist, which is created on the
 * first add. Returns the fresh card so the caller sees the new item (with its generated id).
 */
export async function addChecklistItem(uid: string, cardId: string, text: string): Promise<IBoardCard> {
	const clean = text?.trim();
	if (!clean) {
		throw new Meteor.Error('error-invalid-checklist-text', 'Invalid checklist item text', { method: 'boards.cardChecklistAdd' });
	}
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardChecklistAdd' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');

	const checklists = current.checklists || [];
	const item: IChecklistItem = {
		id: Random.id(),
		text: clean,
		done: false,
		position: 0,
	};

	let defaultChecklist = checklists[0];
	if (!defaultChecklist) {
		// no checklist yet — seed the default one carrying this first item
		defaultChecklist = { id: Random.id(), title: DEFAULT_CHECKLIST_TITLE, position: 0, items: [item] };
		await BoardsCards.updateOne({ _id: cardId }, { $set: { checklists: [defaultChecklist] }, $inc: { rev: 1 } });
	} else {
		// append to the first checklist; position is monotonically after the current max
		item.position = defaultChecklist.items.reduce((max, it) => Math.max(max, it.position), -1) + 1;
		await BoardsCards.updateOne({ _id: cardId, 'checklists.id': defaultChecklist.id }, { $push: { 'checklists.$.items': item }, $inc: { rev: 1 } });
	}

	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardChecklistAdd' });
	}
	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { checklistItemAdded: clean },
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

/** Toggle a checklist item's done state (or set it explicitly when `done` is provided). */
export async function toggleChecklistItem(uid: string, cardId: string, itemId: string, done?: boolean): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardChecklistToggle' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');

	const found = findChecklistItem(current, itemId);
	if (!found) {
		throw new Meteor.Error('error-checklist-item-not-found', 'Checklist item not found', { method: 'boards.cardChecklistToggle' });
	}
	const nextDone = typeof done === 'boolean' ? done : !found.item.done;

	// positional filter targets the matching item inside the matching checklist
	await BoardsCards.updateOne(
		{ _id: cardId, 'checklists.id': found.checklist.id },
		{ $set: { 'checklists.$[cl].items.$[it].done': nextDone }, $inc: { rev: 1 } },
		{ arrayFilters: [{ 'cl.id': found.checklist.id }, { 'it.id': itemId }] },
	);

	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardChecklistToggle' });
	}
	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { checklistItemDone: nextDone, itemId },
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

/** Remove a checklist item from whichever checklist holds it. */
export async function removeChecklistItem(uid: string, cardId: string, itemId: string): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardChecklistRemove' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');

	const found = findChecklistItem(current, itemId);
	if (!found) {
		throw new Meteor.Error('error-checklist-item-not-found', 'Checklist item not found', { method: 'boards.cardChecklistRemove' });
	}

	await BoardsCards.updateOne(
		{ _id: cardId, 'checklists.id': found.checklist.id },
		{ $pull: { 'checklists.$.items': { id: itemId } }, $inc: { rev: 1 } },
	);

	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardChecklistRemove' });
	}
	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { checklistItemRemoved: itemId },
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

// ---------------------------------------------------------------------------
// Time tracking (logged-time entries)
// ---------------------------------------------------------------------------

/**
 * Append a logged-time entry to a card. Generic / CasePro-free — applies to any
 * card type. `minutes` must be a positive number; `spentAt` defaults to now.
 */
export async function logTime(uid: string, cardId: string, entry: { minutes: number; note?: string; spentAt?: Date }): Promise<IBoardCard> {
	const minutes = Number(entry?.minutes);
	if (!Number.isFinite(minutes) || minutes <= 0) {
		throw new Meteor.Error('error-invalid-time-minutes', 'Invalid minutes', { method: 'boards.cardLogTime' });
	}
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardLogTime' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');

	const now = new Date();
	// Guard against an invalid/NaN Date reaching the document (the route coerces a string).
	const spentAt = entry.spentAt && !Number.isNaN(entry.spentAt.getTime()) ? entry.spentAt : now;
	const timeEntry: ITimeEntry = {
		id: Random.id(),
		userId: uid,
		minutes,
		...(entry.note?.trim() ? { note: entry.note.trim() } : {}),
		spentAt,
		createdAt: now,
	};
	await BoardsCards.updateOne({ _id: cardId }, { $push: { timeEntries: timeEntry }, $inc: { rev: 1 } });

	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardLogTime' });
	}
	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { timeLogged: minutes },
		ts: now,
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

/** Remove a logged-time entry by id. */
export async function deleteTimeEntry(uid: string, cardId: string, entryId: string): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardDeleteTimeEntry' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');

	await BoardsCards.updateOne({ _id: cardId }, { $pull: { timeEntries: { id: entryId } }, $inc: { rev: 1 } });

	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardDeleteTimeEntry' });
	}
	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { timeEntryRemoved: entryId },
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

// ---------------------------------------------------------------------------
// Card copy / duplicate
// ---------------------------------------------------------------------------

/** Duplicate a card into the same list: copies content (labels, assignees, checklists, fields,
 * dates) but not comments/attachments/completion. */
export async function copyCard(uid: string, cardId: string): Promise<IBoardCard> {
	const src = await BoardsCards.findOneById(cardId);
	if (!src) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardCopy' });
	}
	await assertBoardRole(src.boardId, uid, 'member', 'boards.cardCreate');

	const now = new Date();
	const position = (await BoardsCards.maxPosition(src.listId)) + POSITION_STEP;
	const cardNumber = await Boards.nextCardNumber(src.boardId);
	const doc: Omit<IBoardCard, '_id' | '_updatedAt'> = {
		boardId: src.boardId,
		listId: src.listId,
		title: `Copy of ${src.title}`,
		...(src.description ? { description: src.description } : {}),
		position,
		cardType: src.cardType,
		...(src.link ? { link: src.link } : {}),
		...(src.subStatus ? { subStatus: src.subStatus } : {}),
		labels: [...(src.labels || [])],
		assignees: [...(src.assignees || [])],
		watchers: [...(src.watchers || [])],
		...(src.startDate ? { startDate: src.startDate } : {}),
		...(src.dueDate ? { dueDate: src.dueDate } : {}),
		dueComplete: false,
		...(src.cover ? { cover: src.cover } : {}),
		fieldValues: { ...(src.fieldValues || {}) },
		checklists: (src.checklists || []).map((cl) => ({ ...cl, items: cl.items.map((it) => ({ ...it, done: false })) })),
		attachments: [],
		comments: [],
		cardNumber,
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};
	const { insertedId } = await BoardsCards.insertOne(doc);
	const card = await BoardsCards.findOneById(insertedId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardCopy' });
	}
	await BoardsActivities.log({
		boardId: src.boardId,
		listId: src.listId,
		cardId: card._id,
		actor: uid,
		verb: 'card.created',
		to: { title: card.title, copiedFrom: src._id },
		ts: now,
	});
	emitBoardEvent('card.created', { boardId: src.boardId, listId: src.listId, cardId: card._id, actor: uid });
	return card;
}

// ---------------------------------------------------------------------------
// Card relations / dependencies (blocks / blocked-by / relates / parent / child)
// ---------------------------------------------------------------------------

type RelationType = 'relates' | 'blocks' | 'blocked-by' | 'duplicate' | 'parent' | 'child';

function inverseRelation(type: RelationType): RelationType {
	switch (type) {
		case 'blocks':
			return 'blocked-by';
		case 'blocked-by':
			return 'blocks';
		case 'parent':
			return 'child';
		case 'child':
			return 'parent';
		default:
			return type; // relates / duplicate are symmetric
	}
}

/** Link two cards with a typed relation, maintaining the inverse edge on the target. */
export async function addRelation(uid: string, cardId: string, type: RelationType, targetCardId: string): Promise<IBoardCard> {
	if (cardId === targetCardId) {
		throw new Meteor.Error('error-invalid-relation', 'A card cannot relate to itself', { method: 'boards.cardRelations' });
	}
	const card = await BoardsCards.findOneById(cardId);
	const target = await BoardsCards.findOneById(targetCardId);
	if (!card || !target) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardRelations' });
	}
	await assertBoardRole(card.boardId, uid, 'member', 'boards.cardUpdate');
	await assertBoardRole(target.boardId, uid, 'member', 'boards.cardUpdate');

	await BoardsCards.updateOne({ _id: cardId }, { $addToSet: { relations: { type, cardId: targetCardId } }, $inc: { rev: 1 } });
	await BoardsCards.updateOne(
		{ _id: targetCardId },
		{ $addToSet: { relations: { type: inverseRelation(type), cardId } }, $inc: { rev: 1 } },
	);
	await BoardsActivities.log({
		boardId: card.boardId,
		listId: card.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { relation: type, target: targetCardId },
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: card.boardId, listId: card.listId, cardId, actor: uid });
	return (await BoardsCards.findOneById(cardId)) as IBoardCard;
}

/** Remove a typed relation (and its inverse on the target). */
export async function removeRelation(uid: string, cardId: string, type: RelationType, targetCardId: string): Promise<IBoardCard> {
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardRelations' });
	}
	await assertBoardRole(card.boardId, uid, 'member', 'boards.cardUpdate');

	await BoardsCards.updateOne({ _id: cardId }, { $pull: { relations: { type, cardId: targetCardId } }, $inc: { rev: 1 } });
	await BoardsCards.updateOne(
		{ _id: targetCardId },
		{ $pull: { relations: { type: inverseRelation(type), cardId } }, $inc: { rev: 1 } },
	);
	emitBoardEvent('card.updated', { boardId: card.boardId, listId: card.listId, cardId, actor: uid });
	return (await BoardsCards.findOneById(cardId)) as IBoardCard;
}

// ---------------------------------------------------------------------------
// Board copy / duplicate
// ---------------------------------------------------------------------------

/** Duplicate a board's structure — its lists, field/label defs, and settings — into a new board
 * owned by the caller. Cards are NOT copied (a fresh project from the same template). */
export async function copyBoard(uid: string, boardId: string): Promise<IBoard> {
	const src = await Boards.findOneById(boardId);
	if (!src) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.copy' });
	}
	await assertBoardRole(boardId, uid, 'member', 'boards.boardInfo');

	const now = new Date();
	const doc: Omit<IBoard, '_id' | '_updatedAt'> = {
		title: `Copy of ${src.title}`,
		pipelineType: src.pipelineType,
		...(src.description ? { description: src.description } : {}),
		...(src.icon ? { icon: src.icon } : {}),
		...(src.background ? { background: src.background } : {}),
		members: [{ userId: uid, role: 'admin' }],
		labelDefs: (src.labelDefs || []).map((d) => ({ ...d })),
		fieldDefs: (src.fieldDefs || []).map((d) => ({ ...d })),
		visibility: src.visibility,
		cardCounter: 0,
		schemaVersion: src.schemaVersion ?? 1,
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};
	const { insertedId } = await Boards.insertOne(doc);
	const board = await Boards.findOneById(insertedId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.copy' });
	}

	const srcLists = await BoardsLists.findByBoard(boardId).toArray();
	for (const list of srcLists.filter((l) => !l.archived).sort((a, b) => a.position - b.position)) {
		await BoardsLists.insertOne({
			boardId: board._id,
			title: list.title,
			position: list.position,
			...(typeof list.wipLimit === 'number' ? { wipLimit: list.wipLimit } : {}),
			...(list.subStatuses ? { subStatuses: [...list.subStatuses] } : {}),
			...(list.collapsed ? { collapsed: list.collapsed } : {}),
			...(list.color ? { color: list.color } : {}),
			archived: false,
			rev: 0,
		} as Omit<IBoardList, '_id' | '_updatedAt'>);
	}

	await BoardsActivities.log({ boardId: board._id, actor: uid, verb: 'board.created', to: { title: board.title, copiedFrom: src._id }, ts: now });
	emitBoardEvent('board.created', { boardId: board._id, actor: uid });
	return board;
}

/** Create a new card from a "template" card: clone its content (title, description, checklists,
 * labels, assignees, fields, priority) into a target list. Any card can serve as a template. */
export async function createCardFromTemplate(uid: string, templateCardId: string, listId: string): Promise<IBoardCard> {
	const src = await BoardsCards.findOneById(templateCardId);
	if (!src) {
		throw new Meteor.Error('error-card-not-found', 'Template card not found', { method: 'boards.cardFromTemplate' });
	}
	const list = await BoardsLists.findOneById(listId);
	if (!list || list.archived) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.cardFromTemplate' });
	}
	await assertBoardRole(list.boardId, uid, 'member', 'boards.cardCreate');

	const now = new Date();
	const position = (await BoardsCards.maxPosition(listId)) + POSITION_STEP;
	const cardNumber = await Boards.nextCardNumber(list.boardId);
	const doc: Omit<IBoardCard, '_id' | '_updatedAt'> = {
		boardId: list.boardId,
		listId,
		title: src.title,
		...(src.description ? { description: src.description } : {}),
		position,
		cardType: src.cardType,
		...(src.subStatus ? { subStatus: src.subStatus } : {}),
		labels: [...(src.labels || [])],
		assignees: [...(src.assignees || [])],
		watchers: [],
		fieldValues: { ...(src.fieldValues || {}) },
		checklists: (src.checklists || []).map((cl) => ({ ...cl, items: cl.items.map((it) => ({ ...it, done: false })) })),
		attachments: [],
		comments: [],
		cardNumber,
		...(src.priority ? { priority: src.priority } : {}),
		archived: false,
		rev: 0,
		createdBy: uid,
		createdAt: now,
	};
	const { insertedId } = await BoardsCards.insertOne(doc);
	const card = await BoardsCards.findOneById(insertedId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardFromTemplate' });
	}
	await BoardsActivities.log({ boardId: list.boardId, listId, cardId: card._id, actor: uid, verb: 'card.created', to: { title: card.title, fromTemplate: src._id }, ts: now });
	emitBoardEvent('card.created', { boardId: list.boardId, listId, cardId: card._id, actor: uid });
	return card;
}

/** Flag/unflag a card as a milestone (a key dated checkpoint). */
export async function setMilestone(uid: string, cardId: string, value: boolean): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardMilestone' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');
	await BoardsCards.updateOne({ _id: cardId }, { $set: { isMilestone: value }, $inc: { rev: 1 } });
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardMilestone' });
	}
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

// ---------------------------------------------------------------------------
// Card approvals (request -> approved | changes | rejected)
// ---------------------------------------------------------------------------

/** Request approval on a card — sets it pending with the chosen approvers. */
export async function requestApproval(uid: string, cardId: string, approvers: string[]): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardApproval' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');
	await BoardsCards.updateOne(
		{ _id: cardId },
		{ $set: { approval: { status: 'pending', approvers: approvers || [], requestedBy: uid } }, $inc: { rev: 1 } },
	);
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardApproval' });
	}
	await BoardsActivities.log({ boardId: current.boardId, listId: current.listId, cardId, actor: uid, verb: 'card.updated', to: { approval: 'requested' }, ts: new Date() });
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

/** Decide a card's approval: approved | changes | rejected. */
export async function decideApproval(uid: string, cardId: string, decision: 'approved' | 'changes' | 'rejected'): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardApproval' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardUpdate');
	await BoardsCards.updateOne(
		{ _id: cardId },
		{ $set: { 'approval.status': decision, 'approval.decidedBy': uid, 'approval.decidedAt': new Date() }, $inc: { rev: 1 } },
	);
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardApproval' });
	}
	await BoardsActivities.log({ boardId: current.boardId, listId: current.listId, cardId, actor: uid, verb: 'card.updated', to: { approval: decision }, ts: new Date() });
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });
	return card;
}

/**
 * The drag hot path. Single model `move` (one $set listId/position/subStatus +
 * $inc rev), then audit + automation seam. `card.moved` carries from/to so the
 * future automation engine + the card Activity tab can render the transition.
 */
export async function moveCard(
	uid: string,
	cardId: string,
	toListId: string,
	position: number,
	subStatus?: string,
): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardMove' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardMove');

	const targetList = await BoardsLists.findOneById(toListId);
	if (!targetList || targetList.boardId !== current.boardId || targetList.archived) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.cardMove' });
	}

	await BoardsCards.move(cardId, toListId, position, subStatus);
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardMove' });
	}

	await BoardsActivities.log({
		boardId: current.boardId,
		listId: toListId,
		cardId,
		actor: uid,
		verb: 'card.moved',
		from: { listId: current.listId, position: current.position, subStatus: current.subStatus },
		to: { listId: toListId, position, subStatus },
		ts: new Date(),
	});
	emitBoardEvent('card.moved', {
		boardId: current.boardId,
		listId: toListId,
		cardId,
		actor: uid,
		fromListId: current.listId,
		toListId,
	});

	return card;
}

export async function archiveCard(uid: string, cardId: string): Promise<{ ok: true }> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardArchive' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardArchive');

	await BoardsCards.archiveCard(cardId);

	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.archived',
		ts: new Date(),
	});
	emitBoardEvent('card.archived', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });

	return { ok: true };
}

/** Permanently delete a card (hard delete, distinct from archive). Same member gate as archive. */
export async function deleteCard(uid: string, cardId: string): Promise<{ ok: true }> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardDelete' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.cardDelete');

	await BoardsCards.removeById(cardId);

	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.deleted',
		ts: new Date(),
	});
	emitBoardEvent('card.deleted', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });

	return { ok: true };
}

// ---------------------------------------------------------------------------
// Bulk card operations
// ---------------------------------------------------------------------------

export type BulkCardAction = 'move' | 'complete' | 'archive' | 'setPriority' | 'delete';

export type BulkCardParams = {
	// move
	toListId?: string;
	position?: number;
	subStatus?: string;
	// complete
	completed?: boolean;
	// setPriority
	priority?: IBoardCard['priority'];
};

export type BulkCardResult = { cardId: string; ok: boolean; error?: string };

export type BulkCardResponse = { results: BulkCardResult[]; updated: number; failed: number };

/**
 * Apply one action to many cards by REUSING the single-card service functions in a loop. Each
 * card is processed independently with its own try/catch so one bad card (missing, permission,
 * validation) never aborts the batch — the per-card permission gate is exactly the one the
 * single-card endpoint enforces, because we call the same function. The `position` for `move`
 * is subdivided per card so a bulk move keeps a stable relative order in the target list.
 */
export async function bulkCardOperation(
	uid: string,
	cardIds: string[],
	action: BulkCardAction,
	params: BulkCardParams = {},
): Promise<BulkCardResponse> {
	const results: BulkCardResult[] = [];

	for (let i = 0; i < cardIds.length; i++) {
		const cardId = cardIds[i];
		try {
			switch (action) {
				case 'move': {
					if (!params.toListId) {
						throw new Meteor.Error('error-invalid-params', 'toListId is required for move', { method: 'boards.cardsBulk' });
					}
					// keep a stable order: offset each card's position so they don't collide
					const basePosition = typeof params.position === 'number' ? params.position : 0;
					await moveCard(uid, cardId, params.toListId, basePosition + i * POSITION_STEP, params.subStatus);
					break;
				}
				case 'complete':
					await completeCard(uid, cardId, params.completed !== false);
					break;
				case 'archive':
					await archiveCard(uid, cardId);
					break;
				case 'setPriority':
					await updateCard(uid, cardId, { priority: params.priority });
					break;
				case 'delete':
					await deleteCard(uid, cardId);
					break;
				default:
					throw new Meteor.Error('error-invalid-action', `Unknown bulk action: ${action as string}`, { method: 'boards.cardsBulk' });
			}
			results.push({ cardId, ok: true });
		} catch (err) {
			results.push({ cardId, ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	}

	const updated = results.filter((r) => r.ok).length;
	return { results, updated, failed: results.length - updated };
}

// ---------------------------------------------------------------------------
// Labels / tags
//
// Two-level model (mirrors fieldDefs): a board owns a *palette* of label
// definitions (`board.labelDefs: { id, name, color }[]`) and each card holds a
// list of label-id *references* (`card.labels: string[]`). Managing the palette
// (create/update/delete) is an `admin` action like updateBoard; assigning labels
// to a card is a `member` action like updateCard. Deleting a palette label also
// scrubs the now-dangling reference from every card on the board.
// ---------------------------------------------------------------------------

export type CreateLabelParams = { name: string; color: string };

/** Add a label definition to a board's palette. Returns the fresh board. */
export async function createBoardLabel(uid: string, boardId: string, params: CreateLabelParams): Promise<IBoard> {
	await assertBoardRole(boardId, uid, 'admin', 'boards.labelCreate');

	const name = params.name?.trim();
	if (!name) {
		throw new Meteor.Error('error-invalid-label-name', 'Invalid label name', { method: 'boards.labelCreate' });
	}
	const color = params.color?.trim();
	if (!color) {
		throw new Meteor.Error('error-invalid-label-color', 'Invalid label color', { method: 'boards.labelCreate' });
	}

	const label: IBoardLabelDef = { id: Random.id(), name, color };
	await Boards.addLabelDef(boardId, label);

	const board = await Boards.findOneById(boardId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.labelCreate' });
	}

	await BoardsActivities.log({ boardId, actor: uid, verb: 'board.updated', to: { label: 'created', labelId: label.id, name }, ts: new Date() });
	emitBoardEvent('board.updated', { boardId, actor: uid });

	return board;
}

export type UpdateLabelPatch = Partial<Pick<IBoardLabelDef, 'name' | 'color'>>;

/** Rename / recolor an existing palette label. Returns the fresh board. */
export async function updateBoardLabel(uid: string, boardId: string, labelId: string, patch: UpdateLabelPatch): Promise<IBoard> {
	await assertBoardRole(boardId, uid, 'admin', 'boards.labelUpdate');

	const set: UpdateLabelPatch = {};
	if (typeof patch.name === 'string' && patch.name.trim()) {
		set.name = patch.name.trim();
	}
	if (typeof patch.color === 'string' && patch.color.trim()) {
		set.color = patch.color.trim();
	}
	if (Object.keys(set).length) {
		await Boards.updateLabelDef(boardId, labelId, set);
	}

	const board = await Boards.findOneById(boardId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.labelUpdate' });
	}

	await BoardsActivities.log({ boardId, actor: uid, verb: 'board.updated', to: { label: 'updated', labelId, ...set }, ts: new Date() });
	emitBoardEvent('board.updated', { boardId, actor: uid });

	return board;
}

/** Delete a palette label and scrub its now-dangling reference off every card on the board. */
export async function deleteBoardLabel(uid: string, boardId: string, labelId: string): Promise<IBoard> {
	await assertBoardRole(boardId, uid, 'admin', 'boards.labelDelete');

	await Boards.removeLabelDef(boardId, labelId);
	// scrub the dangling reference from every card so cards never point at a missing def
	await BoardsCards.updateMany({ boardId, labels: labelId }, { $pull: { labels: labelId }, $inc: { rev: 1 } });

	const board = await Boards.findOneById(boardId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.labelDelete' });
	}

	await BoardsActivities.log({ boardId, actor: uid, verb: 'board.updated', to: { label: 'deleted', labelId }, ts: new Date() });
	emitBoardEvent('board.updated', { boardId, actor: uid });

	return board;
}

/**
 * Replace a card's label set wholesale. `labelIds` must reference labels that
 * exist in the card's board palette; unknown ids are rejected so a card can
 * never reference a missing def. Member-level action, like updateCard.
 */
export async function setCardLabels(uid: string, cardId: string, labelIds: string[]): Promise<IBoardCard> {
	const current = await BoardsCards.findOneById(cardId);
	if (!current) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardLabelsSet' });
	}
	const board = await assertBoardRole(current.boardId, uid, 'member', 'boards.cardLabelsSet');

	// de-dupe, then validate every id against the board palette
	const requested = Array.from(new Set(labelIds));
	const known = new Set((board.labelDefs || []).map((d) => d.id));
	for (const id of requested) {
		if (!known.has(id)) {
			throw new Meteor.Error('error-invalid-label', `Unknown label id: ${id}`, { method: 'boards.cardLabelsSet' });
		}
	}

	await BoardsCards.updateOne({ _id: cardId }, { $set: { labels: requested }, $inc: { rev: 1 } });
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.cardLabelsSet' });
	}

	await BoardsActivities.log({
		boardId: current.boardId,
		listId: current.listId,
		cardId,
		actor: uid,
		verb: 'card.updated',
		to: { labels: requested },
		ts: new Date(),
	});
	emitBoardEvent('card.updated', { boardId: current.boardId, listId: current.listId, cardId, actor: uid });

	return card;
}
