import type { ICommTemplate, CommTemplateChannel, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsCommTemplatesModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsCommTemplatesRaw extends BaseRaw<ICommTemplate> implements IBoardsCommTemplatesModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<ICommTemplate>>) {
		super(db, 'boards_comm_templates', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { channel: 1, name: 1 } },
			{ key: { practiceArea: 1 }, sparse: true },
		];
	}

	public findAllTemplates(options?: FindOptions<ICommTemplate>): FindCursor<ICommTemplate> {
		return this.find({}, { sort: { name: 1 }, ...options });
	}

	public findByChannel(channel: CommTemplateChannel, options?: FindOptions<ICommTemplate>): FindCursor<ICommTemplate> {
		return this.find({ channel }, { sort: { name: 1 }, ...options });
	}

	public findByPracticeArea(practiceArea: string, options?: FindOptions<ICommTemplate>): FindCursor<ICommTemplate> {
		// scoped templates plus the unscoped (firm-wide) ones
		return this.find({ $or: [{ practiceArea }, { practiceArea: { $exists: false } }] }, { sort: { name: 1 }, ...options });
	}

	public updateTemplate(templateId: string, patch: Partial<ICommTemplate>, updatedBy?: string): Promise<UpdateResult> {
		const { _id, ...rest } = patch as Partial<ICommTemplate> & { _id?: string };
		return this.updateOne(
			{ _id: templateId },
			{ $set: { ...rest, ...(updatedBy ? { updatedBy } : {}), updatedAt: new Date() }, $inc: { rev: 1 } },
		);
	}

	public removeTemplate(templateId: string): Promise<DeleteResult> {
		return this.removeById(templateId);
	}
}
