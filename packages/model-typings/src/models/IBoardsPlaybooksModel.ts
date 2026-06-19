import type { IPlaybookTemplate, PlaybookPipelineType } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsPlaybooksModel extends IBaseModel<IPlaybookTemplate> {
	/** All enabled playbooks for a pipeline, in name order. */
	findByPipeline(pipelineType: PlaybookPipelineType, options?: FindOptions<IPlaybookTemplate>): FindCursor<IPlaybookTemplate>;

	/** Enabled playbooks targeting a stable stage key (matter_stages.id / intake_stages.id). */
	findByStageKey(
		pipelineType: PlaybookPipelineType,
		stageKey: string,
		options?: FindOptions<IPlaybookTemplate>,
	): FindCursor<IPlaybookTemplate>;

	/** Enabled playbooks matching a column name (case-insensitive), the portable fallback. */
	findByListName(
		pipelineType: PlaybookPipelineType,
		listName: string,
		options?: FindOptions<IPlaybookTemplate>,
	): FindCursor<IPlaybookTemplate>;

	/** Enabled apply-on-enter playbooks for a board (board-scoped or unscoped). */
	findEnabledForBoard(boardId: string, options?: FindOptions<IPlaybookTemplate>): FindCursor<IPlaybookTemplate>;

	updatePlaybook(playbookId: string, patch: Partial<IPlaybookTemplate>, updatedBy?: string): Promise<UpdateResult>;
	setEnabled(playbookId: string, enabled: boolean): Promise<UpdateResult>;
	removePlaybook(playbookId: string): Promise<DeleteResult>;
}
