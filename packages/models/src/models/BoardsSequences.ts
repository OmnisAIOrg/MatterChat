import type { ISequence, SequenceTrigger, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsSequencesModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsSequencesRaw extends BaseRaw<ISequence> implements IBoardsSequencesModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<ISequence>>) {
		super(db, 'boards_sequences', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { enabled: 1 } },
			{ key: { trigger: 1, enabled: 1 } },
			{ key: { triggerStatusId: 1, enabled: 1 }, sparse: true },
		];
	}

	public findEnabled(options?: FindOptions<ISequence>): FindCursor<ISequence> {
		return this.find({ enabled: true }, { sort: { name: 1 }, ...options });
	}

	public findByTrigger(trigger: SequenceTrigger, options?: FindOptions<ISequence>): FindCursor<ISequence> {
		return this.find({ trigger, enabled: true }, options);
	}

	public findByTriggerStatus(statusId: string, options?: FindOptions<ISequence>): FindCursor<ISequence> {
		return this.find({ trigger: 'status-changed', triggerStatusId: statusId, enabled: true }, options);
	}

	public updateSequence(sequenceId: string, patch: Partial<ISequence>, updatedBy?: string): Promise<UpdateResult> {
		const { _id, ...rest } = patch as Partial<ISequence> & { _id?: string };
		return this.updateOne(
			{ _id: sequenceId },
			{
				$set: { ...rest, ...(updatedBy !== undefined ? { updatedBy } : {}), updatedAt: new Date() },
				$inc: { rev: 1 },
			},
		);
	}

	public setEnabled(sequenceId: string, enabled: boolean): Promise<UpdateResult> {
		return this.updateOne({ _id: sequenceId }, { $set: { enabled, updatedAt: new Date() }, $inc: { rev: 1 } });
	}

	public removeSequence(sequenceId: string): Promise<DeleteResult> {
		return this.removeById(sequenceId);
	}
}
