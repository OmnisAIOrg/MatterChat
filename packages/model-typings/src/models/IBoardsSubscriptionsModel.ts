import type { IBoardSubscription, IBoardSubscriptionTarget } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsSubscriptionsModel extends IBaseModel<IBoardSubscription> {
	/** A user's watches (the "things I follow" list). */
	findByUser(userId: string, options?: FindOptions<IBoardSubscription>): FindCursor<IBoardSubscription>;

	/** Watchers of a specific card — the per-event fan-out seam. */
	findWatchersOfCard(cardId: string, options?: FindOptions<IBoardSubscription>): FindCursor<IBoardSubscription>;

	/** Watchers of a whole board (board-level subscriptions). */
	findWatchersOfBoard(boardId: string, options?: FindOptions<IBoardSubscription>): FindCursor<IBoardSubscription>;

	/**
	 * Idempotent watch: upsert the (userId, target) pair, set/refresh `events`
	 * and `boardId`. Returns the upsert result (use the matched/upserted id).
	 */
	upsertWatch(
		userId: string,
		target: IBoardSubscriptionTarget,
		boardId: string,
		events?: IBoardSubscription['events'],
	): Promise<UpdateResult>;

	/** Drop a watch (hard remove — subscriptions are cheap to recreate). */
	removeWatch(userId: string, target: IBoardSubscriptionTarget): Promise<DeleteResult>;
}
