import type { AnyBulkWriteOperation, Collection, Filter, IndexDescription } from 'mongodb';

import { db } from '../database/utils';
import type { AccessFilter } from '../lib/chi/search/searchHelpers';
import { SystemLogger } from '../lib/logger/system';

/**
 * Chi search index (`chi_search_index`) — a fork-owned, self-contained MatterChat collection.
 *
 * Like FirmFeed and ChiReminders this deliberately does NOT go through the shared
 * `@rocket.chat/models` registerModel/proxify machinery, which would require edits to the
 * packages/models + packages/model-typings barrels and server/models.ts. Wrapping the raw
 * `db` keeps the whole feature additive and inside our own files, per
 * docs/design/MATTERCHAT-UI-CUSTOMIZATION-GUIDE.md.
 *
 * ## Firm scoping is a property of the STORAGE, not of the caller
 *
 * Every row carries the firm that owns it and the room it came from, and every read goes
 * through `findScoped`, which will not run without an `AccessFilter`. There is deliberately
 * no "find all passages" method to reach for: the only way to read this collection is with a
 * firm and a room set already bound to the query. That is the difference between a retrieval
 * system that is scoped and one that merely remembers to filter.
 *
 * ## Vectors live here, brute-force scoring happens in the app
 *
 * Mongo Atlas Vector Search is not available on a self-hosted MatterChat, so `findScoped`
 * returns a BOUNDED candidate set (newest first) and the cosine ranking runs in-process. At
 * a few thousand passages per firm that is single-digit milliseconds; past that it wants a
 * real vector index, and the honest place to change it is this one method.
 */

const COLLECTION_NAME = 'chi_search_index';

export type IChiSearchIndexEntry = {
	/** Deterministic: `${rid}:${anchorMessageId}:${part}` — re-indexing a range upserts in place. */
	_id: string;
	rid: string;
	/** Owning firm (`team._id` / `customFields.firmId`). `null` = belongs to no single firm. */
	firmId: string | null;
	/** Every message that contributed to this passage, in order. */
	messageIds: string[];
	text: string;
	/** Absent when the passage was stored before an embedding provider was configured. */
	embedding?: number[];
	/** Model that produced `embedding` — vectors from different models must not be compared. */
	embeddingModel?: string;
	/** Timestamp of the passage's first message; the chronological key. */
	ts: Date;
	/** Timestamp of the passage's last message; the incremental-indexing watermark. */
	endTs: Date;
	updatedAt: Date;
};

const INDEXES: IndexDescription[] = [
	// The retrieval query: firm first (the isolation layer), then room, then recency.
	{ key: { firmId: 1, rid: 1, ts: -1 } },
	// The incremental-index watermark lookup ("what is the newest passage in this room?").
	{ key: { rid: 1, endTs: -1 } },
	// Housekeeping: re-embed / prune sweeps.
	{ key: { updatedAt: -1 } },
	// Unindexing a deleted message: find the passage(s) that quoted it.
	{ key: { messageIds: 1 } },
];

const collection: Collection<IChiSearchIndexEntry> = db.collection<IChiSearchIndexEntry>(COLLECTION_NAME);

let indexesEnsured = false;
const ensureIndexes = (): void => {
	if (indexesEnsured) {
		return;
	}
	indexesEnsured = true;
	// Fire-and-forget; index creation must never block a request or crash boot.
	collection.createIndexes(INDEXES).catch((err) => {
		SystemLogger.warn({ msg: 'ChiSearchIndex: failed to ensure indexes', err });
	});
};
ensureIndexes();

export type ChiSearchIndexUpsert = Omit<IChiSearchIndexEntry, '_id' | 'updatedAt'> & { part: number; anchorId: string };

/** The deterministic row id — the reason re-running the indexer never duplicates a passage. */
export const searchIndexId = (rid: string, anchorMessageId: string, part: number): string => `${rid}:${anchorMessageId}:${part}`;

export type ScopedFindOptions = {
	/** Hard cap on candidates loaded into memory for scoring (default 500). */
	limit?: number;
	/** Narrow further to specific rooms — always INTERSECTED with the filter, never replacing it. */
	rids?: string[];
	/** Keyword pre-filter applied inside Mongo (used when no embedding provider is configured). */
	textMatch?: RegExp;
	/** Only rows that actually carry a vector. */
	requireEmbedding?: boolean;
};

export const DEFAULT_CANDIDATE_LIMIT = 500;

export const ChiSearchIndex = {
	col: collection,

	/**
	 * The ONLY read path. Takes the pre-built two-layer access filter and intersects any extra
	 * narrowing on top of it, so no caller can accidentally widen the scope: `rids` shrinks the
	 * room set, it never replaces it.
	 */
	async findScoped(filter: AccessFilter, options: ScopedFindOptions = {}): Promise<IChiSearchIndexEntry[]> {
		const allowed = filter.rid.$in;
		const rids = options.rids?.length ? allowed.filter((rid) => options.rids?.includes(rid)) : allowed;
		if (!rids.length) {
			return [];
		}
		const query: Record<string, unknown> = { firmId: filter.firmId, rid: { $in: rids } };
		if (options.textMatch) {
			query.text = options.textMatch;
		}
		if (options.requireEmbedding) {
			query.embedding = { $exists: true };
		}
		return collection
			.find(query as Filter<IChiSearchIndexEntry>, { sort: { ts: -1 }, limit: Math.max(1, options.limit ?? DEFAULT_CANDIDATE_LIMIT) })
			.toArray();
	},

	/** Idempotent write of a batch of passages for one room. */
	async upsertMany(entries: ChiSearchIndexUpsert[]): Promise<number> {
		if (!entries.length) {
			return 0;
		}
		const now = new Date();
		const ops: AnyBulkWriteOperation<IChiSearchIndexEntry>[] = entries.map((entry) => {
			const { part, anchorId, ...doc } = entry;
			return {
				updateOne: {
					filter: { _id: searchIndexId(entry.rid, anchorId, part) },
					update: { $set: { ...doc, updatedAt: now } },
					upsert: true,
				},
			};
		});
		const result = await collection.bulkWrite(ops, { ordered: false });
		return result.upsertedCount + result.modifiedCount;
	},

	/**
	 * The incremental watermark: the newest message timestamp already indexed for a room.
	 * `undefined` means the room has never been indexed (so the caller does a full pass).
	 */
	async latestIndexedTs(rid: string): Promise<Date | undefined> {
		const newest = await collection.findOne({ rid }, { sort: { endTs: -1 }, projection: { endTs: 1 } });
		return newest?.endTs;
	},

	async countForRoom(rid: string): Promise<number> {
		return collection.countDocuments({ rid });
	},

	async countForFirm(firmId: string | null): Promise<number> {
		return collection.countDocuments({ firmId });
	},

	async total(): Promise<number> {
		return collection.estimatedDocumentCount();
	},

	/** Drop a room's passages — used when a room is deleted or is re-indexed from scratch. */
	async removeRoom(rid: string): Promise<number> {
		const result = await collection.deleteMany({ rid });
		return result.deletedCount || 0;
	},

	/**
	 * Drop every passage a message contributed to — called when a message is deleted.
	 *
	 * Passages bundle several consecutive messages, so this takes the neighbours with it. That
	 * over-deletion is intentional: the alternative is re-chunking the passage without the
	 * deleted text, and until that runs Chi could cite a message that no longer exists.
	 */
	async removeByMessageId(messageId: string): Promise<number> {
		const result = await collection.deleteMany({ messageIds: messageId });
		return result.deletedCount || 0;
	},
};
