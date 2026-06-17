import type {
	IBoardCard,
	IBoardList,
	IChecklist,
	IChecklistItem,
	IPlaybookTemplate,
	IPlaybookItem,
} from '@rocket.chat/core-typings';
import { BoardsCards, BoardsLists, BoardsPlaybooks, BoardsDeadlines, BoardsActivities } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { Meteor } from 'meteor/meteor';

import { createDeadline } from './deadlines';
import { normalizeStageName } from './stages';

/**
 * Stage playbooks for the matters pipeline (M5 — see matters-case-management.md §4
 * and differentiators.md §9). When a matter card enters a stage column, the matching
 * enabled playbook is materialized onto the card: checklist items become entries in
 * the card's embedded checklist, task items become due-dated checklist entries, and
 * any item with `createsDeadlineKind` also creates a `boards_deadlines` row.
 *
 * Targeting precedence (mirrors the model finders): `stageKey == list.caseproStageId`
 * first, then a case-insensitive `listName == list.title` fallback (the firm-portable
 * match when stage ids differ between firms).
 *
 * Idempotency: a playbook is applied at most once per (card, list). We guard via a
 * marker checklist title derived from the playbook id, and skip if it already exists.
 * Mutation convention mirrors the sibling services: model write → BoardsActivities.log.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The marker-checklist title that records a playbook was already applied to a card. */
const appliedMarker = (playbookId: string): string => `__playbook:${playbookId}`;

// ---------------------------------------------------------------------------
// applyPlaybookOnEnter
// ---------------------------------------------------------------------------

export type ApplyPlaybookResult = {
	applied: IPlaybookTemplate[];
	checklistItemsAdded: number;
	deadlinesCreated: number;
};

/**
 * Apply every matching enabled playbook for the list a matter card just entered.
 * Resolves playbooks by `stageKey` (the list's `caseproStageId`) first, then by a
 * case-insensitive list-title match. Idempotent per (card, playbook) — a playbook
 * already applied to the card is skipped (guarded by a marker checklist).
 *
 * Returns counts for the caller's audit/UI. Never throws on a single bad item; a
 * deadline-creation failure is swallowed so it can never block the stage entry.
 */
export async function applyPlaybookOnEnter(uid: string, card: IBoardCard, list: IBoardList): Promise<ApplyPlaybookResult> {
	const result: ApplyPlaybookResult = { applied: [], checklistItemsAdded: 0, deadlinesCreated: 0 };

	if (card.cardType !== 'matter') {
		return result; // playbooks only materialize on matter cards in M5
	}

	const playbooks = await resolvePlaybooks(list);
	if (!playbooks.length) {
		return result;
	}

	// reload the card once so we mutate against the freshest embedded checklists.
	const fresh = (await BoardsCards.findOneById(card._id)) ?? card;
	const existingTitles = new Set((fresh.checklists ?? []).map((c) => c.title));
	const now = new Date();

	for (const playbook of playbooks) {
		const marker = appliedMarker(playbook._id);
		if (existingTitles.has(marker)) {
			continue; // already applied to this card — idempotent re-enter no-op.
		}

		const items = [...(playbook.items ?? [])].sort((a, b) => a.order - b.order);
		const checklistItems: IChecklistItem[] = items.map((item, idx) => buildChecklistItem(item, idx, now));

		// the playbook materializes as one named checklist on the card.
		const checklist: IChecklist = {
			id: Random.id(),
			title: playbook.name,
			position: (fresh.checklists?.length ?? 0) + result.applied.length,
			items: checklistItems,
		};
		// an invisible marker checklist records the apply for idempotency.
		const markerChecklist: IChecklist = { id: Random.id(), title: marker, position: 9999, items: [] };

		await BoardsCards.updateOne(
			{ _id: card._id },
			{ $push: { checklists: { $each: [checklist, markerChecklist] } }, $inc: { rev: 1 } },
		);
		result.checklistItemsAdded += checklistItems.length;

		// any item flagged with createsDeadlineKind also stamps a real deadline.
		for (const item of items) {
			if (!item.createsDeadlineKind) {
				continue;
			}
			try {
				const dueDate = new Date(now.getTime() + (item.dueOffsetDays ?? 0) * DAY_MS);
				await createDeadline(uid, {
					cardId: card._id,
					kind: item.createsDeadlineKind,
					dueDate,
					label: item.title,
					computedFrom: 'playbook',
				});
				result.deadlinesCreated += 1;
			} catch {
				// a deadline-creation failure must never block the stage-entry playbook.
			}
		}

		await BoardsActivities.log({
			boardId: card.boardId,
			listId: list._id,
			cardId: card._id,
			actor: uid,
			verb: 'checklist.created',
			to: { playbookId: playbook._id, playbookName: playbook.name, items: checklistItems.length },
			ts: now,
		});

		result.applied.push(playbook);
	}

	return result;
}

/** Build a checklist item from a playbook item, due-dating tasks via dueOffsetDays. */
function buildChecklistItem(item: IPlaybookItem, idx: number, now: Date): IChecklistItem {
	const dueDate =
		item.dueOffsetDays !== undefined ? new Date(now.getTime() + item.dueOffsetDays * DAY_MS) : undefined;
	return {
		id: Random.id(),
		text: item.title,
		done: false,
		position: idx,
		...(dueDate ? { dueDate } : {}),
	};
}

/**
 * Resolve the enabled playbooks targeting a list: by stageKey (caseproStageId) first,
 * else by case-insensitive list title. De-dupes if both match the same playbook.
 */
async function resolvePlaybooks(list: IBoardList): Promise<IPlaybookTemplate[]> {
	const byId = new Map<string, IPlaybookTemplate>();

	if (list.caseproStageId) {
		const byStage = await BoardsPlaybooks.findByStageKey('matters', list.caseproStageId).toArray();
		for (const p of byStage) {
			if (p.appliesOnEnter !== false) {
				byId.set(p._id, p);
			}
		}
	}

	const byName = await BoardsPlaybooks.findByListName('matters', list.title).toArray();
	for (const p of byName) {
		if (p.appliesOnEnter !== false) {
			byId.set(p._id, p);
		}
	}

	return [...byId.values()];
}

/**
 * Manual apply: re-materialize a specific playbook onto a card regardless of its
 * current stage (the "apply" REST action). Honors the same idempotency marker.
 */
export async function applyPlaybookToCard(uid: string, cardId: string, playbookId: string): Promise<ApplyPlaybookResult> {
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		throw new Meteor.Error('error-card-not-found', 'Card not found', { method: 'boards.matters.playbooks.apply' });
	}
	const playbook = await BoardsPlaybooks.findOneById(playbookId);
	if (!playbook || !playbook.enabled) {
		throw new Meteor.Error('error-playbook-not-found', 'Playbook not found or disabled', {
			method: 'boards.matters.playbooks.apply',
		});
	}
	const list = await BoardsLists.findOneById(card.listId);
	if (!list) {
		throw new Meteor.Error('error-list-not-found', 'List not found', { method: 'boards.matters.playbooks.apply' });
	}

	// reuse the on-enter materializer but force this single playbook by faking the
	// resolution: temporarily match by passing a list whose title equals the playbook's
	// — simplest is to inline the same materialize path. We call the shared apply with a
	// one-playbook resolver by materializing directly here.
	const result: ApplyPlaybookResult = { applied: [], checklistItemsAdded: 0, deadlinesCreated: 0 };
	const existingTitles = new Set((card.checklists ?? []).map((c) => c.title));
	const marker = appliedMarker(playbook._id);
	if (existingTitles.has(marker)) {
		return result; // already applied — idempotent.
	}

	const items = [...(playbook.items ?? [])].sort((a, b) => a.order - b.order);
	const now = new Date();
	const checklistItems: IChecklistItem[] = items.map((item, idx) => buildChecklistItem(item, idx, now));
	const checklist: IChecklist = {
		id: Random.id(),
		title: playbook.name,
		position: card.checklists?.length ?? 0,
		items: checklistItems,
	};
	const markerChecklist: IChecklist = { id: Random.id(), title: marker, position: 9999, items: [] };

	await BoardsCards.updateOne(
		{ _id: card._id },
		{ $push: { checklists: { $each: [checklist, markerChecklist] } }, $inc: { rev: 1 } },
	);
	result.checklistItemsAdded += checklistItems.length;

	for (const item of items) {
		if (!item.createsDeadlineKind) {
			continue;
		}
		try {
			const dueDate = new Date(now.getTime() + (item.dueOffsetDays ?? 0) * DAY_MS);
			await createDeadline(uid, {
				cardId: card._id,
				kind: item.createsDeadlineKind,
				dueDate,
				label: item.title,
				computedFrom: 'playbook',
			});
			result.deadlinesCreated += 1;
		} catch {
			// best-effort; never block the manual apply on a deadline failure.
		}
	}

	await BoardsActivities.log({
		boardId: card.boardId,
		listId: card.listId,
		cardId: card._id,
		actor: uid,
		verb: 'checklist.created',
		to: { playbookId: playbook._id, playbookName: playbook.name, items: checklistItems.length, manual: true },
		ts: now,
	});

	result.applied.push(playbook);
	return result;
}

// ---------------------------------------------------------------------------
// applyMatterStageEntry — the cardMove seam
// ---------------------------------------------------------------------------

/**
 * Stage-specific deadlines stamped when a matter enters a stage column, independent
 * of any playbook (so the safety-critical timers fire even on a firm that disabled
 * the playbook). Keyed by normalized list title. Demand-Sent → +30d response timer
 * (matters §4 "Demand Sent: set 30-day response timer").
 */
const STAGE_ENTRY_DEADLINES: Record<string, { kind: IPlaybookItem['createsDeadlineKind']; offsetDays: number; label: string }[]> = {
	demanded: [{ kind: 'response', offsetDays: 30, label: 'Demand response due' }],
	'demand writing': [],
	'litigation filed': [{ kind: 'filing', offsetDays: 0, label: 'Suit filed' }],
};

export type MatterStageEntryResult = {
	playbook: ApplyPlaybookResult;
	stageDeadlinesCreated: number;
};

/**
 * The `boards.cardMove` matter seam. After a matter card moves into a new list, this:
 *   (a) applies the new stage's playbook(s) (idempotent per card+playbook), and
 *   (b) creates any stage-specific deadlines (e.g. Demand-Sent → +30d response).
 *
 * No-op for non-matter cards / unknown lists. Best-effort throughout: a failure in
 * either step is swallowed so a stage change is never blocked. Called by cardMove.ts.
 */
export async function applyMatterStageEntry(uid: string, cardId: string, toListId: string): Promise<MatterStageEntryResult> {
	const empty: MatterStageEntryResult = {
		playbook: { applied: [], checklistItemsAdded: 0, deadlinesCreated: 0 },
		stageDeadlinesCreated: 0,
	};

	const card = await BoardsCards.findOneById(cardId);
	if (!card || card.cardType !== 'matter') {
		return empty; // no-op for non-matter cards
	}
	const list = await BoardsLists.findOneById(toListId);
	if (!list || list.boardId !== card.boardId) {
		return empty;
	}

	let playbook: ApplyPlaybookResult = empty.playbook;
	try {
		playbook = await applyPlaybookOnEnter(uid, card, list);
	} catch {
		// never block a stage change on a playbook failure.
	}

	let stageDeadlinesCreated = 0;
	const stageDeadlines = STAGE_ENTRY_DEADLINES[normalizeStageName(list.title)] ?? [];
	const now = new Date();
	for (const spec of stageDeadlines) {
		if (!spec.kind) {
			continue;
		}
		try {
			// idempotency: don't stack a second open deadline of the same kind on the card.
			const existing = await BoardsDeadlines.findOneOpenByCardAndKind(card._id, spec.kind);
			if (existing) {
				continue;
			}
			await createDeadline(uid, {
				cardId: card._id,
				kind: spec.kind,
				dueDate: new Date(now.getTime() + spec.offsetDays * DAY_MS),
				label: spec.label,
				computedFrom: 'sequence',
			});
			stageDeadlinesCreated += 1;
		} catch {
			// best-effort; a deadline failure never blocks the stage change.
		}
	}

	return { playbook, stageDeadlinesCreated };
}

// ---------------------------------------------------------------------------
// listPlaybooks
// ---------------------------------------------------------------------------

/** List the matters-pipeline playbook templates (enabled, name order). Read-only. */
export async function listPlaybooks(): Promise<IPlaybookTemplate[]> {
	return BoardsPlaybooks.findByPipeline('matters').toArray();
}

// ---------------------------------------------------------------------------
// seedDefaultPlaybooks
// ---------------------------------------------------------------------------

/**
 * The §4 system playbooks, keyed by stable `listName` (the firm-portable match — the
 * names line up with the canonical CasePro stage names + the doc's stage labels).
 * `order` within each playbook drives item ordering. `dueOffsetDays` are relative to
 * the day the card enters the stage. Items flagged with `createsDeadlineKind` also
 * stamp a deadline (e.g. the Demand-Sent +30d response timer).
 */
type PlaybookSeed = {
	/** stable seed key (also the listName the playbook targets). */
	name: string;
	listName: string;
	description: string;
	items: Omit<IPlaybookItem, 'id'>[];
};

const SYSTEM_PLAYBOOK_SEEDS: PlaybookSeed[] = [
	{
		name: 'Intake',
		listName: 'Intake',
		description: 'Open the file and clear the gate to active work.',
		items: [
			{ kind: 'checklist', title: 'Open file', order: 1, required: true },
			{ kind: 'checklist', title: 'Conflict check cleared', order: 2, required: true },
			{ kind: 'checklist', title: 'Retainer signed', order: 3, required: true },
			{ kind: 'task', title: 'Create CasePro matter', order: 4, assigneeRole: 'case-manager' },
			{ kind: 'task', title: 'Create LitBox folder', order: 5, assigneeRole: 'paralegal' },
			{ kind: 'task', title: 'Send welcome packet', order: 6, dueOffsetDays: 2, assigneeRole: 'case-manager' },
		],
	},
	{
		name: 'Treating',
		listName: 'Investigation',
		description: 'Track the client through active treatment.',
		items: [
			{ kind: 'checklist', title: 'Confirm treatment plan', order: 1, assigneeRole: 'case-manager' },
			{ kind: 'task', title: '30-day treatment-status follow-up', order: 2, dueOffsetDays: 30, assigneeRole: 'case-manager' },
			{ kind: 'task', title: 'Request gap-in-treatment review', order: 3, dueOffsetDays: 30, assigneeRole: 'paralegal' },
		],
	},
	{
		name: 'Records Collection',
		listName: 'Pre-Litigation',
		description: 'Collect medical records and bills per provider.',
		items: [
			{ kind: 'task', title: 'Request records + bills per provider', order: 1, dueOffsetDays: 3, assigneeRole: 'paralegal' },
			{ kind: 'task', title: 'Track receipt of records', order: 2, dueOffsetDays: 14, assigneeRole: 'paralegal' },
			{ kind: 'checklist', title: 'Flag missing records', order: 3, assigneeRole: 'paralegal' },
		],
	},
	{
		name: 'Demand Prep',
		listName: 'Demand Writing',
		description: 'Assemble specials and draft the demand for attorney review.',
		items: [
			{ kind: 'task', title: 'Assemble records', order: 1, dueOffsetDays: 5, assigneeRole: 'paralegal' },
			{ kind: 'task', title: 'Calculate specials', order: 2, dueOffsetDays: 5, assigneeRole: 'paralegal' },
			{ kind: 'task', title: 'Draft demand (Claude assist)', order: 3, dueOffsetDays: 7, assigneeRole: 'paralegal' },
			{ kind: 'checklist', title: 'Attorney review', order: 4, required: true, assigneeRole: 'attorney' },
		],
	},
	{
		name: 'Demand Sent',
		listName: 'Demanded',
		description: 'Log the demand and start the response timer.',
		items: [
			{ kind: 'checklist', title: 'Log demand amount', order: 1, required: true, assigneeRole: 'case-manager' },
			{
				kind: 'task',
				title: '30-day demand response timer',
				order: 2,
				dueOffsetDays: 30,
				createsDeadlineKind: 'response',
				assigneeRole: 'attorney',
			},
		],
	},
	{
		name: 'Settlement',
		listName: 'Pre-Lit Settled',
		description: 'Resolve liens, disburse, and close the file.',
		items: [
			{ kind: 'checklist', title: 'Signed release', order: 1, required: true, assigneeRole: 'attorney' },
			{ kind: 'task', title: 'Lien resolution', order: 2, dueOffsetDays: 14, assigneeRole: 'case-manager' },
			{ kind: 'task', title: 'Disbursement statement', order: 3, dueOffsetDays: 14, assigneeRole: 'paralegal' },
			{ kind: 'task', title: 'Client payment', order: 4, dueOffsetDays: 21, assigneeRole: 'case-manager' },
			{ kind: 'checklist', title: 'Close file', order: 5, assigneeRole: 'case-manager' },
		],
	},
];

export type SeedPlaybooksResult = { created: number; existing: number; total: number };

/**
 * Upsert the §4 system playbooks as `isSystem` templates, idempotent on the stable
 * seed `name`. A second run never duplicates them (it matches by name + isSystem) and
 * leaves any firm edits to an already-seeded playbook untouched. Returns counts.
 */
export async function seedDefaultPlaybooks(uid?: string): Promise<SeedPlaybooksResult> {
	let created = 0;
	let existing = 0;
	const now = new Date();

	for (const seed of SYSTEM_PLAYBOOK_SEEDS) {
		const already = await BoardsPlaybooks.findOne({ name: seed.name, isSystem: true, pipelineType: 'matters' });
		if (already) {
			existing += 1;
			continue;
		}

		const doc: Omit<IPlaybookTemplate, '_id' | '_updatedAt'> = {
			name: seed.name,
			description: seed.description,
			pipelineType: 'matters',
			listName: seed.listName,
			items: seed.items.map((item) => ({ ...item, id: Random.id() })),
			enabled: true,
			isSystem: true,
			appliesOnEnter: true,
			rev: 0,
			...(uid ? { createdBy: uid } : {}),
			createdAt: now,
			updatedAt: now,
		};
		await BoardsPlaybooks.insertOne(doc);
		created += 1;
	}

	return { created, existing, total: SYSTEM_PLAYBOOK_SEEDS.length };
}
