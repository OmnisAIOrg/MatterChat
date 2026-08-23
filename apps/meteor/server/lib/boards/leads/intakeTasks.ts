import type { IIntakeTask, IntakeTaskOrigin, ILead } from '@rocket.chat/core-typings';
import { BoardsIntakeTasks, BoardsLeads, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { settings } from '../../../../app/settings/server';
import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';
import { firmScopedLeadFilter } from '../firmScope';

/**
 * Intake tasks: SLA / cold-lead / sequence follow-up ticklers (M6 —
 * intake-lead-management.md §6/§7). Three creators:
 *   - {@link createTask}            — manual or programmatic follow-up,
 *   - {@link createSpeedToLeadTask} — auto first-touch task on capture (SLA),
 *   - {@link detectColdLeads}       — sweep for un-contacted/aging leads -> task.
 *
 * Auto-creators are idempotent per (lead, origin) via
 * `findOneOpenByLeadAndOrigin`, so re-running capture or the cold sweep never
 * piles duplicate tasks. The M7 automation engine will later own the scheduled
 * cold sweep; here the function is callable directly (no cron added — M7 owns
 * cron). Every create audit-logs onto the lead card.
 */

// ---------------------------------------------------------------------------
// Tunables (settings-driven, with safe defaults)
// ---------------------------------------------------------------------------

/** Minutes after capture the speed-to-lead first-touch task is due. */
function speedToLeadMinutes(): number {
	try {
		const v = Number(settings.get('Boards_Leads_SpeedToLead_Minutes'));
		return Number.isFinite(v) && v > 0 ? v : 15;
	} catch {
		return 15;
	}
}

/** Days without contact after which a lead is considered cold. */
function coldLeadDays(): number {
	try {
		const v = Number(settings.get('Boards_Leads_Cold_Days'));
		return Number.isFinite(v) && v > 0 ? v : 3;
	} catch {
		return 3;
	}
}

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

export type CreateTaskFields = {
	leadId: string;
	title: string;
	description?: string;
	dueAt?: Date;
	assigneeId?: string;
	autoCreatedBy?: IntakeTaskOrigin;
	sequenceEnrollmentId?: string;
};

export type CreateTaskResult = { task: IIntakeTask };

/**
 * Create an intake task on a lead. `autoCreatedBy` distinguishes auto rules
 * ('sla'|'cold'|'sequence') from a hand-created task (we stamp the uid).
 * Requires comms permission (the intake-worklist capability) for manual creates.
 */
export async function createTask(uid: string, fields: CreateTaskFields): Promise<CreateTaskResult> {
	if (!fields.autoCreatedBy && !(await hasPermissionAsync(uid, 'boards-leads-comms'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.task.create' });
	}
	const lead = await BoardsLeads.findOneById(fields.leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'boards.leads.task.create' });
	}

	const now = new Date();
	const assigneeId = fields.assigneeId ?? lead.ownership?.ownerId;
	const doc: Omit<IIntakeTask, '_id' | '_updatedAt'> = {
		leadId: fields.leadId,
		...(lead.boardId ? { boardId: lead.boardId } : {}),
		title: fields.title,
		...(fields.description ? { description: fields.description } : {}),
		...(fields.dueAt ? { dueAt: fields.dueAt } : {}),
		...(assigneeId ? { assigneeId } : {}),
		done: false,
		autoCreatedBy: fields.autoCreatedBy ?? uid,
		...(fields.sequenceEnrollmentId ? { sequenceEnrollmentId: fields.sequenceEnrollmentId } : {}),
		createdBy: fields.autoCreatedBy ? 'system' : uid,
		createdAt: now,
	};

	const { insertedId } = await BoardsIntakeTasks.insertOne(doc);
	const task = await BoardsIntakeTasks.findOneById(insertedId);
	if (!task) {
		throw new Meteor.Error('error-intake-task-not-found', 'Task not found after create', { method: 'boards.leads.task.create' });
	}

	await logTaskActivity(uid, lead, { taskId: insertedId, title: fields.title, autoCreatedBy: doc.autoCreatedBy });
	return { task };
}

/** Mark a task done. Requires comms permission. */
export async function completeTask(uid: string, taskId: string): Promise<IIntakeTask> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-comms'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.task.complete' });
	}
	const task = await BoardsIntakeTasks.findOneById(taskId);
	if (!task) {
		throw new Meteor.Error('error-intake-task-not-found', 'Task not found', { method: 'boards.leads.task.complete' });
	}
	await BoardsIntakeTasks.markDone(taskId, uid, new Date());
	const fresh = await BoardsIntakeTasks.findOneById(taskId);
	if (!fresh) {
		throw new Meteor.Error('error-intake-task-not-found', 'Task not found', { method: 'boards.leads.task.complete' });
	}
	return fresh;
}

/** List a lead's tasks. Requires view permission. */
export async function listTasks(uid: string, leadId: string): Promise<IIntakeTask[]> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.task.list' });
	}
	return BoardsIntakeTasks.findByLead(leadId).toArray();
}

// ---------------------------------------------------------------------------
// Auto-task: speed-to-lead first touch (on capture)
// ---------------------------------------------------------------------------

/**
 * Auto-create the speed-to-lead first-touch task for a freshly-captured lead.
 * Idempotent: skips if an open 'sla' task already exists on the lead. Called by
 * the capture path (the leads service) — never blocks capture (swallow errors at
 * the call site). The due time is `capturedAt + SpeedToLead minutes`.
 */
export async function createSpeedToLeadTask(uid: string, lead: ILead): Promise<IIntakeTask | undefined> {
	const open = await BoardsIntakeTasks.findOneOpenByLeadAndOrigin(lead._id, 'sla');
	if (open) {
		return undefined;
	}
	const dueAt = new Date((lead.capturedAt ? new Date(lead.capturedAt).getTime() : Date.now()) + speedToLeadMinutes() * 60 * 1000);
	const name = lead.contact?.fullName || [lead.contact?.firstName, lead.contact?.lastName].filter(Boolean).join(' ').trim() || `Lead #${lead.refNo}`;
	const { task } = await createTask(uid, {
		leadId: lead._id,
		title: `First contact: ${name}`,
		description: 'Speed-to-lead SLA — make first contact within the target window.',
		dueAt,
		...(lead.ownership?.ownerId ? { assigneeId: lead.ownership.ownerId } : {}),
		autoCreatedBy: 'sla',
	});
	return task;
}

// ---------------------------------------------------------------------------
// Cold-lead detection (sweep)
// ---------------------------------------------------------------------------

export type DetectColdLeadsResult = { scanned: number; tasksCreated: number };

/**
 * Detect cold leads — open, owned, never-contacted-recently leads older than the
 * cold threshold — and create a re-engage 'cold' task on each (idempotent per
 * lead). Also stamps `coldSince` on the lead for the board chip. M7 will schedule
 * this; for now it is callable on demand (no cron added here).
 */
export async function detectColdLeads(uid: string, now: Date = new Date()): Promise<DetectColdLeadsResult> {
	const thresholdMs = coldLeadDays() * 24 * 60 * 60 * 1000;
	// scoped to the caller's own firm — this used to sweep every firm's leads
	const scope = await firmScopedLeadFilter(uid, 'boards.leads.detectColdLeads');
	const open = await BoardsLeads.find({ archived: { $ne: true }, ...scope }).toArray();

	let scanned = 0;
	let tasksCreated = 0;
	for (const lead of open) {
		if (lead.convertedAt || lead.lostAt) {
			continue;
		}
		scanned += 1;
		const lastTouch = lead.lastContactedAt ?? lead.capturedAt;
		if (!lastTouch) {
			continue;
		}
		const age = now.getTime() - new Date(lastTouch).getTime();
		if (age < thresholdMs) {
			continue;
		}

		// stamp coldSince once (the board chip reads this).
		if (!lead.coldSince) {
			await BoardsLeads.updateOne({ _id: lead._id }, { $set: { coldSince: now }, $inc: { rev: 1 } });
		}

		const existing = await BoardsIntakeTasks.findOneOpenByLeadAndOrigin(lead._id, 'cold');
		if (existing) {
			continue;
		}
		const name = lead.contact?.fullName || [lead.contact?.firstName, lead.contact?.lastName].filter(Boolean).join(' ').trim() || `Lead #${lead.refNo}`;
		await createTask(uid, {
			leadId: lead._id,
			title: `Re-engage cold lead: ${name}`,
			description: `No contact in ${coldLeadDays()}+ days. Attempt re-engagement or close out.`,
			dueAt: now,
			...(lead.ownership?.ownerId ? { assigneeId: lead.ownership.ownerId } : {}),
			autoCreatedBy: 'cold',
		});
		tasksCreated += 1;
	}

	return { scanned, tasksCreated };
}

/** Audit a task event onto the lead's card. */
async function logTaskActivity(uid: string, lead: ILead, to: Record<string, unknown>): Promise<void> {
	if (!lead.boardId) {
		return;
	}
	await BoardsActivities.log({
		boardId: lead.boardId,
		...(lead.cardId ? { cardId: lead.cardId } : {}),
		actor: uid,
		verb: 'field.changed',
		to: { intakeTask: true, ...to },
		ts: new Date(),
	});
}
