import type { ISequenceEnrollment, SequenceEnrollmentStatus, SequenceStoppedReason } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsSequenceEnrollmentsModel extends IBaseModel<ISequenceEnrollment> {
	findByLead(leadId: string, options?: FindOptions<ISequenceEnrollment>): FindCursor<ISequenceEnrollment>;
	findBySequence(sequenceId: string, options?: FindOptions<ISequenceEnrollment>): FindCursor<ISequenceEnrollment>;
	findByStatus(status: SequenceEnrollmentStatus, options?: FindOptions<ISequenceEnrollment>): FindCursor<ISequenceEnrollment>;

	/** Re-enroll guard: an existing active/paused enrollment of this lead in this sequence. */
	findOneActiveByLeadAndSequence(leadId: string, sequenceId: string): Promise<ISequenceEnrollment | null>;

	/** The engine's work query: active enrollments whose nextRunAt has passed. */
	findDueToRun(now: Date, options?: FindOptions<ISequenceEnrollment>): FindCursor<ISequenceEnrollment>;

	/** Advance the cursor after a step runs and schedule the next run (or mark step ran). */
	advanceStep(enrollmentId: string, nextStep: number, nextRunAt: Date | null, ranAt: Date, ranStep: number): Promise<UpdateResult>;

	setStatus(enrollmentId: string, status: SequenceEnrollmentStatus): Promise<UpdateResult>;
	stop(enrollmentId: string, reason: SequenceStoppedReason, at: Date): Promise<UpdateResult>;
	complete(enrollmentId: string, at: Date): Promise<UpdateResult>;

	/** Stop every active/paused enrollment for a lead (e.g. lead responded/advanced). */
	stopAllForLead(leadId: string, reason: SequenceStoppedReason, at: Date): Promise<UpdateResult>;

	removeEnrollment(enrollmentId: string): Promise<DeleteResult>;
}
