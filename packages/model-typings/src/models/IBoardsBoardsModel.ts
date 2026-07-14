import type { IBoard, IBoardLabelDef, IBoardFieldDef, IBoardMember, BoardsPipelineType } from '@rocket.chat/core-typings';
import type { FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsBoardsModel extends IBaseModel<IBoard> {
	findByMember(userId: string, options?: FindOptions<IBoard>): FindCursor<IBoard>;
	findByTeam(teamId: string, options?: FindOptions<IBoard>): FindCursor<IBoard>;
	findByPipelineType(type: BoardsPipelineType, options?: FindOptions<IBoard>): FindCursor<IBoard>;
	findStarred(userId: string, options?: FindOptions<IBoard>): FindCursor<IBoard>;
	findOneByIdAndMember(boardId: string, userId: string): Promise<IBoard | null>;
	/** The board whose email-to-task intake is enabled and matches `token` (email-to-task routing). */
	findOneByEmailIntakeToken(token: string): Promise<IBoard | null>;

	setMember(boardId: string, member: IBoardMember): Promise<UpdateResult>;
	removeMember(boardId: string, userId: string): Promise<UpdateResult>;

	addLabelDef(boardId: string, label: IBoardLabelDef): Promise<UpdateResult>;
	updateLabelDef(boardId: string, labelId: string, patch: Partial<IBoardLabelDef>): Promise<UpdateResult>;
	removeLabelDef(boardId: string, labelId: string): Promise<UpdateResult>;

	addFieldDef(boardId: string, field: IBoardFieldDef): Promise<UpdateResult>;
	updateFieldDef(boardId: string, fieldId: string, patch: Partial<IBoardFieldDef>): Promise<UpdateResult>;
	removeFieldDef(boardId: string, fieldId: string): Promise<UpdateResult>;

	toggleStar(boardId: string, userId: string, starred: boolean): Promise<UpdateResult>;
	archiveBoard(boardId: string): Promise<UpdateResult>;
	bumpRev(boardId: string): Promise<UpdateResult>;

	/** Atomically allocates the next per-board card shortlink number via $inc. */
	nextCardNumber(boardId: string): Promise<number>;
}
