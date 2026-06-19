import type { IAutomationRun } from '@rocket.chat/core-typings';
import type { IBoardsAutomationRunsModel } from '@rocket.chat/model-typings';
import type { Db, DeleteResult, FindCursor, FindOptions, IndexDescription } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsAutomationRunsRaw extends BaseRaw<IAutomationRun> implements IBoardsAutomationRunsModel {
	constructor(db: Db) {
		// append-only execution journal: no trash collection (db-only, retention-pruned)
		super(db, 'boards_automation_runs', undefined, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { automationId: 1, startedAt: -1 } },
			{ key: { boardId: 1, startedAt: -1 }, sparse: true },
			{ key: { cardId: 1, startedAt: -1 }, sparse: true },
			{ key: { startedAt: 1 } }, // retention prune scan
		];
	}

	public async logRun(entry: Omit<IAutomationRun, '_id' | '_updatedAt'>): Promise<IAutomationRun['_id']> {
		const { insertedId } = await this.insertOne(entry);
		return insertedId;
	}

	public findByAutomation(automationId: string, options?: FindOptions<IAutomationRun>): FindCursor<IAutomationRun> {
		return this.find({ automationId }, { sort: { startedAt: -1 }, ...options });
	}

	public findByBoard(boardId: string, options?: FindOptions<IAutomationRun>): FindCursor<IAutomationRun> {
		return this.find({ boardId }, { sort: { startedAt: -1 }, ...options });
	}

	public findByCard(cardId: string, options?: FindOptions<IAutomationRun>): FindCursor<IAutomationRun> {
		return this.find({ cardId }, { sort: { startedAt: -1 }, ...options });
	}

	public pruneOlderThan(before: Date): Promise<DeleteResult> {
		return this.deleteMany({ startedAt: { $lt: before } });
	}

	public countByRootSince(boardId: string, since: Date): Promise<number> {
		return this.countDocuments({ boardId, startedAt: { $gte: since } });
	}
}
