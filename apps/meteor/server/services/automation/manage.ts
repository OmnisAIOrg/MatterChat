import type { IAutomation, IAutomationRun, BoardAutomationKind, BoardAutomationScope } from '@rocket.chat/core-typings';
import { BoardsAutomations, BoardsAutomationRuns, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';
import type { Filter } from 'mongodb';

import { hasPermissionAsync } from '../../lib/authorization/hasPermission';

/**
 * Automation management service (M7). The CRUD + run surface the REST routes call. Every
 * mutation is permission-gated and audit-logged, mirroring the M1/M5/M6 service idiom
 * (assert permission → model write → BoardsActivities.log). The engine's RUN path lives in
 * the dispatcher (`runOne`); this module owns definitions + the read views.
 *
 * Permissions: `boards-manage-automations` (create/update/archive), `boards-run-automation`
 * (run a button), `boards-view-automation-runs` (the run-log). Where an automation is
 * board-scoped, the check is board-scoped too.
 */

async function assertManage(uid: string, boardId?: string): Promise<void> {
	if (!(await hasPermissionAsync(uid, 'boards-manage-automations', boardId))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.automations.manage' });
	}
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type ListAutomationsFilter = { boardId?: string; kind?: BoardAutomationKind; enabled?: boolean };

/** List automations (manager view). Board-scoped when `boardId` is given, else global+all. */
export async function listAutomations(
	uid: string,
	filter: ListAutomationsFilter,
	pagination: { offset: number; count: number },
): Promise<{ automations: IAutomation[]; total: number }> {
	if (!(await hasPermissionAsync(uid, 'boards-manage-automations', filter.boardId))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.automations.list' });
	}
	const query: Filter<IAutomation> = {};
	if (filter.boardId) {
		query.boardId = filter.boardId;
	}
	if (filter.kind) {
		query.kind = filter.kind;
	}
	if (filter.enabled !== undefined) {
		query.enabled = filter.enabled;
	}
	const cursor = BoardsAutomations.find(query, { sort: { name: 1 }, skip: pagination.offset, limit: pagination.count });
	const [automations, total] = await Promise.all([cursor.toArray(), BoardsAutomations.countDocuments(query)]);
	return { automations, total };
}

export async function getAutomation(uid: string, automationId: string): Promise<IAutomation> {
	const automation = await BoardsAutomations.findOneById(automationId);
	if (!automation) {
		throw new Meteor.Error('error-automation-not-found', 'Automation not found', { method: 'boards.automations.get' });
	}
	if (!(await hasPermissionAsync(uid, 'boards-manage-automations', automation.boardId))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.automations.get' });
	}
	return automation;
}

// ---------------------------------------------------------------------------
// Create / update / archive
// ---------------------------------------------------------------------------

export type CreateAutomationFields = Partial<Omit<IAutomation, '_id' | '_updatedAt' | 'createdAt' | 'updatedAt' | 'rev'>> & {
	name: string;
};

/**
 * Create an automation. Defaults `scope` from whether a `boardId` is present, `kind` to
 * 'rule', `enabled` to true, and seeds the rollup/rev fields. The trigger/conditions/
 * actions shapes are trusted from the validated wire body (the builder produces them).
 */
export async function createAutomation(uid: string, fields: CreateAutomationFields): Promise<IAutomation> {
	const name = fields.name?.trim();
	if (!name) {
		throw new Meteor.Error('error-invalid-automation-name', 'Invalid automation name', { method: 'boards.automations.create' });
	}
	await assertManage(uid, fields.boardId);

	const now = new Date();
	const scope: BoardAutomationScope = fields.scope ?? (fields.boardId ? 'board' : 'global');
	const kind: BoardAutomationKind = fields.kind ?? 'rule';

	const doc: Omit<IAutomation, '_id' | '_updatedAt'> = {
		name,
		...(fields.description ? { description: fields.description } : {}),
		...(fields.boardId ? { boardId: fields.boardId } : {}),
		scope,
		kind,
		...(fields.trigger ? { trigger: fields.trigger } : {}),
		...(fields.schedule ? { schedule: fields.schedule } : {}),
		conditions: fields.conditions ?? [],
		actions: fields.actions ?? [],
		...(fields.sequence ? { sequence: fields.sequence } : {}),
		...(fields.icon ? { icon: fields.icon } : {}),
		enabled: fields.enabled ?? true,
		...(fields.isSystem ? { isSystem: fields.isSystem } : {}),
		...(fields.seedKey ? { seedKey: fields.seedKey } : {}),
		runCount: 0,
		rev: 0,
		createdBy: uid,
		createdAt: now,
		updatedAt: now,
	};

	const { insertedId } = await BoardsAutomations.insertOne(doc);
	const automation = await BoardsAutomations.findOneById(insertedId);
	if (!automation) {
		throw new Meteor.Error('error-automation-not-found', 'Automation not found after create', { method: 'boards.automations.create' });
	}

	await auditAutomation(uid, automation, 'created');
	return automation;
}

/** Update an automation (name/enabled/trigger/conditions/actions/schedule/…). Bumps rev. */
export async function updateAutomation(uid: string, automationId: string, patch: Partial<IAutomation>): Promise<IAutomation> {
	const current = await BoardsAutomations.findOneById(automationId);
	if (!current) {
		throw new Meteor.Error('error-automation-not-found', 'Automation not found', { method: 'boards.automations.update' });
	}
	await assertManage(uid, current.boardId);

	// never let the wire patch clobber identity/rollup/audit fields.
	const PROTECTED: (keyof IAutomation | '_id')[] = ['_id', 'createdAt', 'createdBy', 'rev', 'runCount', 'lastRunAt', 'lastError', 'lastErrorAt'];
	const safe = Object.fromEntries(Object.entries(patch).filter(([k]) => !PROTECTED.includes(k as keyof IAutomation))) as Partial<IAutomation>;
	await BoardsAutomations.updateAutomation(automationId, safe, uid);

	const automation = await BoardsAutomations.findOneById(automationId);
	if (!automation) {
		throw new Meteor.Error('error-automation-not-found', 'Automation not found after update', { method: 'boards.automations.update' });
	}
	await auditAutomation(uid, automation, 'updated');
	return automation;
}

/** Archive (hard-remove) an automation. Definitions are trashed; run-log rows are retained. */
export async function archiveAutomation(uid: string, automationId: string): Promise<{ success: true }> {
	const current = await BoardsAutomations.findOneById(automationId);
	if (!current) {
		throw new Meteor.Error('error-automation-not-found', 'Automation not found', { method: 'boards.automations.archive' });
	}
	await assertManage(uid, current.boardId);

	await BoardsAutomations.removeAutomation(automationId);
	await auditAutomation(uid, current, 'archived');
	return { success: true };
}

// ---------------------------------------------------------------------------
// Run-log read
// ---------------------------------------------------------------------------

export type ListRunsFilter = { automationId?: string; boardId?: string; cardId?: string };

/** The run-log audit view. Gated by `boards-view-automation-runs` (board-scoped when known). */
export async function listRuns(
	uid: string,
	filter: ListRunsFilter,
	pagination: { offset: number; count: number },
): Promise<{ runs: IAutomationRun[]; total: number }> {
	if (!(await hasPermissionAsync(uid, 'boards-view-automation-runs', filter.boardId))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.automations.runs.list' });
	}
	const query: Filter<IAutomationRun> = {};
	if (filter.automationId) {
		query.automationId = filter.automationId;
	}
	if (filter.boardId) {
		query.boardId = filter.boardId;
	}
	if (filter.cardId) {
		query.cardId = filter.cardId;
	}
	const cursor = BoardsAutomationRuns.find(query, { sort: { startedAt: -1 }, skip: pagination.offset, limit: pagination.count });
	const [runs, total] = await Promise.all([cursor.toArray(), BoardsAutomationRuns.countDocuments(query)]);
	return { runs, total };
}

/** Append an automation-definition audit row to the board's activity feed. */
async function auditAutomation(uid: string, automation: IAutomation, verb: 'created' | 'updated' | 'archived'): Promise<void> {
	if (!automation.boardId) {
		return; // global automations have no board feed to write to.
	}
	try {
		await BoardsActivities.log({
			boardId: automation.boardId,
			actor: uid,
			verb: 'field.changed',
			to: { automation: automation._id, name: automation.name, kind: automation.kind, action: verb },
			ts: new Date(),
		});
	} catch {
		// audit is best-effort.
	}
}
