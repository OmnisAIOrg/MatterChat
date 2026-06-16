import type { IBoardList } from '@rocket.chat/core-typings';
import type { FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsListsModel extends IBaseModel<IBoardList> {
	findByBoard(boardId: string, options?: FindOptions<IBoardList>): FindCursor<IBoardList>;
	findOneByBoardAndStageId(boardId: string, stageId: string): Promise<IBoardList | null>;
	updatePosition(listId: string, position: number): Promise<UpdateResult>;
	archiveList(listId: string): Promise<UpdateResult>;
	archiveByBoard(boardId: string): Promise<UpdateResult>; // cascade on board archive
	maxPosition(boardId: string): Promise<number>;
}
