import type { IPlaybookTemplate, PlaybookPipelineType, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsPlaybooksModel } from '@rocket.chat/model-typings';
import { escapeRegExp } from '@rocket.chat/string-helpers';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsPlaybooksRaw extends BaseRaw<IPlaybookTemplate> implements IBoardsPlaybooksModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IPlaybookTemplate>>) {
		super(db, 'boards_playbooks', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { pipelineType: 1, enabled: 1 } },
			{ key: { pipelineType: 1, stageKey: 1, enabled: 1 }, sparse: true },
			{ key: { boardId: 1, enabled: 1 }, sparse: true },
			{ key: { caseTypeId: 1 }, sparse: true },
		];
	}

	public findByPipeline(
		pipelineType: PlaybookPipelineType,
		options?: FindOptions<IPlaybookTemplate>,
	): FindCursor<IPlaybookTemplate> {
		return this.find({ pipelineType, enabled: true }, { sort: { name: 1 }, ...options });
	}

	public findByStageKey(
		pipelineType: PlaybookPipelineType,
		stageKey: string,
		options?: FindOptions<IPlaybookTemplate>,
	): FindCursor<IPlaybookTemplate> {
		return this.find({ pipelineType, stageKey, enabled: true }, options);
	}

	public findByListName(
		pipelineType: PlaybookPipelineType,
		listName: string,
		options?: FindOptions<IPlaybookTemplate>,
	): FindCursor<IPlaybookTemplate> {
		return this.find(
			{ pipelineType, enabled: true, listName: { $regex: new RegExp(`^${escapeRegExp(listName)}$`, 'i') } },
			options,
		);
	}

	public findEnabledForBoard(boardId: string, options?: FindOptions<IPlaybookTemplate>): FindCursor<IPlaybookTemplate> {
		return this.find(
			{ enabled: true, appliesOnEnter: true, $or: [{ boardId }, { boardId: { $exists: false } }] },
			options,
		);
	}

	public updatePlaybook(playbookId: string, patch: Partial<IPlaybookTemplate>, updatedBy?: string): Promise<UpdateResult> {
		const { _id, ...rest } = patch as Partial<IPlaybookTemplate> & { _id?: string };
		return this.updateOne(
			{ _id: playbookId },
			{
				$set: { ...rest, ...(updatedBy !== undefined ? { updatedBy } : {}), updatedAt: new Date() },
				$inc: { rev: 1 },
			},
		);
	}

	public setEnabled(playbookId: string, enabled: boolean): Promise<UpdateResult> {
		return this.updateOne({ _id: playbookId }, { $set: { enabled, updatedAt: new Date() }, $inc: { rev: 1 } });
	}

	public removePlaybook(playbookId: string): Promise<DeleteResult> {
		return this.removeById(playbookId);
	}
}
