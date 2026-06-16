import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Drip sequence definition (Tier 2, collection `boards_sequences`) and a per-lead
 * enrollment (collection `boards_sequence_enrollments`). A sequence is an ordered
 * list of steps, each with a relative `offset` and an action (email/sms/task).
 * Enrolling a lead schedules step 0; each run advances the cursor and schedules
 * the next step. Sequences auto-stop when the lead responds or advances past a
 * configured exit (intake-lead-management.md §7).
 *
 * The automation engine (M7) consumes enrollments due at `nextRunAt`; until then
 * the leads service can drive these directly and emit board events.
 */

export type SequenceTrigger =
	| 'lead-created'
	| 'status-changed' // armed when a lead enters triggerStatusId
	| 'no-contact' // cold-lead nurture
	| 'manual'; // enrolled by a user

export type SequenceStepActionType = 'email' | 'sms' | 'task';

export type SequenceOffsetUnit = 'minutes' | 'hours' | 'days';

/** One step in a sequence; `offset` is relative to the previous step (or enroll for step 0). */
export interface ISequenceStep {
	id: string; // sequence-local id (nanoid)
	order: number;
	offset: number; // delay before this step fires
	offsetUnit: SequenceOffsetUnit;
	action: SequenceStepActionType;
	templateId?: string; // -> comm template for email/sms
	taskTitle?: string; // for action:'task'
	taskAssigneeRole?: 'owner' | 'attorney' | 'paralegal' | 'intake';
	subject?: string; // email subject override
	body?: string; // inline body when no templateId
}

export type SequenceStopCondition = 'lead-responds' | 'status-advances' | 'qualified' | 'converted' | 'lost';

export interface ISequence extends IRocketChatRecord {
	name: string;
	description?: string;
	trigger: SequenceTrigger;
	triggerStatusId?: string; // -> boards_lists._id, for trigger:'status-changed'
	caseTypeId?: string; // -> CasePro case_types.id (practice-area scoping)

	steps: ISequenceStep[];

	/** Conditions that auto-stop a running enrollment. */
	stopOn: SequenceStopCondition[];
	allowReenroll?: boolean;

	enabled: boolean;
	isSystem?: boolean;

	// denormalized rollups (recomputed):
	enrolledCount?: number;
	completedCount?: number;

	rev: number;
	createdBy?: IUser['_id'];
	createdAt: Date;
	updatedBy?: IUser['_id'];
	updatedAt: Date;
}

export type SequenceEnrollmentStatus = 'active' | 'paused' | 'completed' | 'stopped';

export type SequenceStoppedReason = SequenceStopCondition | 'all-steps-done' | 'manual-stop' | 'sequence-disabled';

/** A lead's run through a sequence; the engine processes those with nextRunAt <= now. */
export interface ISequenceEnrollment extends IRocketChatRecord {
	sequenceId: string; // -> ISequence._id
	leadId: string; // -> ILead._id
	boardId?: string; // denormalized for scoping

	currentStep: number; // index into ISequence.steps (next step to run)
	status: SequenceEnrollmentStatus;
	nextRunAt?: Date; // when the next step is due (unset when paused/done)

	enrolledAt: Date;
	enrolledBy?: IUser['_id'] | 'system';
	lastRunAt?: Date;
	lastStepRun?: number;
	completedAt?: Date;
	stoppedAt?: Date;
	stoppedReason?: SequenceStoppedReason;

	rev: number;
}
