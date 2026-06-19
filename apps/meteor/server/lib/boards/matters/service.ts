import type { IBoard, IBoardCard, IBoardList } from '@rocket.chat/core-typings';
import { Boards, BoardsLists, BoardsCards, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { createBoard, createList } from '../service';
import { caseProClient } from './caseProClient';
import type { CaseProStage } from './caseProClient';
import { getStageId } from './caseProClientTypes';
import { ensureSolDeadlineForMatter } from './deadlines';
import { MATTER_STAGE_SEEDS, normalizeStageName } from './stages';

/**
 * Matters-pipeline service (M3a). Builds on the M1 board/list/card core:
 *   - the matters board is a single `pipelineType: 'matters'` board per owner,
 *   - its 13 columns ARE the real CasePro `matter_stages` (resolved at runtime,
 *     name-matched to the canonical seed table for sub-stages + ordering),
 *   - each card is `cardType: 'matter'` linked to a CasePro matter id, with a
 *     read-through `IMatterSnapshot` cached on the link.
 *
 * Mutation convention matches `../service`: mutate via the M1 models, then append a
 * `BoardsActivities` row. CasePro reads are delegated entirely to `caseProClient`.
 */

const POSITION_STEP = 1024;

// ---------------------------------------------------------------------------
// ensureMattersBoard
// ---------------------------------------------------------------------------

/**
 * Find (or create) the caller's matters-pipeline board and guarantee its 13 stage
 * lists exist, each carrying its real CasePro `caseproStageId` + sub-stages.
 *
 * Idempotent: re-running never duplicates lists (it matches existing lists by
 * `caseproStageId` first, then by title) and only seeds the ones still missing.
 */
export async function ensureMattersBoard(uid: string): Promise<{ board: IBoard; lists: IBoardList[] }> {
	if (!uid) {
		throw new Meteor.Error('error-invalid-user', 'Invalid user', { method: 'boards.matters.ensureBoard' });
	}

	// 1. find an existing matters board the user is a member of, else create one.
	const existing = await Boards.findByPipelineType('matters').toArray();
	let board = existing.find((b) => b.members.some((m) => m.userId === uid));
	if (!board) {
		board = await createBoard(uid, { title: 'Matters', pipelineType: 'matters', description: 'CasePro matters pipeline' });
	}

	// 2. resolve the real CasePro stages (id + order). Fall back to canonical names
	//    when the client cannot be reached so the board is still usable offline.
	const stages = await resolveStages();

	// 3. seed any missing stage lists (match by caseproStageId, then by title).
	const current = await BoardsLists.findByBoard(board._id).toArray();
	const byStageId = new Map(current.filter((l) => l.caseproStageId).map((l) => [l.caseproStageId as string, l]));
	const byTitle = new Map(current.map((l) => [normalizeStageName(l.title), l]));

	const lists: IBoardList[] = [];
	let position = (await BoardsLists.maxPosition(board._id)) + POSITION_STEP;

	for (const stage of stages) {
		const stageId = getStageId(stage);
		const matched = (stageId && byStageId.get(stageId)) || byTitle.get(normalizeStageName(stage.name));
		if (matched) {
			lists.push(matched);
			continue;
		}
		const seed = MATTER_STAGE_SEEDS.find((s) => normalizeStageName(s.name) === normalizeStageName(stage.name));
		const list = await createList(uid, {
			boardId: board._id,
			title: stage.name,
			position,
			...(stageId ? { caseproStageId: stageId } : {}),
		});
		// seed the sub-stage labels onto the freshly created list (M1 stores them on `subStatuses`).
		if (seed?.subStatuses.length) {
			await BoardsLists.updateOne({ _id: list._id }, { $set: { subStatuses: seed.subStatuses }, $inc: { rev: 1 } });
			list.subStatuses = seed.subStatuses;
		}
		position += POSITION_STEP;
		lists.push(list);
	}

	return { board, lists };
}

/**
 * Stage resolution: prefer the live CasePro list (real ids); fall back to the
 * canonical 13-name seed table (no ids) if the client is unavailable.
 */
async function resolveStages(): Promise<CaseProStage[]> {
	try {
		const stages = await caseProClient.listStages();
		if (stages?.length) {
			return [...stages].sort((a, b) => a.orderIndex - b.orderIndex);
		}
	} catch {
		// fall through to canonical names
	}
	return MATTER_STAGE_SEEDS.map((s) => ({ name: s.name, orderIndex: s.orderIndex }));
}

// ---------------------------------------------------------------------------
// bindMatterCard
// ---------------------------------------------------------------------------

/**
 * Create a `cardType: 'matter'` card on the given list, linked to the CasePro matter,
 * then immediately pull its snapshot. Idempotent on (board, matterId): if a card for
 * the matter already exists on the board it is returned (and re-snapshotted) instead
 * of duplicating it.
 */
export async function bindMatterCard(uid: string, boardId: string, listId: string, matterId: string): Promise<IBoardCard> {
	if (!matterId) {
		throw new Meteor.Error('error-invalid-matter-id', 'Invalid matter id', { method: 'boards.matters.bind' });
	}

	const board = await Boards.findOneById(boardId);
	if (!board || board.archived) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.matters.bind' });
	}
	const list = await BoardsLists.findOneById(listId);
	if (!list || list.boardId !== boardId || list.archived) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.matters.bind' });
	}

	// idempotency: a card already bound to this matter on this board → reuse it.
	const existing = await BoardsCards.findByMatterId(matterId).toArray();
	const onThisBoard = existing.find((c) => c.boardId === boardId && !c.archived);
	if (onThisBoard) {
		await refreshMatterSnapshot(uid, onThisBoard._id);
		const fresh = await BoardsCards.findOneById(onThisBoard._id);
		return fresh ?? onThisBoard;
	}

	const position = (await BoardsCards.maxPosition(listId)) + POSITION_STEP;
	const cardNumber = await Boards.nextCardNumber(boardId);
	const now = new Date();

	const doc: Omit<IBoardCard, '_id' | '_updatedAt'> = {
		boardId,
		listId,
		title: `Matter ${matterId}`, // refined to the matter name by the snapshot refresh below
		position,
		cardType: 'matter',
		link: { kind: 'matter', matterId },
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
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.matters.bind' });
	}

	await BoardsActivities.log({
		boardId,
		listId,
		cardId: card._id,
		actor: uid,
		verb: 'card.linked',
		to: { matterId, cardNumber },
		ts: now,
	});

	// pull the live snapshot now so the front tile renders immediately.
	await refreshMatterSnapshot(uid, card._id);
	const refreshed = await BoardsCards.findOneById(card._id);
	return refreshed ?? card;
}

// ---------------------------------------------------------------------------
// refreshMatterSnapshot
// ---------------------------------------------------------------------------

/**
 * Re-fetch the CasePro snapshot for a matter-linked card and write it onto the link
 * via the M1 `BoardsCards.refreshMatterSnapshot` setter. Also promotes the matter name
 * onto the card title (so the tile shows the client/matter, not the raw id) and logs a
 * `casepro.snapshot.refreshed` activity.
 */
export async function refreshMatterSnapshot(uid: string, cardId: string): Promise<IBoardCard> {
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.matters.refreshSnapshot' });
	}
	if (card.link?.kind !== 'matter') {
		throw new Meteor.Error('error-not-a-matter-card', 'Card is not linked to a matter', {
			method: 'boards.matters.refreshSnapshot',
		});
	}

	const snapshot = await caseProClient.matterSnapshot(card.link.matterId);
	if (!snapshot) {
		throw new Meteor.Error('error-matter-not-found', 'Matter not found in CasePro', {
			method: 'boards.matters.refreshSnapshot',
		});
	}

	await BoardsCards.refreshMatterSnapshot(cardId, snapshot);

	// Safety-critical (differentiators §4 "no missed SOL"): ensure the matter's SOL
	// deadline exists/refreshes off the latest snapshot (CasePro solDate, else
	// incident_date + jurisdiction rules). This is the seam that arms the whole
	// deadline engine — escalation tiers, mandatory ack, the daily SOL watch — so it
	// runs on every bind + manual refresh. Idempotent (findOneOpenByCardAndKind guard
	// inside) and best-effort: a deadline failure must never block the snapshot refresh.
	try {
		await ensureSolDeadlineForMatter(uid, card, snapshot);
	} catch {
		// never block a snapshot refresh on SOL-deadline upkeep; the daily cron is the backstop.
	}

	// keep the card title aligned with the matter's display name when available.
	const title = snapshot.matterName ?? snapshot.clientName;
	if (title && title !== card.title) {
		await BoardsCards.updateOne({ _id: cardId }, { $set: { title }, $inc: { rev: 1 } });
	}

	await BoardsActivities.log({
		boardId: card.boardId,
		listId: card.listId,
		cardId,
		actor: uid,
		verb: 'casepro.snapshot.refreshed',
		to: { matterId: card.link.matterId, fetchedAt: snapshot.fetchedAt },
		ts: new Date(),
	});

	const fresh = await BoardsCards.findOneById(cardId);
	if (!fresh) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.matters.refreshSnapshot' });
	}
	return fresh;
}

// ---------------------------------------------------------------------------
// seedFromCasePro
// ---------------------------------------------------------------------------

export type SeedFromCaseProResult = {
	bound: number;
	skipped: number;
	total: number;
};

/**
 * Bulk-bind: list all CasePro matters and bind a card per matter onto the board list
 * whose `caseproStageId` matches the matter's stage (falling back to a title match,
 * then to the first list). Idempotent — matters already bound on the board are skipped
 * by `bindMatterCard`. Returns counts for the admin/seed UI.
 */
export async function seedFromCasePro(uid: string, boardId: string): Promise<SeedFromCaseProResult> {
	const board = await Boards.findOneById(boardId);
	if (!board || board.archived) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.matters.seedFromCasePro' });
	}

	const lists = await BoardsLists.findByBoard(boardId).toArray();
	if (!lists.length) {
		throw new Meteor.Error('error-board-not-seeded', 'Matters board has no stage lists; ensure the board first', {
			method: 'boards.matters.seedFromCasePro',
		});
	}
	const byStageId = new Map(lists.filter((l) => l.caseproStageId).map((l) => [l.caseproStageId as string, l]));
	const byTitle = new Map(lists.map((l) => [normalizeStageName(l.title), l]));
	const fallback = [...lists].sort((a, b) => a.position - b.position)[0];

	const { matters } = await caseProClient.listMatters();

	let bound = 0;
	let skipped = 0;
	for (const matter of matters) {
		const target =
			(matter.stageId && byStageId.get(matter.stageId)) ||
			(matter.stageName && byTitle.get(normalizeStageName(matter.stageName))) ||
			fallback;
		try {
			await bindMatterCard(uid, boardId, target._id, matter.matterId);
			bound += 1;
		} catch {
			// never let one bad matter abort the whole seed; count it and continue.
			skipped += 1;
		}
	}

	await BoardsActivities.log({
		boardId,
		actor: uid,
		verb: 'card.linked',
		to: { seededFromCasePro: true, bound, skipped, total: matters.length },
		ts: new Date(),
	});

	return { bound, skipped, total: matters.length };
}
