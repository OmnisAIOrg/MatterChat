import type { IBoardSubscription, IBoardSubscriptionTarget, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsSubscriptionsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsSubscriptionsRaw extends BaseRaw<IBoardSubscription> implements IBoardsSubscriptionsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IBoardSubscription>>) {
		super(db, 'boards_subscriptions', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			// one watch per (user, target) — upsertWatch keys on this
			{ key: { userId: 1, 'target.kind': 1, 'target.id': 1 }, unique: true },
			// watcher fan-out scans
			{ key: { 'target.kind': 1, 'target.id': 1, 'archived': 1 } },
			{ key: { boardId: 1, 'target.kind': 1, 'archived': 1 } },
		];
	}

	public findByUser(userId: string, options?: FindOptions<IBoardSubscription>): FindCursor<IBoardSubscription> {
		return this.find({ userId, archived: { $ne: true } }, options);
	}

	public findWatchersOfCard(cardId: string, options?: FindOptions<IBoardSubscription>): FindCursor<IBoardSubscription> {
		return this.find({ 'target.kind': 'card', 'target.id': cardId, 'archived': { $ne: true } }, options);
	}

	public findWatchersOfBoard(boardId: string, options?: FindOptions<IBoardSubscription>): FindCursor<IBoardSubscription> {
		return this.find({ boardId, 'target.kind': 'board', 'archived': { $ne: true } }, options);
	}

	public upsertWatch(
		userId: string,
		target: IBoardSubscriptionTarget,
		boardId: string,
		events?: IBoardSubscription['events'],
	): Promise<UpdateResult> {
		const now = new Date();
		// Match (and, on insert, identify) the row by the dotted key paths — the
		// same fields the unique index covers. The immutable identity (userId +
		// target.{kind,id}) is written via $setOnInsert using the SAME dotted
		// paths the filter matches, so there is no parent-vs-leaf path conflict
		// with the mutable $set fields (boardId / events / archived).
		return this.updateOne(
			{ 'userId': userId, 'target.kind': target.kind, 'target.id': target.id },
			{
				$set: {
					boardId,
					// null = all events; only set when explicitly provided
					...(events !== undefined ? { events } : {}),
					archived: false,
				},
				$setOnInsert: {
					'userId': userId,
					'target.kind': target.kind,
					'target.id': target.id,
					'createdAt': now,
					'rev': 1,
				},
			},
			{ upsert: true },
		);
	}

	public removeWatch(userId: string, target: IBoardSubscriptionTarget): Promise<DeleteResult> {
		return this.deleteOne({ 'userId': userId, 'target.kind': target.kind, 'target.id': target.id });
	}
}
