import type { IBoardDeadline, BoardDeadlineKind, BoardDeadlineStatus } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsDeadlinesModel extends IBaseModel<IBoardDeadline> {
	/** All open deadlines on a card, soonest first. */
	findByCard(cardId: string, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline>;

	/** All open deadlines on a board (for Calendar/Timeline), soonest first. */
	findByBoard(boardId: string, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline>;

	findByMatter(matterId: string, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline>;
	findByStatus(status: BoardDeadlineStatus, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline>;

	/** A card's open deadline of a given kind (e.g. the single SOL row), for upsert/refresh. */
	findOneOpenByCardAndKind(cardId: string, kind: BoardDeadlineKind): Promise<IBoardDeadline | null>;

	/** The tickler scan: open, not-yet-satisfied deadlines due before `before`. */
	findDueBefore(before: Date, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline>;

	/** Reminder fan-out scan: open deadlines whose nextReminderAt has passed. */
	findRemindersDue(now: Date, options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline>;

	/** Unacknowledged high-risk (SOL/filing) deadlines — the no-missed-SOL guardrail. */
	findUnacknowledgedHighRisk(options?: FindOptions<IBoardDeadline>): FindCursor<IBoardDeadline>;

	acknowledge(deadlineId: string, userId: string): Promise<UpdateResult>;
	setStatus(deadlineId: string, status: BoardDeadlineStatus): Promise<UpdateResult>;
	setDueDate(deadlineId: string, dueDate: Date, computedFrom: IBoardDeadline['computedFrom']): Promise<UpdateResult>;
	bumpEscalation(deadlineId: string, level: number, notifiedAt: Date, nextReminderAt?: Date): Promise<UpdateResult>;
	removeDeadline(deadlineId: string): Promise<DeleteResult>;
	removeByCard(cardId: string): Promise<DeleteResult>;
}
