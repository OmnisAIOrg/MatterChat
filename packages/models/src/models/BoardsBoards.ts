import type { IBoard, IBoardLabelDef, IBoardFieldDef, IBoardMember, BoardsPipelineType, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsBoardsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsBoardsRaw extends BaseRaw<IBoard> implements IBoardsBoardsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IBoard>>) {
		super(db, 'boards_boards', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { 'members.userId': 1, 'archived': 1 } },
			{ key: { pipelineType: 1, archived: 1 } },
			{ key: { teamId: 1 }, sparse: true },
			{ key: { starredBy: 1 } },
		];
	}

	public findByMember(userId: string, options?: FindOptions<IBoard>): FindCursor<IBoard> {
		return this.find({ 'members.userId': userId, 'archived': { $ne: true } }, options);
	}

	public findByTeam(teamId: string, options?: FindOptions<IBoard>): FindCursor<IBoard> {
		return this.find({ teamId, archived: { $ne: true } }, options);
	}

	public findByPipelineType(type: BoardsPipelineType, options?: FindOptions<IBoard>): FindCursor<IBoard> {
		return this.find({ pipelineType: type, archived: { $ne: true } }, options);
	}

	public findStarred(userId: string, options?: FindOptions<IBoard>): FindCursor<IBoard> {
		return this.find({ starredBy: userId, archived: { $ne: true } }, options);
	}

	public findOneByIdAndMember(boardId: string, userId: string): Promise<IBoard | null> {
		return this.findOne({ '_id': boardId, 'members.userId': userId });
	}

	public findOneByEmailIntakeToken(token: string): Promise<IBoard | null> {
		return this.findOne({ 'emailIntake.token': token, 'emailIntake.enabled': true, 'archived': { $ne: true } });
	}

	public async setMember(boardId: string, member: IBoardMember): Promise<UpdateResult> {
		// remove any existing membership for this user, then add the (possibly re-roled) one
		await this.updateOne({ _id: boardId }, { $pull: { members: { userId: member.userId } } });
		return this.updateOne({ _id: boardId }, { $push: { members: member }, $inc: { rev: 1 } });
	}

	public removeMember(boardId: string, userId: string): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: boardId },
			{
				$pull: { members: { userId } },
				$inc: { rev: 1 },
			},
		);
	}

	public addLabelDef(boardId: string, label: IBoardLabelDef): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: boardId },
			{
				$push: { labelDefs: label },
				$inc: { rev: 1 },
			},
		);
	}

	public updateLabelDef(boardId: string, labelId: string, patch: Partial<IBoardLabelDef>): Promise<UpdateResult> {
		const $set: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(patch)) {
			if (key === 'id') {
				continue;
			}
			$set[`labelDefs.$.${key}`] = value;
		}
		return this.updateOne({ '_id': boardId, 'labelDefs.id': labelId }, { $set, $inc: { rev: 1 } });
	}

	public removeLabelDef(boardId: string, labelId: string): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: boardId },
			{
				$pull: { labelDefs: { id: labelId } },
				$inc: { rev: 1 },
			},
		);
	}

	public addFieldDef(boardId: string, field: IBoardFieldDef): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: boardId },
			{
				$push: { fieldDefs: field },
				$inc: { rev: 1 },
			},
		);
	}

	public updateFieldDef(boardId: string, fieldId: string, patch: Partial<IBoardFieldDef>): Promise<UpdateResult> {
		const $set: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(patch)) {
			if (key === 'id') {
				continue;
			}
			$set[`fieldDefs.$.${key}`] = value;
		}
		return this.updateOne({ '_id': boardId, 'fieldDefs.id': fieldId }, { $set, $inc: { rev: 1 } });
	}

	public removeFieldDef(boardId: string, fieldId: string): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: boardId },
			{
				$pull: { fieldDefs: { id: fieldId } },
				$inc: { rev: 1 },
			},
		);
	}

	public toggleStar(boardId: string, userId: string, starred: boolean): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: boardId },
			starred ? { $addToSet: { starredBy: userId } } : { $pull: { starredBy: userId } },
		);
	}

	public archiveBoard(boardId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: boardId }, { $set: { archived: true }, $inc: { rev: 1 } });
	}

	public bumpRev(boardId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: boardId }, { $inc: { rev: 1 } });
	}

	public async nextCardNumber(boardId: string): Promise<number> {
		const board = await this.findOneAndUpdate(
			{ _id: boardId },
			{ $inc: { cardCounter: 1 } },
			{ returnDocument: 'after', projection: { cardCounter: 1 } },
		);
		return board?.cardCounter ?? 1;
	}
}
