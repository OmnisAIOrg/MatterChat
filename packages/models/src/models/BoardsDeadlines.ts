import type {
	IBoardDeadline,
	BoardDeadlineKind,
	BoardDeadlineStatus,
	RocketChatRecordDeleted,
} from '@rocket.chat/core-typings';
import type { IBoardsDeadlinesModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

const OPEN_STATUSES: BoardDeadlineStatus[] = ['open', 'acknowledged'];

export class BoardsDeadlinesRaw extends BaseRaw<IBoardDeadline> implements IBoardsDeadlinesModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IBoardDeadline>>) {
		super(db, 'boards_deadlines', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { cardId: 1, status: 1 } },
			{ key: { cardId: 1, kind: 1, status: 1 } },
			{ key: { boardId: 1, status: 1, dueDate: 1 } },
			{ key: { matterId: 1 }, sparse: true },
			{ key: { status: 1, dueDate: 1 } },
			{ key: { nextReminderAt: 1 }, sparse: true },
			{ key: { highRisk: 1, acknowledged: 1, status: 1 } },
		];
	}

	public findByCard(cardId: string, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline> {
		return this.find({ cardId, status: { $in: OPEN_STATUSES } }, { sort: { dueDate: 1 }, ...options });
	}

	public findByBoard(boardId: string, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline> {
		return this.find({ boardId, status: { $in: OPEN_STATUSES } }, { sort: { dueDate: 1 }, ...options });
	}

	public findByMatter(matterId: string, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline> {
		return this.find({ matterId, status: { $in: OPEN_STATUSES } }, { sort: { dueDate: 1 }, ...options });
	}

	public findByStatus(status: BoardDeadlineStatus, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline> {
		return this.find({ status }, { sort: { dueDate: 1 }, ...options });
	}

	public findOneOpenByCardAndKind(cardId: string, kind: BoardDeadlineKind): Promise<IBoardDeadline | null> {
		return this.findOne({ cardId, kind, status: { $in: OPEN_STATUSES } });
	}

	public findDueBefore(before: Date, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline> {
		return this.find(
			{ dueDate: { $lte: before }, status: { $in: OPEN_STATUSES } },
			{ sort: { dueDate: 1 }, ...options },
		);
	}

	public findRemindersDue(now: Date, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline> {
		return this.find(
			{ nextReminderAt: { $lte: now }, status: { $in: OPEN_STATUSES } },
			{ sort: { nextReminderAt: 1 }, ...options },
		);
	}

	public findUnacknowledgedHighRisk(options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline> {
		return this.find(
			{ highRisk: true, acknowledged: { $ne: true }, status: { $in: OPEN_STATUSES } },
			{ sort: { dueDate: 1 }, ...options },
		);
	}

	public acknowledge(deadlineId: string, userId: string): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: deadlineId },
			{
				$set: { acknowledged: true, acknowledgedAt: new Date(), acknowledgedBy: userId, status: 'acknowledged' },
				$inc: { rev: 1 },
			},
		);
	}

	public setStatus(deadlineId: string, status: BoardDeadlineStatus): Promise<UpdateResult> {
		const now = new Date();
		return this.updateOne(
			{ _id: deadlineId },
			{
				$set: { status, ...(status === 'satisfied' ? { satisfiedAt: now } : {}) },
				$inc: { rev: 1 },
			},
		);
	}

	public setDueDate(
		deadlineId: string,
		dueDate: Date,
		computedFrom: IBoardDeadline['computedFrom'],
	): Promise<UpdateResult> {
		return this.updateOne({ _id: deadlineId }, { $set: { dueDate, computedFrom }, $inc: { rev: 1 } });
	}

	public bumpEscalation(
		deadlineId: string,
		level: number,
		notifiedAt: Date,
		nextReminderAt?: Date,
	): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: deadlineId },
			{
				$set: {
					escalationLevel: level,
					lastNotifiedAt: notifiedAt,
					...(nextReminderAt !== undefined ? { nextReminderAt } : {}),
				},
				$inc: { rev: 1 },
			},
		);
	}

	public removeDeadline(deadlineId: string): Promise<DeleteResult> {
		return this.removeById(deadlineId);
	}

	public removeByCard(cardId: string): Promise<DeleteResult> {
		return this.deleteMany({ cardId });
	}
}
