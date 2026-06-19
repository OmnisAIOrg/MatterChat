import type { IBoardActivity } from '@rocket.chat/core-typings';
import type { FindCursor, FindOptions } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsActivitiesModel extends IBaseModel<IBoardActivity> {
	/** Shared audit writer used by every Boards mutation (and by later milestones). */
	log(entry: Omit<IBoardActivity, '_id' | '_updatedAt'>): Promise<IBoardActivity['_id']>;
	findByCard(cardId: string, options?: FindOptions<IBoardActivity>): FindCursor<IBoardActivity>;
	findByBoard(boardId: string, options?: FindOptions<IBoardActivity>): FindCursor<IBoardActivity>;
}
