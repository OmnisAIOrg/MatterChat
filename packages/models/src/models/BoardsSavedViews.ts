import type { ISavedView, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsSavedViewsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsSavedViewsRaw extends BaseRaw<ISavedView> implements IBoardsSavedViewsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<ISavedView>>) {
		super(db, 'boards_saved_views', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { userId: 1, boardId: 1, archived: 1 } },
			{ key: { boardId: 1, shared: 1, archived: 1 } },
			{ key: { boardId: 1, isDefault: 1 }, sparse: true },
		];
	}

	public findForUserAndBoard(userId: string, boardId: string, options?: FindOptions<ISavedView>): FindCursor<ISavedView> {
		// the user's own views on this board OR any view shared to the board
		return this.find(
			{ boardId, 'archived': { $ne: true }, '$or': [{ userId }, { shared: true }] },
			{ sort: { name: 1 }, ...options },
		);
	}

	public findShared(boardId: string, options?: FindOptions<ISavedView>): FindCursor<ISavedView> {
		return this.find({ boardId, shared: true, archived: { $ne: true } }, { sort: { name: 1 }, ...options });
	}

	public findById(viewId: string, options?: FindOptions<ISavedView>): Promise<ISavedView | null> {
		return this.findOne({ _id: viewId }, options);
	}

	public async upsert(
		view: Partial<ISavedView> & Pick<ISavedView, 'userId' | 'name' | 'viewType' | 'scope' | 'config'>,
		viewId?: string,
	): Promise<ISavedView> {
		if (viewId) {
			const { _id, userId, createdAt, createdBy, rev, ...rest } = view;
			const updated = await this.findOneAndUpdate(
				{ _id: viewId },
				{ $set: rest, $inc: { rev: 1 } },
				{ returnDocument: 'after' },
			);
			if (!updated) {
				throw new Error('saved-view-not-found');
			}
			return updated;
		}

		const now = new Date();
		const doc: Omit<ISavedView, '_id' | '_updatedAt'> = {
			userId: view.userId,
			...(view.boardId !== undefined ? { boardId: view.boardId } : {}),
			scope: view.scope,
			name: view.name,
			viewType: view.viewType,
			config: view.config,
			...(view.shared !== undefined ? { shared: view.shared } : {}),
			...(view.isDefault !== undefined ? { isDefault: view.isDefault } : {}),
			archived: false,
			rev: 1,
			...(view.createdBy !== undefined ? { createdBy: view.createdBy } : {}),
			createdAt: now,
		};
		const { insertedId } = await this.insertOne(doc);
		return { _id: insertedId, _updatedAt: now, ...doc };
	}

	public remove(viewId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: viewId }, { $set: { archived: true }, $inc: { rev: 1 } });
	}
}
