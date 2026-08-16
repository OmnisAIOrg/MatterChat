/**
 * MATTERCHAT: wiring for live Chi search indexing (F9).
 *
 * Loaded from server/hooks/index.ts. The decidable halves live next door and are unit-tested
 * without Meteor:
 *  - ./indexGate.ts  — the per-message gate
 *  - ./indexQueue.ts — dirty-room batching, fair ordering, backoff, ceilings
 *
 * ## The contract with the rest of the workspace
 *
 * This registers a callback on afterSaveMessage, which is to say: on the single hottest path in
 * the product. It therefore obeys three rules absolutely.
 *
 *  1. **O(1) and no I/O.** The listener reads a cached setting, checks a few message fields, and
 *     bumps a counter in a Map. Nothing awaits. Nothing queries.
 *  2. **Off costs nothing.** `isEmbeddingConfigured()` is a cached settings read and it is the
 *     first thing checked. A workspace that never turns semantic search on pays one boolean per
 *     message, forever.
 *  3. **It cannot break message sending.** The whole listener body is wrapped; an error is
 *     logged and the message is returned untouched. Search being broken must never mean chat is
 *     broken.
 *
 * The bounded backfill (`rebuild_search_index`, and the periodic sweep in
 * server/cron/chiSearchIndexCron.ts) remains the way history gets indexed. This hook only keeps
 * up with new traffic.
 */
import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { Meteor } from 'meteor/meteor';

import { isEmbeddingConfigured } from './embeddings';
import { evaluateMessageForIndexing } from './indexGate';
import { MAX_MESSAGES_PER_PASS, indexNewMessages } from './indexer';
import { SearchIndexQueue } from './indexQueue';
import { CHI_BOT_ID } from '../bot';
import { callbacks } from '../../callbacks';
import { SystemLogger } from '../../logger/system';
import { ChiSearchIndex } from '../../../models/ChiSearchIndex';

const SAVE_CALLBACK_ID = 'chi-search-indexer';
const DELETE_CALLBACK_ID = 'chi-search-indexer-delete';

/** Ticker cadence. A room still waits out `flushIntervalMs`; this is just the resolution. */
const TICK_MS = 15_000;

export const chiSearchQueue = new SearchIndexQueue({
	async flushRoom(rid) {
		const result = await indexNewMessages(rid);
		if (result.skipped === 'embed-failed') {
			// The provider was unreachable or refused. Throwing hands the room to the queue's
			// backoff instead of silently dropping the window — a half-built index that nobody
			// knows is half-built is the worst outcome available here.
			throw new Error('embedding provider call failed');
		}
		return { indexed: result.indexed, more: result.messages >= MAX_MESSAGES_PER_PASS };
	},
	onError(context, err) {
		SystemLogger.warn({ msg: context, err: String(err) });
	},
	onInfo(msg) {
		SystemLogger.debug({ msg });
	},
});

/** afterSaveMessage — NEVER throws, never awaits. */
function onMessageSaved(message: IMessage, room: IRoom | undefined): IMessage {
	try {
		const decision = evaluateMessageForIndexing(message, room, isEmbeddingConfigured(), CHI_BOT_ID);
		if (decision.action === 'index') {
			chiSearchQueue.noteMessageSaved(room!._id);
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'chi-search: index hook failed (message unaffected)', rid: room?._id, err: String(err) });
	}
	return message;
}

/**
 * afterDeleteMessage — drop every passage the message contributed to.
 *
 * A passage bundles several consecutive messages, so this removes its neighbours from the index
 * too. That is the deliberate trade: over-deleting costs a few results until the next rebuild,
 * whereas under-deleting means Chi can quote, with a citation, a message somebody deleted.
 */
function onMessageDeleted(message: IMessage): void {
	if (!message?._id || !isEmbeddingConfigured()) {
		return;
	}
	ChiSearchIndex.removeByMessageId(message._id).catch((err) => {
		SystemLogger.warn({ msg: 'chi-search: failed to unindex deleted message', mid: message._id, err: String(err) });
	});
}

let started = false;

export function startChiSearchIndexer(): void {
	if (started) {
		return;
	}
	started = true;
	callbacks.add(
		'afterSaveMessage',
		(message: IMessage, { room }: { room: IRoom }) => onMessageSaved(message, room),
		callbacks.priority.LOW,
		SAVE_CALLBACK_ID,
	);
	callbacks.add(
		'afterDeleteMessage',
		(message: IMessage) => onMessageDeleted(message),
		callbacks.priority.LOW,
		DELETE_CALLBACK_ID,
	);
	setInterval(() => {
		chiSearchQueue.flushDue().catch((err) => SystemLogger.warn({ msg: 'chi-search: tick failed', err: String(err) }));
	}, TICK_MS);
}

Meteor.startup(() => {
	startChiSearchIndexer();
});
