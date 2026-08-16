import { cronJobs } from '@rocket.chat/cron';

import { isEmbeddingConfigured } from '../lib/chi/search/embeddings';
import { backfillIndex } from '../lib/chi/search/indexer';
import { SystemLogger } from '../lib/logger/system';
import { settings } from '../settings';

/**
 * MATTERCHAT: the periodic backfill behind Chi "Ask Anything" (F9).
 *
 * The afterSaveMessage hook (server/lib/chi/search/startup.ts) keeps up with NEW traffic. This
 * job exists for everything that hook structurally cannot see:
 *
 *  - **History from before semantic search was turned on.** Which, on the day an admin enables
 *    it, is the entire workspace. Without this the feature would look broken for weeks until
 *    every room happened to receive a message.
 *  - **Rooms the queue turned away at its ceiling**, and anything in flight when a pod restarted.
 *  - **Rooms that went quiet** mid-backlog — the hook only re-dirties a room when someone posts.
 *
 * BOUNDED, deliberately. One run touches at most `Chi_Search_Backfill_Rooms` rooms, newest-active
 * first, and resumes from each room's own watermark, so repeated runs walk forward instead of
 * re-billing the same text. The default cadence and room count are sized so that enabling this on
 * a busy workspace is a slow, visible ramp rather than a surprise invoice.
 *
 * Gated twice: the setting, and `isEmbeddingConfigured()`. With no provider this job is
 * registered but every tick is a single boolean and a return.
 */

const INDEX_JOB = 'ChiSearchIndexBackfill';

const DEFAULT_SCHEDULE = '*/30 * * * *';
const DEFAULT_ROOMS = 25;

function backfillEnabled(): boolean {
	try {
		return settings.get('Chi_Search_Backfill_Enabled') === true;
	} catch {
		return false;
	}
}

function backfillSchedule(): string {
	try {
		const raw = settings.get<string>('Chi_Search_Backfill_Schedule');
		return raw && raw.trim() ? raw.trim() : DEFAULT_SCHEDULE;
	} catch {
		return DEFAULT_SCHEDULE;
	}
}

function backfillRooms(): number {
	try {
		const rooms = settings.get<number>('Chi_Search_Backfill_Rooms');
		return Math.max(1, Math.min(typeof rooms === 'number' && Number.isFinite(rooms) && rooms > 0 ? rooms : DEFAULT_ROOMS, 500));
	} catch {
		return DEFAULT_ROOMS;
	}
}

export async function runSearchBackfill(): Promise<{ rooms: number; indexed: number; messages: number; skipped: number }> {
	if (!backfillEnabled() || !isEmbeddingConfigured()) {
		return { rooms: 0, indexed: 0, messages: 0, skipped: 0 };
	}
	const result = await backfillIndex({ roomLimit: backfillRooms() });
	if (result.indexed || result.skipped) {
		SystemLogger.debug({
			msg: 'chi.search.backfill',
			rooms: result.rooms,
			indexed: result.indexed,
			messages: result.messages,
			skipped: result.skipped,
		});
	}
	return { rooms: result.rooms, indexed: result.indexed, messages: result.messages, skipped: result.skipped };
}

let registeredSchedule: string | undefined;

async function syncBackfillJob(): Promise<void> {
	const enabled = backfillEnabled();
	const schedule = backfillSchedule();
	const has = await cronJobs.has(INDEX_JOB);

	if (!enabled) {
		if (has) {
			await cronJobs.remove(INDEX_JOB);
			registeredSchedule = undefined;
			SystemLogger.debug({ msg: 'chi.search.backfill.disabled' });
		}
		return;
	}

	if (has && registeredSchedule === schedule) {
		return;
	}
	if (has) {
		await cronJobs.remove(INDEX_JOB);
	}
	await cronJobs.add(INDEX_JOB, schedule, async () => {
		await runSearchBackfill();
	});
	registeredSchedule = schedule;
	SystemLogger.debug({ msg: 'chi.search.backfill.enabled', schedule });
}

/** Register the search backfill cron. Called from cron/start.ts. */
export async function chiSearchIndexCron(): Promise<void> {
	settings.watch('Chi_Search_Backfill_Enabled', async () => {
		await syncBackfillJob();
	});
	settings.watch('Chi_Search_Backfill_Schedule', async () => {
		await syncBackfillJob();
	});
	await syncBackfillJob();
}
