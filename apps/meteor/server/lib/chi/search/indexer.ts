/**
 * MATTERCHAT: builds and refreshes the Chi "Ask Anything" passage index (F9).
 *
 * ## The one thing this file exists to get right
 *
 * A passage is written with the firm that owns it, decided HERE, once, at index time — not
 * inferred at query time from whoever is asking. `resolveRoomFirmId` is the only place that
 * decision is made, and it is deliberately conservative: a room whose firm cannot be
 * established beyond doubt is stamped `null` and is invisible to every firm-stamped user
 * unless an admin explicitly opts the workspace into shared rooms. The failure mode is a
 * missing answer, never somebody else's answer.
 *
 * `resolveScopedRooms` is the query-side twin: it produces the caller's firm plus the rooms
 * they are BOTH a member of and in-firm for. Both the semantic path and the keyword fallback
 * go through it, so there is exactly one definition of "what this person may retrieve".
 *
 * ## Who calls this
 *
 * Nothing here subscribes to anything itself — it is all pull. Three callers drive it, and all
 * three are additive, in our own files:
 *  - `server/lib/chi/search/startup.ts` — the afterSaveMessage hook, via a dirty-room queue, so
 *    new traffic is indexed within about a minute.
 *  - `server/cron/chiSearchIndexCron.ts` — a bounded periodic backfill that reaches history the
 *    hook never saw (and rooms the queue dropped at its ceiling).
 *  - `rebuild_search_index` — the admin Chi tool, for an explicit rebuild.
 */
import type { IMessage, IRoom, IUser } from '@rocket.chat/core-typings';
import { Messages, Rooms, Subscriptions, Users } from '@rocket.chat/models';

import type { EmbeddingConfig, EmbeddingFetch } from './embeddings';
import { embedTexts, getEmbeddingConfig } from './embeddings';
import type { ChunkMessage } from './searchHelpers';
import { chunkMessages, describeAttachments } from './searchHelpers';
import { ChiSearchIndex } from '../../../models/ChiSearchIndex';
import type { ChiSearchIndexUpsert } from '../../../models/ChiSearchIndex';
import { settings } from '../../../settings';
import { SystemLogger } from '../../logger/system';

/** Messages read in one indexing pass for one room. */
export const MAX_MESSAGES_PER_PASS = 400;

/** Rooms touched by one bounded backfill run. */
export const MAX_BACKFILL_ROOMS = 50;

/** Absolute ceiling on a single backfill, whatever the caller asks for. */
export const MAX_BACKFILL_ROOMS_HARD = 500;

type RoomFields = Pick<IRoom, '_id' | 'name' | 'fname' | 't' | 'teamId' | 'uids'>;

const ROOM_PROJECTION = { name: 1, fname: 1, t: 1, teamId: 1, uids: 1 };

const firmIdOf = (user: Pick<IUser, 'customFields'> | null | undefined): string | null => {
	const value = user?.customFields?.firmId;
	return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/** Whether an admin has opted the workspace into indexing/retrieving team-less rooms. */
export function includeSharedRooms(): boolean {
	try {
		return settings.get<boolean>('Chi_Search_Include_Shared_Rooms') === true;
	} catch {
		return false;
	}
}

/**
 * The firm that owns a room.
 *
 *  - A room inside a firm's Team carries `teamId`, and a firm IS a team — that is definitive.
 *  - A DM has no team, so it belongs to a firm only when every participant is in that same
 *    firm. A DM that crosses firms belongs to neither.
 *  - Everything else (workspace-wide public channels, ad-hoc groups) is `null`.
 *
 * `null` is not "unknown, allow it" — it is its own partition, and `buildAccessFilter`
 * excludes it from a firm-stamped caller's results by default.
 */
export async function resolveRoomFirmId(room: RoomFields): Promise<string | null> {
	if (typeof room.teamId === 'string' && room.teamId.trim()) {
		return room.teamId.trim();
	}
	if (room.t !== 'd' || !room.uids?.length) {
		return null;
	}
	const members = await Users.find<Pick<IUser, '_id' | 'customFields'>>(
		{ _id: { $in: room.uids } },
		{ projection: { customFields: 1 } },
	).toArray();
	if (members.length !== room.uids.length) {
		return null;
	}
	const firms = new Set(members.map((member) => firmIdOf(member)));
	const only = firms.size === 1 ? [...firms][0] : null;
	return only;
}

export type ScopedRoom = {
	rid: string;
	/** ROUTING name — what a permalink needs. */
	name: string;
	/** DISPLAY name. */
	fname?: string;
	t: string;
	firmId: string | null;
};

export type ScopedRooms = {
	/** The caller's own firm; `null` for an unstamped user. */
	firmId: string | null;
	/** Rooms the caller is in AND that are in scope for their firm. */
	rooms: ScopedRoom[];
	/** Whether team-less rooms were admitted. */
	includeShared: boolean;
};

/**
 * The caller's retrievable universe: firm ∩ own subscriptions.
 *
 * Both layers are applied here, before any content query runs, so nothing downstream has to
 * remember to narrow anything. A caller with no subscriptions gets an empty list, and every
 * downstream query built from it matches nothing.
 */
export async function resolveScopedRooms(userId: string, options: { includeShared?: boolean } = {}): Promise<ScopedRooms> {
	const includeShared = options.includeShared ?? includeSharedRooms();
	const user = await Users.findOneById<Pick<IUser, '_id' | 'customFields'>>(userId, { projection: { customFields: 1 } });
	const callerFirmId = firmIdOf(user);

	const subs = await Subscriptions.find<{ rid: string }>({ 'u._id': userId, 'open': { $ne: false } }, { projection: { rid: 1 } }).toArray();
	const rids = [...new Set(subs.map((sub) => sub.rid).filter(Boolean))];
	if (!rids.length) {
		return { firmId: callerFirmId, rooms: [], includeShared };
	}

	const rooms = await Rooms.find<RoomFields>({ _id: { $in: rids } }, { projection: ROOM_PROJECTION }).toArray();

	// One batched lookup for every DM participant, rather than a query per room.
	const dmUids = new Set<string>();
	for (const room of rooms) {
		if (!room.teamId && room.t === 'd') {
			(room.uids || []).forEach((uid) => dmUids.add(uid));
		}
	}
	const firmByUser = new Map<string, string | null>();
	if (dmUids.size) {
		const members = await Users.find<Pick<IUser, '_id' | 'customFields'>>(
			{ _id: { $in: [...dmUids] } },
			{ projection: { customFields: 1 } },
		).toArray();
		for (const member of members) {
			firmByUser.set(member._id, firmIdOf(member));
		}
	}

	const scoped: ScopedRoom[] = [];
	for (const room of rooms) {
		let roomFirmId: string | null = null;
		if (typeof room.teamId === 'string' && room.teamId.trim()) {
			roomFirmId = room.teamId.trim();
		} else if (room.t === 'd' && room.uids?.length) {
			const firms = new Set(room.uids.map((uid) => (firmByUser.has(uid) ? (firmByUser.get(uid) ?? null) : undefined)));
			roomFirmId = firms.size === 1 && !firms.has(undefined) ? ([...firms][0] as string | null) : null;
		}
		const inScope = roomFirmId === callerFirmId || (includeShared && roomFirmId === null);
		if (inScope) {
			scoped.push({ rid: room._id, name: room.name || '', fname: room.fname, t: room.t || 'c', firmId: roomFirmId });
		}
	}

	return { firmId: callerFirmId, rooms: scoped, includeShared };
}

/* ────────────────────────────── indexing ────────────────────────────── */

export type IndexRoomOptions = {
	/** Only index messages strictly newer than this. Defaults to the room's stored watermark. */
	since?: Date;
	/** Cap on messages read in this pass (default MAX_MESSAGES_PER_PASS). */
	messageLimit?: number;
	/** Rebuild from scratch: drop the room's rows first and ignore the watermark. */
	rebuild?: boolean;
	/** Injected for tests; `undefined` reads the settings. `null` forces "unconfigured". */
	config?: EmbeddingConfig | null;
	fetcher?: EmbeddingFetch;
};

export type IndexRoomResult = {
	rid: string;
	/** Passages written or refreshed. */
	indexed: number;
	messages: number;
	firmId: string | null;
	/** Set when nothing was written, and why. */
	skipped?: 'embeddings-not-configured' | 'no-room' | 'no-messages' | 'embed-failed';
};

/**
 * Build/refresh index entries for one room.
 *
 * Incremental by default: it reads only messages newer than the newest passage already
 * stored, so the steady-state cost is proportional to new traffic, not to history. Row ids
 * are deterministic (`rid:anchorMessageId:part`), so a re-run over an overlapping range
 * upserts in place instead of duplicating passages.
 */
export async function indexRoom(rid: string, options: IndexRoomOptions = {}): Promise<IndexRoomResult> {
	const config = options.config === undefined ? getEmbeddingConfig() : options.config;
	if (!config) {
		// Unset = off. We do not stockpile un-embedded text: the retrieval path cannot use it,
		// and a half-built index is a thing someone later mistakes for a working one.
		return { rid, indexed: 0, messages: 0, firmId: null, skipped: 'embeddings-not-configured' };
	}

	const room = await Rooms.findOneById<RoomFields>(rid, { projection: ROOM_PROJECTION });
	if (!room) {
		return { rid, indexed: 0, messages: 0, firmId: null, skipped: 'no-room' };
	}
	const firmId = await resolveRoomFirmId(room);

	if (options.rebuild) {
		await ChiSearchIndex.removeRoom(rid);
	}
	const since = options.rebuild ? undefined : (options.since ?? (await ChiSearchIndex.latestIndexedTs(rid)));

	// `_hidden` is how a deleted-but-retained message is tombstoned. Indexing one would let Chi
	// quote, with a citation, something somebody deleted.
	//
	// A message qualifies on EITHER text or an attachment: an upload posted with no caption has
	// an empty `msg`, and excluding those is what would make "did anyone send the deposition
	// transcript?" — a question about a filename — unanswerable.
	const query: Record<string, unknown> = {
		rid,
		t: { $exists: false },
		_hidden: { $ne: true },
		$or: [{ msg: { $exists: true, $ne: '' } }, { file: { $exists: true } }, { files: { $exists: true, $ne: [] } }],
	};
	if (since) {
		// `$gt`, not `$gte`: re-reading the boundary message would re-chunk it into a passage
		// with a different composition and a different anchor, i.e. a near-duplicate row.
		query.ts = { $gt: since };
	}

	const messages = await Messages.find<Pick<IMessage, '_id' | 'msg' | 'u' | 'ts' | 'file' | 'files' | 'attachments'>>(query, {
		sort: { ts: 1 },
		limit: Math.max(1, Math.min(options.messageLimit ?? MAX_MESSAGES_PER_PASS, MAX_MESSAGES_PER_PASS)),
		projection: { msg: 1, u: 1, ts: 1, file: 1, files: 1, attachments: 1 },
	}).toArray();

	if (!messages.length) {
		return { rid, indexed: 0, messages: 0, firmId, skipped: 'no-messages' };
	}

	const chunkable: ChunkMessage[] = messages
		.map((message) => {
			const shared = describeAttachments(message);
			const body = (message.msg || '').trim();
			// The caption and the filename both go in, in that order, so a captioned upload is
			// findable by either. `chunkMessages` drops anything that ends up empty.
			return {
				id: message._id,
				username: message.u?.username,
				text: [body, shared].filter(Boolean).join(' — '),
				ts: message.ts,
			};
		})
		.filter((message) => message.text.length > 0);

	if (!chunkable.length) {
		return { rid, indexed: 0, messages: messages.length, firmId, skipped: 'no-messages' };
	}
	const passages = chunkMessages(chunkable);
	if (!passages.length) {
		return { rid, indexed: 0, messages: messages.length, firmId, skipped: 'no-messages' };
	}

	const vectors = await embedTexts(
		passages.map((passage) => passage.text),
		{ config, fetcher: options.fetcher },
	);
	if (!vectors) {
		return { rid, indexed: 0, messages: messages.length, firmId, skipped: 'embed-failed' };
	}

	const entries: ChiSearchIndexUpsert[] = passages.map((passage, i) => ({
		rid,
		firmId,
		messageIds: passage.messageIds,
		text: passage.text,
		embedding: vectors[i],
		embeddingModel: config.model,
		ts: passage.ts,
		endTs: passage.endTs,
		anchorId: passage.messageIds[0],
		part: passage.part,
	}));

	const indexed = await ChiSearchIndex.upsertMany(entries);
	return { rid, indexed, messages: messages.length, firmId };
}

/**
 * The incremental path: index whatever has arrived in a room since the last pass.
 *
 * This is what a message-save hook (or a periodic sweep) should call. It is cheap when there
 * is nothing new — one indexed lookup for the watermark, one bounded message query that
 * returns zero rows, and no provider call at all.
 */
export async function indexNewMessages(rid: string, options: Omit<IndexRoomOptions, 'since' | 'rebuild'> = {}): Promise<IndexRoomResult> {
	return indexRoom(rid, options);
}

export type BackfillOptions = {
	/** Specific rooms; otherwise the most recently active ones. */
	rids?: string[];
	/** How many rooms this run may touch (default MAX_BACKFILL_ROOMS). */
	roomLimit?: number;
	messagesPerRoom?: number;
	rebuild?: boolean;
	config?: EmbeddingConfig | null;
	fetcher?: EmbeddingFetch;
};

export type BackfillResult = {
	rooms: number;
	indexed: number;
	messages: number;
	skipped: number;
	/** Present when the whole run was a no-op for a single, reportable reason. */
	reason?: IndexRoomResult['skipped'];
};

/**
 * A BOUNDED backfill.
 *
 * Bounded is the whole design: an unbounded first pass over a busy workspace is thousands of
 * provider calls and a bill nobody approved. One run touches at most `roomLimit` rooms and
 * `messagesPerRoom` messages each, newest-active rooms first, and it is safe to run again —
 * the next run resumes from each room's watermark.
 */
export async function backfillIndex(options: BackfillOptions = {}): Promise<BackfillResult> {
	const config = options.config === undefined ? getEmbeddingConfig() : options.config;
	if (!config) {
		return { rooms: 0, indexed: 0, messages: 0, skipped: 0, reason: 'embeddings-not-configured' };
	}

	const roomLimit = Math.max(1, Math.min(options.roomLimit ?? MAX_BACKFILL_ROOMS, MAX_BACKFILL_ROOMS_HARD));
	let rids = options.rids?.filter(Boolean) ?? [];
	if (!rids.length) {
		const rooms = await Rooms.find<Pick<IRoom, '_id'>>(
			{ t: { $in: ['c', 'p', 'd'] as IRoom['t'][] } },
			{ sort: { lm: -1 }, limit: roomLimit, projection: { _id: 1 } },
		).toArray();
		rids = rooms.map((room) => room._id);
	}
	rids = rids.slice(0, roomLimit);

	const result: BackfillResult = { rooms: 0, indexed: 0, messages: 0, skipped: 0 };
	for (const rid of rids) {
		try {
			const one = await indexRoom(rid, {
				config,
				fetcher: options.fetcher,
				rebuild: options.rebuild,
				messageLimit: options.messagesPerRoom,
			});
			result.rooms += 1;
			result.indexed += one.indexed;
			result.messages += one.messages;
			if (one.skipped) {
				result.skipped += 1;
			}
		} catch (err) {
			// One unindexable room must not abort the run.
			result.skipped += 1;
			SystemLogger.warn({ msg: 'ChiSearch: failed to index room', rid, err });
		}
	}
	return result;
}

/** Forget a room entirely — call when a room is deleted, or before a rebuild. */
export async function removeRoomFromIndex(rid: string): Promise<number> {
	return ChiSearchIndex.removeRoom(rid);
}
