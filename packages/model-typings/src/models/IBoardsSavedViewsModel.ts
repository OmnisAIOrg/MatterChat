import type { ISavedView } from '@rocket.chat/core-typings';
import type { FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsSavedViewsModel extends IBaseModel<ISavedView> {
	/** Views a user can pick on a board: their own + any shared on that board. */
	findForUserAndBoard(userId: string, boardId: string, options?: FindOptions<ISavedView>): FindCursor<ISavedView>;

	/** Shared views on a board (visible to the whole board team). */
	findShared(boardId: string, options?: FindOptions<ISavedView>): FindCursor<ISavedView>;

	/** Single view by id (the switcher hydrates the selected config). */
	findById(viewId: string, options?: FindOptions<ISavedView>): Promise<ISavedView | null>;

	/**
	 * Create or update a saved view. When `viewId` is omitted a new doc is
	 * inserted; otherwise the named config is replaced ($set + $inc rev).
	 */
	upsert(
		view: Partial<ISavedView> & Pick<ISavedView, 'userId' | 'name' | 'viewType' | 'scope' | 'config'>,
		viewId?: string,
	): Promise<ISavedView>;

	/** Soft-archive a saved view. */
	remove(viewId: string): Promise<UpdateResult>;
}
