import type { IAutomation, BoardAutomationTriggerEvent, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsAutomationsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsAutomationsRaw extends BaseRaw<IAutomation> implements IBoardsAutomationsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IAutomation>>) {
		super(db, 'boards_automations', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { boardId: 1, kind: 1, enabled: 1 } },
			{ key: { boardId: 1, 'trigger.event': 1, enabled: 1 } }, // hot path for rule dispatch
			{ key: { kind: 1, enabled: 1 } }, // scheduled scan
			{ key: { seedKey: 1 }, sparse: true },
		];
	}

	public findEnabledRulesForEvent(boardId: string, event: BoardAutomationTriggerEvent): FindCursor<IAutomation> {
		// board-scoped rules OR global rules (boardId unset), both enabled, for this event.
		// `isTemplate` catalog entries are EXCLUDED — they're installed/cloned onto a board, never fired directly.
		return this.find({
			kind: 'rule',
			enabled: true,
			isTemplate: { $ne: true },
			'trigger.event': event,
			$or: [{ boardId }, { boardId: { $exists: false } }, { scope: 'global' }],
		});
	}

	public findEnabledScheduled(options?: FindOptions<IAutomation>): FindCursor<IAutomation> {
		// exclude `isTemplate` catalog entries: a global scheduled template must not sweep every board.
		return this.find({ kind: 'scheduled', enabled: true, isTemplate: { $ne: true } }, options);
	}

	public findTemplates(options?: FindOptions<IAutomation>): FindCursor<IAutomation> {
		return this.find({ isTemplate: true }, { sort: { name: 1 }, ...options });
	}

	public findOneTemplateBySeedKey(seedKey: string): Promise<IAutomation | null> {
		return this.findOne({ seedKey, isTemplate: true });
	}

	public findButtonsForBoard(boardId: string, options?: FindOptions<IAutomation>): FindCursor<IAutomation> {
		return this.find(
			{ boardId, kind: { $in: ['card-button', 'board-button'] }, enabled: true },
			{ sort: { name: 1 }, ...options },
		);
	}

	public findByBoard(boardId: string, options?: FindOptions<IAutomation>): FindCursor<IAutomation> {
		return this.find({ boardId }, { sort: { name: 1 }, ...options });
	}

	public findSequenceById(id: string): Promise<IAutomation | null> {
		return this.findOne({ _id: id, kind: 'sequence' });
	}

	public findOneBySeedKey(seedKey: string): Promise<IAutomation | null> {
		return this.findOne({ seedKey });
	}

	public updateAutomation(id: string, patch: Partial<IAutomation>, updatedBy?: string): Promise<UpdateResult> {
		const { _id, ...rest } = patch as Partial<IAutomation> & { _id?: string };
		return this.updateOne(
			{ _id: id },
			{
				$set: { ...rest, ...(updatedBy !== undefined ? { updatedBy } : {}), updatedAt: new Date() },
				$inc: { rev: 1 },
			},
		);
	}

	public setEnabled(id: string, enabled: boolean): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { enabled, updatedAt: new Date() }, $inc: { rev: 1 } });
	}

	public incRunCount(id: string, at: Date): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { lastRunAt: at }, $inc: { runCount: 1, rev: 1 } });
	}

	public setError(id: string, message: string, at: Date): Promise<UpdateResult> {
		return this.updateOne({ _id: id }, { $set: { lastError: message, lastErrorAt: at }, $inc: { rev: 1 } });
	}

	public removeAutomation(id: string): Promise<DeleteResult> {
		return this.removeById(id);
	}
}
