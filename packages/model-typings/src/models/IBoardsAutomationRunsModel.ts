import type { IAutomationRun } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsAutomationRunsModel extends IBaseModel<IAutomationRun> {
	/** Append a finished (or dry-run) execution record; returns its _id. */
	logRun(entry: Omit<IAutomationRun, '_id' | '_updatedAt'>): Promise<IAutomationRun['_id']>;

	/** Run-log for one automation, newest first. */
	findByAutomation(automationId: string, options?: FindOptions<IAutomationRun>): FindCursor<IAutomationRun>;

	/** Board-wide run-log (the Activity audit view), newest first. */
	findByBoard(boardId: string, options?: FindOptions<IAutomationRun>): FindCursor<IAutomationRun>;

	/** Runs touching a given card, newest first. */
	findByCard(cardId: string, options?: FindOptions<IAutomationRun>): FindCursor<IAutomationRun>;

	/** Retention prune (driven by Boards_Automation_Run_Retention_Days). */
	pruneOlderThan(before: Date): Promise<DeleteResult>;

	/** Per-card cascade accounting for the loop guard within one root run. */
	countByRootSince(boardId: string, since: Date): Promise<number>;
}
