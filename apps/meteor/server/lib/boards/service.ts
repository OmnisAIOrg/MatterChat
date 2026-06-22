import type { IBoard, IBoardList, IBoardCard, BoardsPipelineType, BoardsCardType, IBoardCardLink } from '@rocket.chat/core-typings';
import { Boards, BoardsLists, BoardsCards, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { assertBoardRole, getBoardForUser } from './permissions';
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

export type UpdateListPatch = Partial<Pick<IBoardList, 'title' | 'wipLimit' | 'subStatuses' | 'collapsed'>>;

export async function updateList(uid: string, listId: string, patch: UpdateListPatch): Promise<IBoardList> {
	const current = await BoardsLists.findOneById(listId);
	if (!current) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.listUpdate' });
	}
	await assertBoardRole(current.boardId, uid, 'member', 'boards.listUpdate');

	const set: UpdateListPatch = {};
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

	await BoardsLists.updateOne({ _id: listId }, { $set: set, $inc: { rev: 1 } });
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
		'title' | 'description' | 'startDate' | 'dueDate' | 'dueComplete' | 'cover' | 'subStatus' | 'assignees' | 'watchers' | 'priority'
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
