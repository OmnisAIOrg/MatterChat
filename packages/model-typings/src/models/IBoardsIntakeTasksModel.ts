import type { IIntakeTask } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsIntakeTasksModel extends IBaseModel<IIntakeTask> {
	/** Open + done tasks on a lead, due soonest first. */
	findByLead(leadId: string, options?: FindOptions<IIntakeTask>): FindCursor<IIntakeTask>;

	/** Open tasks assigned to a user (the intake worklist). */
	findOpenByAssignee(assigneeId: string, options?: FindOptions<IIntakeTask>): FindCursor<IIntakeTask>;

	/** The tickler scan: open tasks due before `before`. */
	findOpenDueBefore(before: Date, options?: FindOptions<IIntakeTask>): FindCursor<IIntakeTask>;

	/** Dedupe guard: an existing open auto-task of an origin on a lead (e.g. one SLA task). */
	findOneOpenByLeadAndOrigin(leadId: string, origin: IIntakeTask['autoCreatedBy']): Promise<IIntakeTask | null>;

	markDone(taskId: string, byUserId: string, at: Date): Promise<UpdateResult>;
	updateTask(taskId: string, patch: Partial<IIntakeTask>): Promise<UpdateResult>;
	removeTask(taskId: string): Promise<DeleteResult>;
	removeByLead(leadId: string): Promise<DeleteResult>;
}
