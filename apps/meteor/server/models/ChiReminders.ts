import { Random } from '@rocket.chat/random';
import type { Collection, IndexDescription } from 'mongodb';

import { db } from '../database/utils';
import { SystemLogger } from '../lib/logger/system';

/**
 * Chi reminders (`chi_reminders`) — a fork-owned, self-contained MatterChat collection.
 *
 * Like FirmFeed, this deliberately does NOT go through the shared
 * `@rocket.chat/models` registerModel/proxify machinery, which would require
 * edits to the packages/models and packages/model-typings barrels plus
 * server/models.ts. Wrapping the raw `db` keeps the whole feature additive and
 * inside our own files, per docs/design/MATTERCHAT-UI-CUSTOMIZATION-GUIDE.md.
 */

const COLLECTION_NAME = 'chi_reminders';

export type ChiReminderKind = 'timer' | 'no-reply';

export type IChiReminder = {
	_id: string;
	userId: string;
	kind: ChiReminderKind;
	note: string;
	dueAt: Date;
	createdAt: Date;
	/** Room the reminder was set from, when it was set on a message. */
	rid?: string;
	roomLabel?: string;
	messageId?: string;
	/**
	 * For `no-reply` follow-ups: the reminder cancels itself if a message newer
	 * than this arrives in the room from anyone but the person who set it.
	 */
	watchSince?: Date;
	/** Set when delivered or self-cancelled, so the sweep never repeats one. */
	resolvedAt?: Date;
	resolution?: 'fired' | 'cancelled' | 'condition-met';
};

const INDEXES: IndexDescription[] = [
	// The sweep query: everything due and not yet resolved.
	{ key: { resolvedAt: 1, dueAt: 1 } },
	// The per-user list.
	{ key: { userId: 1, resolvedAt: 1, dueAt: 1 } },
];

const collection: Collection<IChiReminder> = db.collection<IChiReminder>(COLLECTION_NAME);

let indexesEnsured = false;
const ensureIndexes = (): void => {
	if (indexesEnsured) {
		return;
	}
	indexesEnsured = true;
	collection.createIndexes(INDEXES).catch((err) => {
		SystemLogger.warn({ msg: 'ChiReminders: failed to ensure indexes', err });
	});
};
ensureIndexes();

export type ChiReminderCreateInput = Omit<IChiReminder, '_id' | 'createdAt' | 'resolvedAt' | 'resolution'>;

export const ChiReminders = {
	col: collection,

	async create(input: ChiReminderCreateInput): Promise<IChiReminder> {
		const doc: IChiReminder = { _id: Random.id(), createdAt: new Date(), ...input };
		await collection.insertOne(doc);
		return doc;
	},

	/** A user's pending reminders, soonest first. */
	async listPending(userId: string, limit = 25): Promise<IChiReminder[]> {
		return collection
			.find({ userId, resolvedAt: { $exists: false } }, { sort: { dueAt: 1 }, limit })
			.toArray();
	},

	async findPendingById(userId: string, id: string): Promise<IChiReminder | null> {
		return collection.findOne({ _id: id, userId, resolvedAt: { $exists: false } });
	},

	/**
	 * Claim a due reminder for delivery.
	 *
	 * A guarded findOneAndUpdate rather than find-then-update: two app instances
	 * run this cron, and without the guard a user gets every reminder twice.
	 */
	async claimDue(now: Date): Promise<IChiReminder | null> {
		const result = await collection.findOneAndUpdate(
			{ resolvedAt: { $exists: false }, dueAt: { $lte: now } },
			{ $set: { resolvedAt: now, resolution: 'fired' } },
			{ sort: { dueAt: 1 }, returnDocument: 'before' },
		);
		return result ?? null;
	},

	async resolve(id: string, resolution: IChiReminder['resolution']): Promise<void> {
		await collection.updateOne({ _id: id, resolvedAt: { $exists: false } }, { $set: { resolvedAt: new Date(), resolution } });
	},

	async cancel(userId: string, id: string): Promise<boolean> {
		const result = await collection.updateOne(
			{ _id: id, userId, resolvedAt: { $exists: false } },
			{ $set: { resolvedAt: new Date(), resolution: 'cancelled' } },
		);
		return result.modifiedCount > 0;
	},

	async cancelAll(userId: string): Promise<number> {
		const result = await collection.updateMany(
			{ userId, resolvedAt: { $exists: false } },
			{ $set: { resolvedAt: new Date(), resolution: 'cancelled' } },
		);
		return result.modifiedCount;
	},

	async countPending(userId: string): Promise<number> {
		return collection.countDocuments({ userId, resolvedAt: { $exists: false } });
	},
};
