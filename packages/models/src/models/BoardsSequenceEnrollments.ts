import type {
	ISequenceEnrollment,
	SequenceEnrollmentStatus,
	SequenceStoppedReason,
	RocketChatRecordDeleted,
} from '@rocket.chat/core-typings';
import type { IBoardsSequenceEnrollmentsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

const RUNNING_STATUSES: SequenceEnrollmentStatus[] = ['active', 'paused'];

export class BoardsSequenceEnrollmentsRaw extends BaseRaw<ISequenceEnrollment> implements IBoardsSequenceEnrollmentsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<ISequenceEnrollment>>) {
		super(db, 'boards_sequence_enrollments', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { leadId: 1, status: 1 } },
			{ key: { sequenceId: 1, status: 1 } },
			{ key: { status: 1, nextRunAt: 1 } },
			{ key: { leadId: 1, sequenceId: 1 } },
		];
	}

	public findByLead(leadId: string, options?: FindOptions<ISequenceEnrollment>): FindCursor<ISequenceEnrollment> {
		return this.find({ leadId }, { sort: { enrolledAt: -1 }, ...options });
	}

	public findBySequence(sequenceId: string, options?: FindOptions<ISequenceEnrollment>): FindCursor<ISequenceEnrollment> {
		return this.find({ sequenceId }, options);
	}

	public findByStatus(
		status: SequenceEnrollmentStatus,
		options?: FindOptions<ISequenceEnrollment>,
	): FindCursor<ISequenceEnrollment> {
		return this.find({ status }, options);
	}

	public findOneActiveByLeadAndSequence(leadId: string, sequenceId: string): Promise<ISequenceEnrollment | null> {
		return this.findOne({ leadId, sequenceId, status: { $in: RUNNING_STATUSES } });
	}

	public findDueToRun(now: Date, options?: FindOptions<ISequenceEnrollment>): FindCursor<ISequenceEnrollment> {
		return this.find(
			{ status: 'active', nextRunAt: { $lte: now } },
			{ sort: { nextRunAt: 1 }, ...options },
		);
	}

	public advanceStep(
		enrollmentId: string,
		nextStep: number,
		nextRunAt: Date | null,
		ranAt: Date,
		ranStep: number,
	): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: enrollmentId },
			{
				$set: {
					currentStep: nextStep,
					lastRunAt: ranAt,
					lastStepRun: ranStep,
					...(nextRunAt ? { nextRunAt } : {}),
				},
				...(nextRunAt ? {} : { $unset: { nextRunAt: '' as const } }),
				$inc: { rev: 1 },
			},
		);
	}

	public setStatus(enrollmentId: string, status: SequenceEnrollmentStatus): Promise<UpdateResult> {
		return this.updateOne({ _id: enrollmentId }, { $set: { status }, $inc: { rev: 1 } });
	}

	public stop(enrollmentId: string, reason: SequenceStoppedReason, at: Date): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: enrollmentId },
			{ $set: { status: 'stopped', stoppedReason: reason, stoppedAt: at }, $unset: { nextRunAt: '' }, $inc: { rev: 1 } },
		);
	}

	public complete(enrollmentId: string, at: Date): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: enrollmentId },
			{ $set: { status: 'completed', completedAt: at }, $unset: { nextRunAt: '' }, $inc: { rev: 1 } },
		);
	}

	public stopAllForLead(leadId: string, reason: SequenceStoppedReason, at: Date): Promise<UpdateResult> {
		return this.updateMany(
			{ leadId, status: { $in: RUNNING_STATUSES } },
			{ $set: { status: 'stopped', stoppedReason: reason, stoppedAt: at }, $unset: { nextRunAt: '' }, $inc: { rev: 1 } },
		) as Promise<UpdateResult>;
	}

	public removeEnrollment(enrollmentId: string): Promise<DeleteResult> {
		return this.removeById(enrollmentId);
	}
}
