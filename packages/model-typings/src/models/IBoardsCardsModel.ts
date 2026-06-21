import type { IBoardCard, IBoardCardLink, IMatterSnapshot, BoardsFieldValue, OmnisCardQuery } from '@rocket.chat/core-typings';
import type { FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsCardsModel extends IBaseModel<IBoardCard> {
	findByList(listId: string, options?: FindOptions<IBoardCard>): FindCursor<IBoardCard>;
	findByBoard(boardId: string, options?: FindOptions<IBoardCard>): FindCursor<IBoardCard>;
	findByAssignee(userId: string, options?: FindOptions<IBoardCard>): FindCursor<IBoardCard>;
	findDueBetween(from: Date, to: Date, boardId?: string): FindCursor<IBoardCard>;
	findByMatterId(matterId: string): FindCursor<IBoardCard>;
	findOneByLeadId(leadId: string): Promise<IBoardCard | null>;
	search(boardId: string, query: OmnisCardQuery): FindCursor<IBoardCard>;

	/** The drag-drop write: a single $set listId/position/subStatus + $inc rev. */
	move(cardId: string, listId: string, position: number, subStatus?: string): Promise<UpdateResult>;

	setFieldValue(cardId: string, fieldId: string, value: BoardsFieldValue): Promise<UpdateResult>;
	setLink(cardId: string, link: IBoardCardLink): Promise<UpdateResult>;
	refreshMatterSnapshot(cardId: string, snapshot: IMatterSnapshot): Promise<UpdateResult>;

	addLabel(cardId: string, labelId: string): Promise<UpdateResult>;
	removeLabel(cardId: string, labelId: string): Promise<UpdateResult>;

	archiveCard(cardId: string): Promise<UpdateResult>;
	archiveByList(listId: string): Promise<UpdateResult>; // cascade
	archiveByBoard(boardId: string): Promise<UpdateResult>; // cascade

	maxPosition(listId: string): Promise<number>;
	minPosition(listId: string): Promise<number>;
}
