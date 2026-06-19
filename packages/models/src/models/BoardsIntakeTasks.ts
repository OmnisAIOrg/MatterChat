import type { IIntakeTask, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsIntakeTasksModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsIntakeTasksRaw extends BaseRaw<IIntakeTask> implements IBoardsIntakeTasksModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IIntakeTask>>) {
		super(db, 'boards_intake_tasks', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { leadId: 1, done: 1, dueAt: 1 } },
			{ key: { assigneeId: 1, done: 1, dueAt: 1 } },
			{ key: { done: 1, dueAt: 1 } },
		];
	}

	public findByLead(leadId: string, options?: FindOptions<IIntakeTask>): FindCursor<IIntakeTask> {
		return this.find({ leadId }, { sort: { dueAt: 1 }, ...options });
	}

	public findOpenByAssignee(assigneeId: string, options?: FindOptions<IIntakeTask>): FindCursor<IIntakeTask> {
		return this.find({ assigneeId, done: { $ne: true } }, { sort: { dueAt: 1 }, ...options });
	}

	public findOpenDueBefore(before: Date, options?: FindOptions<IIntakeTask>): FindCursor<IIntakeTask> {
		return this.find({ done: { $ne: true }, dueAt: { $lte: before } }, { sort: { dueAt: 1 }, ...options });
	}

	public findOneOpenByLeadAndOrigin(leadId: string, origin: IIntakeTask['autoCreatedBy']): Promise<IIntakeTask | null> {
		return this.findOne({ leadId, autoCreatedBy: origin, done: { $ne: true } });
	}

	public markDone(taskId: string, byUserId: string, at: Date): Promise<UpdateResult> {
		return this.updateOne({ _id: taskId }, { $set: { done: true, doneAt: at, doneBy: byUserId } });
	}

	public updateTask(taskId: string, patch: Partial<IIntakeTask>): Promise<UpdateResult> {
		const { _id, ...rest } = patch as Partial<IIntakeTask> & { _id?: string };
		return this.updateOne({ _id: taskId }, { $set: rest });
	}

	public removeTask(taskId: string): Promise<DeleteResult> {
		return this.removeById(taskId);
	}

	public removeByLead(leadId: string): Promise<DeleteResult> {
		return this.deleteMany({ leadId });
	}
}
