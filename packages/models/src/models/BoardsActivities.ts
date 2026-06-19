import type { IBoardActivity } from '@rocket.chat/core-typings';
import type { IBoardsActivitiesModel } from '@rocket.chat/model-typings';
import type { Db, FindCursor, FindOptions, IndexDescription } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsActivitiesRaw extends BaseRaw<IBoardActivity> implements IBoardsActivitiesModel {
	constructor(db: Db) {
		// append-only audit: no trash collection
		super(db, 'boards_activities', undefined, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { boardId: 1, ts: -1 } },
			{ key: { cardId: 1, ts: -1 }, sparse: true },
		];
	}

	public async log(entry: Omit<IBoardActivity, '_id' | '_updatedAt'>): Promise<IBoardActivity['_id']> {
		const { insertedId } = await this.insertOne(entry);
		return insertedId;
	}

	public findByCard(cardId: string, options?: FindOptions<IBoardActivity>): FindCursor<IBoardActivity> {
		return this.find({ cardId }, { sort: { ts: -1 }, ...options });
	}

	public findByBoard(boardId: string, options?: FindOptions<IBoardActivity>): FindCursor<IBoardActivity> {
		return this.find({ boardId }, { sort: { ts: -1 }, ...options });
	}
}
