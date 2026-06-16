import type { ISequence, SequenceTrigger } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsSequencesModel extends IBaseModel<ISequence> {
	/** Enabled sequences, name order. */
	findEnabled(options?: FindOptions<ISequence>): FindCursor<ISequence>;

	/** Enabled sequences armed by a given trigger (e.g. all 'lead-created' drips). */
	findByTrigger(trigger: SequenceTrigger, options?: FindOptions<ISequence>): FindCursor<ISequence>;

	/** Enabled status-change sequences armed when a lead enters statusId. */
	findByTriggerStatus(statusId: string, options?: FindOptions<ISequence>): FindCursor<ISequence>;

	updateSequence(sequenceId: string, patch: Partial<ISequence>, updatedBy?: string): Promise<UpdateResult>;
	setEnabled(sequenceId: string, enabled: boolean): Promise<UpdateResult>;
	removeSequence(sequenceId: string): Promise<DeleteResult>;
}
