import type { IAutomation, BoardAutomationTriggerEvent } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsAutomationsModel extends IBaseModel<IAutomation> {
	/** Hot path for rule dispatch: enabled `kind:'rule'` automations for a board (or global) on an event. */
	findEnabledRulesForEvent(boardId: string, event: BoardAutomationTriggerEvent): FindCursor<IAutomation>;

	/** All enabled `kind:'scheduled'` automations (the cron scans these every tick). */
	findEnabledScheduled(options?: FindOptions<IAutomation>): FindCursor<IAutomation>;

	/** Enabled card/board buttons for a board (rendered as click-to-run buttons). */
	findButtonsForBoard(boardId: string, options?: FindOptions<IAutomation>): FindCursor<IAutomation>;

	/** All automations on a board (manager view), optionally filtered by the caller. */
	findByBoard(boardId: string, options?: FindOptions<IAutomation>): FindCursor<IAutomation>;

	findSequenceById(id: string): Promise<IAutomation | null>;

	/** Idempotent prebuilt-template lookup (seed-once guard). */
	findOneBySeedKey(seedKey: string): Promise<IAutomation | null>;

	updateAutomation(id: string, patch: Partial<IAutomation>, updatedBy?: string): Promise<UpdateResult>;
	setEnabled(id: string, enabled: boolean): Promise<UpdateResult>;
	incRunCount(id: string, at: Date): Promise<UpdateResult>;
	setError(id: string, message: string, at: Date): Promise<UpdateResult>;
	removeAutomation(id: string): Promise<DeleteResult>;
}
