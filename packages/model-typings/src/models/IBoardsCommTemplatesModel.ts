import type { ICommTemplate, CommTemplateChannel } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsCommTemplatesModel extends IBaseModel<ICommTemplate> {
	/** All templates, name order. */
	findAllTemplates(options?: FindOptions<ICommTemplate>): FindCursor<ICommTemplate>;

	/** Templates for a given channel (email|sms). */
	findByChannel(channel: CommTemplateChannel, options?: FindOptions<ICommTemplate>): FindCursor<ICommTemplate>;

	/** Templates scoped to a practice-area name (plus the unscoped ones). */
	findByPracticeArea(practiceArea: string, options?: FindOptions<ICommTemplate>): FindCursor<ICommTemplate>;

	updateTemplate(templateId: string, patch: Partial<ICommTemplate>, updatedBy?: string): Promise<UpdateResult>;
	removeTemplate(templateId: string): Promise<DeleteResult>;
}
