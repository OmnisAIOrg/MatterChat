import type { IBoardList, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsListsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsListsRaw extends BaseRaw<IBoardList> implements IBoardsListsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IBoardList>>) {
		super(db, 'boards_lists', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { boardId: 1, position: 1 } },
			{ key: { boardId: 1, caseproStageId: 1 }, sparse: true },
		];
	}

	public findByBoard(boardId: string, options?: FindOptions<IBoardList>): FindCursor<IBoardList> {
		return this.find({ boardId, archived: { $ne: true } }, { sort: { position: 1 }, ...options });
	}

	public findOneByBoardAndStageId(boardId: string, stageId: string): Promise<IBoardList | null> {
		return this.findOne({ boardId, caseproStageId: stageId });
	}

	public updatePosition(listId: string, position: number): Promise<UpdateResult> {
		return this.updateOne({ _id: listId }, { $set: { position }, $inc: { rev: 1 } });
	}

	public archiveList(listId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: listId }, { $set: { archived: true }, $inc: { rev: 1 } });
	}

	public archiveByBoard(boardId: string): Promise<UpdateResult> {
		return this.updateMany({ boardId }, { $set: { archived: true } }) as Promise<UpdateResult>;
	}

	public async maxPosition(boardId: string): Promise<number> {
		const list = await this.findOne<Pick<IBoardList, 'position'>>(
			{ boardId, archived: { $ne: true } },
			{ sort: { position: -1 }, projection: { position: 1 } },
		);
		return list?.position ?? 0;
	}
}
