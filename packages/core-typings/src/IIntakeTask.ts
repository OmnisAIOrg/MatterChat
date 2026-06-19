import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * SLA / cold-lead / sequence follow-up task on a lead (Tier 2, collection
 * `boards_intake_tasks`). Distinct from a matter playbook task: these are the
 * intake-side ticklers (intake-lead-management.md §6/§7) — a speed-to-lead
 * first-touch task auto-created on capture, a cold-lead re-engage task, or a
 * `task`-action step materialized by a drip sequence — plus any manually
 * created intake follow-up.
 *
 * `autoCreatedBy` records the origin: 'sla' (speed-to-lead), 'cold' (aging
 * detection), 'sequence' (a drip step), or a user id for a hand-created task.
 */

export type IntakeTaskOrigin = 'sla' | 'cold' | 'sequence';

export interface IIntakeTask extends IRocketChatRecord {
	leadId: string; // -> ILead._id
	boardId?: string; // denormalized for board scoping
	title: string;
	description?: string;
	dueAt?: Date;
	assigneeId?: IUser['_id']; // intake specialist; defaults to the lead owner
	done: boolean;
	doneAt?: Date;
	doneBy?: IUser['_id'];

	/** Origin: an auto-rule key, or the user id that hand-created it. */
	autoCreatedBy?: IntakeTaskOrigin | IUser['_id'];
	/** When autoCreatedBy === 'sequence', the enrollment that spawned this task. */
	sequenceEnrollmentId?: string;

	createdBy?: IUser['_id'] | 'system';
	createdAt: Date;
}
