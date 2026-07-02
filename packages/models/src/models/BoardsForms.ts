import type { IBoardForm, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsFormsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

/**
 * Per-board intake forms (`boards_forms`) — the generic form builder whose public
 * submissions become cards. The `slug` unique index backs the unguessable public URL
 * (43-char Random.secret()); resolution by slug is the hot path of the two
 * unauthenticated routes, so it must stay indexed.
 */
export class BoardsFormsRaw extends BaseRaw<IBoardForm> implements IBoardsFormsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IBoardForm>>) {
		super(db, 'boards_forms', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [{ key: { slug: 1 }, unique: true }, { key: { boardId: 1, archived: 1 } }];
	}

	public findByBoard(boardId: string, options?: FindOptions<IBoardForm>): FindCursor<IBoardForm> {
		return this.find({ boardId, archived: { $ne: true } }, { sort: { createdAt: 1 }, ...options });
	}

	public findById(formId: string, options?: FindOptions<IBoardForm>): Promise<IBoardForm | null> {
		return this.findOne({ _id: formId }, options);
	}

	public findOneActiveBySlug(slug: string, options?: FindOptions<IBoardForm>): Promise<IBoardForm | null> {
		return this.findOne({ slug, archived: { $ne: true } }, options);
	}

	public updateForm(formId: string, patch: Partial<IBoardForm>): Promise<UpdateResult> {
		// never allow identity/counter fields through a patch
		const { _id, _updatedAt, boardId, slug, createdBy, createdAt, rev, submissionCount, lastSubmissionAt, ...rest } = patch;
		return this.updateOne({ _id: formId }, { $set: rest, $inc: { rev: 1 } });
	}

	public softDelete(formId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: formId }, { $set: { archived: true }, $inc: { rev: 1 } });
	}

	public recordSubmission(formId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: formId }, { $inc: { submissionCount: 1, rev: 1 }, $set: { lastSubmissionAt: new Date() } });
	}
}
