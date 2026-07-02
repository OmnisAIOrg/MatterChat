import type { IBoardForm } from '@rocket.chat/core-typings';
import type { FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsFormsModel extends IBaseModel<IBoardForm> {
	/** All non-archived forms on a board (the Forms management surface). */
	findByBoard(boardId: string, options?: FindOptions<IBoardForm>): FindCursor<IBoardForm>;

	/** Single form by id (authenticated CRUD paths). */
	findById(formId: string, options?: FindOptions<IBoardForm>): Promise<IBoardForm | null>;

	/**
	 * Resolve a form by its public slug, ignoring archived docs. The service layer
	 * additionally requires `enabled` — unknown, archived, and disabled must be
	 * indistinguishable to the public caller.
	 */
	findOneActiveBySlug(slug: string, options?: FindOptions<IBoardForm>): Promise<IBoardForm | null>;

	/** $set a partial patch + $inc rev. */
	updateForm(formId: string, patch: Partial<IBoardForm>): Promise<UpdateResult>;

	/** Soft-archive a form (kills its public link). */
	softDelete(formId: string): Promise<UpdateResult>;

	/** Bump submissionCount + lastSubmissionAt after a successful public submit. */
	recordSubmission(formId: string): Promise<UpdateResult>;
}
