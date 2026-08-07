import type {
	IAutomation,
	IAutomationAction,
	IBoardAutomationFilters,
	IBoardLabelDef,
	IBoardList,
} from '@rocket.chat/core-typings';
import { Boards, BoardsAutomations, BoardsActivities, BoardsLists } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../lib/authorization/hasPermission';

/**
 * Automation TEMPLATE catalog service (M7 — 05-automation-engine.md §9). The §9 seeds are
 * `isTemplate` catalog rows (see startup/boards/automationTemplates.ts): the dispatcher +
 * cron exclude them, so they never fire directly. This module is the install path:
 *
 *   - `listTemplates`   — read the catalog (the prebuilt automations to choose from).
 *   - `installTemplate` — CLONE one onto a board as a board-scoped, enabled, non-template
 *                         automation, best-effort rebinding any list/label references to the
 *                         target board by name and noting any that can't resolve.
 *
 * Both are gated by `boards-manage-automations` (board-scoped on install). Install is
 * idempotent per `(boardId, seedKey)`: re-installing the same template onto the same board
 * returns the existing clone rather than creating a duplicate. Mirrors the `manage.ts`
 * idiom (assert permission → model write → BoardsActivities.log).
 */

async function assertManage(uid: string, boardId?: string): Promise<void> {
	if (!(await hasPermissionAsync(uid, 'boards-manage-automations', boardId))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.automations.templates' });
	}
}

// ---------------------------------------------------------------------------
// Catalog read
// ---------------------------------------------------------------------------

/** List the prebuilt template catalog (the `isTemplate` automations). Gated by manage. */
export async function listTemplates(uid: string): Promise<{ templates: IAutomation[]; total: number }> {
	await assertManage(uid);
	const templates = await BoardsAutomations.findTemplates().toArray();
	return { templates, total: templates.length };
}

// ---------------------------------------------------------------------------
// Install (clone onto a board)
// ---------------------------------------------------------------------------

export type InstallTemplateResult = {
	automation: IAutomation;
	/** true when an existing clone for (boardId, seedKey) was returned instead of creating one. */
	alreadyInstalled: boolean;
	/** human notes for references that could not be rebound to the target board (firm must bind in the builder). */
	notes: string[];
};

/** Resolve a board-local id against the target board's lists by NAME (list.title). */
function rebindListId(id: string | undefined, lists: IBoardList[], notes: string[], where: string): string | undefined {
	if (!id) {
		return id;
	}
	// already a list on this board → keep it.
	if (lists.some((l) => l._id === id)) {
		return id;
	}
	// try to match by name (the template may reference a list by a portable name/title).
	const byName = lists.find((l) => l.title === id);
	if (byName) {
		return byName._id;
	}
	notes.push(`Could not bind list reference "${id}" (${where}) to a list on this board — set it in the builder.`);
	return undefined;
}

/** Resolve a board-local id against the target board's labelDefs by NAME (labelDef.name). */
function rebindLabelId(id: string | undefined, labels: IBoardLabelDef[], notes: string[], where: string): string | undefined {
	if (!id) {
		return id;
	}
	if (labels.some((d) => d.id === id)) {
		return id;
	}
	const byName = labels.find((d) => d.name === id);
	if (byName) {
		return byName.id;
	}
	notes.push(`Could not bind label reference "${id}" (${where}) to a label on this board — set it in the builder.`);
	return undefined;
}

/** Best-effort rebind of a trigger's filter list/label/status references onto the target board. */
function rebindFilters(filters: IBoardAutomationFilters | undefined, lists: IBoardList[], labels: IBoardLabelDef[], notes: string[]): IBoardAutomationFilters | undefined {
	if (!filters) {
		return filters;
	}
	const out: IBoardAutomationFilters = { ...filters };
	if (out.listId !== undefined) {
		out.listId = rebindListId(out.listId, lists, notes, 'trigger filter listId');
	}
	if (out.fromListId !== undefined) {
		out.fromListId = rebindListId(out.fromListId, lists, notes, 'trigger filter fromListId');
	}
	if (out.toListId !== undefined) {
		out.toListId = rebindListId(out.toListId, lists, notes, 'trigger filter toListId');
	}
	if (out.statusId !== undefined) {
		out.statusId = rebindListId(out.statusId, lists, notes, 'trigger filter statusId');
	}
	if (out.labelId !== undefined) {
		out.labelId = rebindLabelId(out.labelId, labels, notes, 'trigger filter labelId');
	}
	return out;
}

/** Best-effort rebind of one action's list/label references onto the target board. */
function rebindAction(action: IAutomationAction, lists: IBoardList[], labels: IBoardLabelDef[], notes: string[]): IAutomationAction {
	// each case spreads a single concrete action arm (no union spread) so the `type`
	// discriminant is preserved — mirrors interpolate.ts's per-action transform.
	switch (action.type) {
		case 'addLabel':
			return { ...action, labelId: rebindLabelId(action.labelId, labels, notes, 'addLabel labelId') ?? action.labelId };
		case 'removeLabel':
			return { ...action, labelId: rebindLabelId(action.labelId, labels, notes, 'removeLabel labelId') ?? action.labelId };
		case 'move':
			return { ...action, toListId: rebindListId(action.toListId, lists, notes, 'move toListId') ?? action.toListId };
		case 'createCard':
			return { ...action, listId: rebindListId(action.listId, lists, notes, 'createCard listId') ?? action.listId };
		default:
			return action;
	}
}

/**
 * Install a catalog template onto a board. CLONES the template into a NEW board-scoped,
 * enabled, non-template automation; best-effort rebinds any list/label references to the
 * target board by name and notes any that can't resolve. Idempotent per (boardId, seedKey).
 * Gated by `boards-manage-automations` (board-scoped).
 */
export async function installTemplate(uid: string, templateId: string, boardId: string): Promise<InstallTemplateResult> {
	if (!boardId) {
		throw new Meteor.Error('error-invalid-board', 'A target boardId is required', { method: 'boards.automations.templates.install' });
	}
	await assertManage(uid, boardId);

	const template = await BoardsAutomations.findOneById(templateId);
	if (!template || template.isTemplate !== true) {
		throw new Meteor.Error('error-template-not-found', 'Automation template not found', { method: 'boards.automations.templates.install' });
	}

	const board = await Boards.findOneById(boardId);
	if (!board) {
		throw new Meteor.Error('error-board-not-found', 'Board not found', { method: 'boards.automations.templates.install' });
	}

	// idempotency: a board-scoped clone of this template (same seedKey) already on the board.
	if (template.seedKey) {
		const existing = await BoardsAutomations.findOne({ boardId, seedKey: template.seedKey, isTemplate: { $ne: true } });
		if (existing) {
			return { automation: existing, alreadyInstalled: true, notes: [] };
		}
	}

	const lists = await BoardsLists.findByBoard(boardId).toArray();
	const labels = board.labelDefs ?? [];
	const notes: string[] = [];

	const now = new Date();
	const reboundTrigger = template.trigger
		? { ...template.trigger, ...(template.trigger.filters ? { filters: rebindFilters(template.trigger.filters, lists, labels, notes) } : {}) }
		: undefined;
	const reboundActions = (template.actions ?? []).map((a) => rebindAction(a, lists, labels, notes));

	// Clone into a board-scoped, enabled, NON-template automation. `seedKey` is carried for
	// the idempotency guard above; `isSystem`/`isTemplate` are intentionally dropped (this is
	// now a firm-owned copy). Rollups reset.
	const doc: Omit<IAutomation, '_id' | '_updatedAt'> = {
		name: template.name,
		...(template.description ? { description: template.description } : {}),
		boardId,
		scope: 'board',
		kind: template.kind,
		...(reboundTrigger ? { trigger: reboundTrigger } : {}),
		...(template.schedule ? { schedule: template.schedule } : {}),
		conditions: template.conditions ?? [],
		actions: reboundActions,
		...(template.sequence ? { sequence: template.sequence } : {}),
		...(template.icon ? { icon: template.icon } : {}),
		enabled: true,
		...(template.seedKey ? { seedKey: template.seedKey } : {}),
		runCount: 0,
		rev: 0,
		createdBy: uid,
		createdAt: now,
		updatedAt: now,
	};

	const { insertedId } = await BoardsAutomations.insertOne(doc);
	const automation = await BoardsAutomations.findOneById(insertedId);
	if (!automation) {
		throw new Meteor.Error('error-automation-not-found', 'Automation not found after install', { method: 'boards.automations.templates.install' });
	}

	try {
		await BoardsActivities.log({
			boardId,
			actor: uid,
			verb: 'field.changed',
			to: { automation: automation._id, name: automation.name, kind: automation.kind, action: 'installed', fromTemplate: template._id, ...(notes.length ? { unboundReferences: notes.length } : {}) },
			ts: new Date(),
		});
	} catch {
		// audit is best-effort.
	}

	return { automation, alreadyInstalled: false, notes };
}
