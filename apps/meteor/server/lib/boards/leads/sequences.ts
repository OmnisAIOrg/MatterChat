import type {
	ISequence,
	ISequenceEnrollment,
	ISequenceStep,
	SequenceStopCondition,
	SequenceStoppedReason,
	SequenceOffsetUnit,
	ILead,
} from '@rocket.chat/core-typings';
import { BoardsSequences, BoardsSequenceEnrollments, BoardsLeads, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../authorization/hasPermission';
import { sendTemplate } from './comms';
import { createTask } from './intakeTasks';

/**
 * Drip-sequence engine, leads-service driven (M6 — intake-lead-management.md §7).
 * For NOW the leads service drives sequences directly: enroll schedules step 0,
 * advance runs the due step (email/sms via a comm template, or create a task) and
 * schedules the next, and an enrollment auto-stops on its sequence's `stopOn`
 * conditions / a lead response / a status advance. The M7 automation engine will
 * later consume these SAME `boards_sequence_enrollments` (find those due at
 * `nextRunAt`) — so NO cron is added here (M7 owns scheduling).
 *
 * Mutation convention mirrors the leads service: model write → audit row.
 */

// ---------------------------------------------------------------------------
// Offset math
// ---------------------------------------------------------------------------

const UNIT_MS: Record<SequenceOffsetUnit, number> = {
	minutes: 60 * 1000,
	hours: 60 * 60 * 1000,
	days: 24 * 60 * 60 * 1000,
};

/** When the step at `index` should run, relative to `from`. */
function scheduleFor(steps: ISequenceStep[], index: number, from: Date): Date | null {
	const step = steps[index];
	if (!step) {
		return null;
	}
	return new Date(from.getTime() + (step.offset || 0) * UNIT_MS[step.offsetUnit]);
}

// ---------------------------------------------------------------------------
// Sequence read (the M7 engine + the UI both list these)
// ---------------------------------------------------------------------------

/** List enabled sequences (name order). Requires view permission. */
export async function listSequences(uid: string): Promise<ISequence[]> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.sequences.list' });
	}
	return BoardsSequences.findEnabled().toArray();
}

// ---------------------------------------------------------------------------
// enrollLead
// ---------------------------------------------------------------------------

export type EnrollLeadResult = { enrollment: ISequenceEnrollment; alreadyEnrolled: boolean };

/**
 * Enroll a lead into a sequence and schedule step 0 (`nextRunAt`). Re-enroll
 * guard: if the lead already has an active/paused enrollment in this sequence we
 * return it (unless the sequence allows re-enroll). Gated by sequences-manage.
 */
export async function enrollLead(uid: string, sequenceId: string, leadId: string): Promise<EnrollLeadResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-sequences-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.sequences.enroll' });
	}
	const sequence = await BoardsSequences.findOneById(sequenceId);
	if (!sequence || !sequence.enabled) {
		throw new Meteor.Error('error-sequence-not-found', 'Sequence not found or disabled', { method: 'boards.leads.sequences.enroll' });
	}
	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'boards.leads.sequences.enroll' });
	}

	const existing = await BoardsSequenceEnrollments.findOneActiveByLeadAndSequence(leadId, sequenceId);
	if (existing && !sequence.allowReenroll) {
		return { enrollment: existing, alreadyEnrolled: true };
	}

	const now = new Date();
	const nextRunAt = scheduleFor(sequence.steps, 0, now);
	const doc: Omit<ISequenceEnrollment, '_id' | '_updatedAt'> = {
		sequenceId,
		leadId,
		...(lead.boardId ? { boardId: lead.boardId } : {}),
		currentStep: 0,
		status: sequence.steps.length ? 'active' : 'completed',
		...(nextRunAt ? { nextRunAt } : {}),
		enrolledAt: now,
		enrolledBy: uid,
		...(sequence.steps.length ? {} : { completedAt: now }),
		rev: 0,
	};

	const { insertedId } = await BoardsSequenceEnrollments.insertOne(doc);
	const enrollment = await BoardsSequenceEnrollments.findOneById(insertedId);
	if (!enrollment) {
		throw new Meteor.Error('error-enrollment-not-found', 'Enrollment not found after create', {
			method: 'boards.leads.sequences.enroll',
		});
	}

	await logSeqActivity(uid, lead, { sequenceId, enrollmentId: insertedId, enrolled: true, nextRunAt });
	return { enrollment, alreadyEnrolled: false };
}

// ---------------------------------------------------------------------------
// advanceEnrollment (run the due step, schedule the next)
// ---------------------------------------------------------------------------

export type AdvanceEnrollmentResult = {
	enrollment: ISequenceEnrollment;
	/** what happened this tick. */
	action: 'ran-step' | 'completed' | 'stopped' | 'skipped';
	ranStep?: number;
	stoppedReason?: SequenceStoppedReason;
};

/**
 * Run the enrollment's due step and schedule the next. Steps:
 *   1. re-check the sequence's `stopOn` against the live lead — auto-stop if met,
 *   2. run the current step (email/sms via a comm template, or create a task),
 *   3. advance the cursor + schedule the next step's `nextRunAt`, or complete.
 *
 * Best-effort on the step action: a failed send/create does NOT abort the
 * enrollment — it advances so the drip keeps moving. Idempotency/locking against
 * double-runs is the M7 engine's concern; this is the per-enrollment step worker.
 */
export async function advanceEnrollment(uid: string, enrollmentId: string): Promise<AdvanceEnrollmentResult> {
	const enrollment = await BoardsSequenceEnrollments.findOneById(enrollmentId);
	if (!enrollment) {
		throw new Meteor.Error('error-enrollment-not-found', 'Enrollment not found', { method: 'boards.leads.sequences.advance' });
	}
	if (enrollment.status !== 'active') {
		return { enrollment, action: 'skipped' };
	}

	const sequence = await BoardsSequences.findOneById(enrollment.sequenceId);
	const lead = await BoardsLeads.findOneById(enrollment.leadId);
	if (!sequence || !lead) {
		await BoardsSequenceEnrollments.stop(enrollmentId, 'sequence-disabled', new Date());
		const stopped = (await BoardsSequenceEnrollments.findOneById(enrollmentId)) ?? enrollment;
		return { enrollment: stopped, action: 'stopped', stoppedReason: 'sequence-disabled' };
	}

	// 1. auto-stop check against the live lead.
	const stopReason = evaluateStop(sequence, lead, enrollment);
	if (!sequence.enabled || stopReason) {
		const reason: SequenceStoppedReason = sequence.enabled ? (stopReason as SequenceStoppedReason) : 'sequence-disabled';
		await BoardsSequenceEnrollments.stop(enrollmentId, reason, new Date());
		await logSeqActivity(uid, lead, { sequenceId: sequence._id, enrollmentId, stopped: reason });
		const stopped = (await BoardsSequenceEnrollments.findOneById(enrollmentId)) ?? enrollment;
		return { enrollment: stopped, action: 'stopped', stoppedReason: reason };
	}

	const stepIndex = enrollment.currentStep;
	const step = sequence.steps[stepIndex];
	const now = new Date();

	// 2. run the step (best-effort).
	if (step) {
		await runStep(uid, lead, step, enrollmentId).catch(() => undefined);
	}

	// 3. advance + schedule next, or complete.
	const nextIndex = stepIndex + 1;
	const nextRunAt = scheduleFor(sequence.steps, nextIndex, now);
	if (nextIndex >= sequence.steps.length || !nextRunAt) {
		await BoardsSequenceEnrollments.advanceStep(enrollmentId, nextIndex, null, now, stepIndex);
		await BoardsSequenceEnrollments.complete(enrollmentId, now);
		await logSeqActivity(uid, lead, { sequenceId: sequence._id, enrollmentId, completed: true });
		const done = (await BoardsSequenceEnrollments.findOneById(enrollmentId)) ?? enrollment;
		return { enrollment: done, action: 'completed', ranStep: stepIndex };
	}

	await BoardsSequenceEnrollments.advanceStep(enrollmentId, nextIndex, nextRunAt, now, stepIndex);
	const advanced = (await BoardsSequenceEnrollments.findOneById(enrollmentId)) ?? enrollment;
	return { enrollment: advanced, action: 'ran-step', ranStep: stepIndex };
}

/** Run one sequence step against a lead (email/sms template, or task creation). */
async function runStep(uid: string, lead: ILead, step: ISequenceStep, enrollmentId: string): Promise<void> {
	if ((step.action === 'email' || step.action === 'sms') && step.templateId) {
		await sendTemplate(uid, lead._id, step.templateId);
		return;
	}
	if (step.action === 'task') {
		await createTask(uid, {
			leadId: lead._id,
			title: step.taskTitle || 'Sequence follow-up',
			...(step.body ? { description: step.body } : {}),
			autoCreatedBy: 'sequence',
			sequenceEnrollmentId: enrollmentId,
		});
	}
	// email/sms steps with an inline body but no template are a no-op for now
	// (delivery is the P3 provider seam); the cursor still advances.
}

/**
 * Evaluate the sequence's stop conditions against the lead's current state.
 * Returns the matched stop condition, or undefined to keep running.
 *
 * `lead-responds` keys off `lastInboundAt` (an INBOUND comm) — NOT `lastContactedAt`,
 * which `recordContact` also bumps on the drip's own outbound sends (that bug self-
 * stopped a sequence right after its first message). We additionally require the
 * inbound to land AFTER the enrollment's most recent activity (`lastRunAt`, else
 * `enrolledAt`) so a stale pre-enrollment reply doesn't stop a freshly-started drip.
 */
function evaluateStop(sequence: ISequence, lead: ILead, enrollment: ISequenceEnrollment): SequenceStopCondition | undefined {
	for (const cond of sequence.stopOn ?? []) {
		if (cond === 'converted' && (lead.convertedAt || lead.convertedMatterId)) {
			return 'converted';
		}
		if (cond === 'lost' && lead.lostAt) {
			return 'lost';
		}
		if (cond === 'qualified' && lead.qualification?.qualified === true) {
			return 'qualified';
		}
		if (cond === 'lead-responds' && respondedAfterEnrollment(lead, enrollment)) {
			return 'lead-responds';
		}
		// 'status-advances' is detected at the status-change seam (stopForLeadEvent);
		// here it only fires defensively when the lead already left the start column.
		if (cond === 'status-advances' && (lead.convertedAt || lead.lostAt)) {
			return 'status-advances';
		}
	}
	return undefined;
}

/**
 * True when the lead has an INBOUND comm (`lastInboundAt`) recorded at/after the
 * enrollment's last activity — the genuine "lead responded" signal. The service-
 * level stop (`stopSequencesForLead('lead-responds')`, fired from `logCommunication`
 * only on `direction:'in'`) already handles the live case; this is the defensive
 * re-check the per-step worker runs against the live lead.
 */
function respondedAfterEnrollment(lead: ILead, enrollment: ISequenceEnrollment): boolean {
	if (!lead.lastInboundAt) {
		return false;
	}
	const since = enrollment.lastRunAt ?? enrollment.enrolledAt;
	return new Date(lead.lastInboundAt).getTime() >= new Date(since).getTime();
}

// ---------------------------------------------------------------------------
// Event seam: stop a lead's running drips when it responds / advances / exits
// ---------------------------------------------------------------------------

/**
 * Stop every active/paused enrollment for a lead with a reason. Called from the
 * leads service when a lead responds (inbound comm), advances status, qualifies,
 * converts, or is lost — so a drip never keeps firing after the lead moved on.
 * Best-effort + idempotent (no-op if the lead has no live enrollments).
 */
export async function stopSequencesForLead(leadId: string, reason: SequenceStoppedReason): Promise<void> {
	await BoardsSequenceEnrollments.stopAllForLead(leadId, reason, new Date());
}

/** Audit a sequence event onto the lead card. */
async function logSeqActivity(uid: string, lead: ILead, to: Record<string, unknown>): Promise<void> {
	if (!lead.boardId) {
		return;
	}
	await BoardsActivities.log({
		boardId: lead.boardId,
		...(lead.cardId ? { cardId: lead.cardId } : {}),
		actor: uid,
		verb: 'field.changed',
		to: { sequence: true, ...to },
		ts: new Date(),
	});
}
