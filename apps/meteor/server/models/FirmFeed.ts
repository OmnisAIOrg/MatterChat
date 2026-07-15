import type { IFirmFeedEntry, FirmFeedKind } from '@rocket.chat/core-typings';
import { Random } from '@rocket.chat/random';
import type { Collection, FindCursor, IndexDescription } from 'mongodb';

import { db } from '../database/utils';
import { SystemLogger } from '../lib/logger/system';

/**
 * Firm Feed model (`firm_feed`) — a fork-owned, self-contained MatterChat collection.
 *
 * Deliberately does NOT go through the shared `@rocket.chat/models` registerModel/proxify
 * machinery (which would require edits to the packages/models + packages/model-typings
 * barrels and server/models.ts). Instead it wraps the raw Mongo `db` directly so the
 * whole feature stays additive and confined to our own files — honoring the fork-safe
 * rule in docs/design/MATTERCHAT-UI-CUSTOMIZATION-GUIDE.md.
 *
 * Backs the admin-managed My Day bulletin (announcements / birthdays / shout-outs).
 */

const COLLECTION_NAME = 'firm_feed';

const INDEXES: IndexDescription[] = [
	{ key: { active: 1, pinned: -1, createdAt: -1 } },
	{ key: { kind: 1, active: 1 } },
	{ key: { eventDate: 1 } },
];

const collection: Collection<IFirmFeedEntry> = db.collection<IFirmFeedEntry>(COLLECTION_NAME);

let indexesEnsured = false;
const ensureIndexes = (): void => {
	if (indexesEnsured) {
		return;
	}
	indexesEnsured = true;
	// Fire-and-forget; index creation must never block a request.
	collection.createIndexes(INDEXES).catch((err) => {
		SystemLogger.warn({ msg: 'FirmFeed: failed to ensure indexes', err });
	});
};
// Ensure indexes as soon as the module is loaded at server startup.
ensureIndexes();

export type FirmFeedCreateInput = {
	kind: FirmFeedKind;
	title: string;
	body?: string;
	eventDate?: Date;
	pinned?: boolean;
	createdBy: IFirmFeedEntry['createdBy'];
};

export type FirmFeedUpdatePatch = {
	kind?: FirmFeedKind;
	title?: string;
	body?: string;
	eventDate?: Date | null;
	pinned?: boolean;
};

export const FirmFeed = {
	/** All active entries (soft-deleted excluded), pinned first then newest. */
	findActive(): FindCursor<IFirmFeedEntry> {
		return collection.find({ active: { $ne: false } }, { sort: { pinned: -1, createdAt: -1 } });
	},

	findOneById(id: string): Promise<IFirmFeedEntry | null> {
		return collection.findOne({ _id: id });
	},

	async create(input: FirmFeedCreateInput): Promise<IFirmFeedEntry> {
		const now = new Date();
		const doc: IFirmFeedEntry = {
			_id: Random.id(),
			kind: input.kind,
			title: input.title,
			...(input.body !== undefined ? { body: input.body } : {}),
			...(input.eventDate !== undefined ? { eventDate: input.eventDate } : {}),
			pinned: Boolean(input.pinned),
			active: true,
			createdBy: input.createdBy,
			createdAt: now,
			updatedAt: now,
			_updatedAt: now,
		};
		await collection.insertOne(doc);
		return doc;
	},

	async updateById(id: string, patch: FirmFeedUpdatePatch): Promise<IFirmFeedEntry | null> {
		const now = new Date();
		const set: Record<string, unknown> = { updatedAt: now, _updatedAt: now };
		const unset: Record<string, ''> = {};

		if (patch.kind !== undefined) {
			set.kind = patch.kind;
		}
		if (patch.title !== undefined) {
			set.title = patch.title;
		}
		if (patch.body !== undefined) {
			set.body = patch.body;
		}
		if (patch.pinned !== undefined) {
			set.pinned = patch.pinned;
		}
		if (patch.eventDate !== undefined) {
			if (patch.eventDate === null) {
				unset.eventDate = '';
			} else {
				set.eventDate = patch.eventDate;
			}
		}

		await collection.updateOne({ _id: id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
		return this.findOneById(id);
	},

	/** Soft-delete: hide from the feed without destroying the record. */
	async softDeleteById(id: string): Promise<boolean> {
		const res = await collection.updateOne({ _id: id }, { $set: { active: false, updatedAt: new Date(), _updatedAt: new Date() } });
		return res.matchedCount > 0;
	},
};
