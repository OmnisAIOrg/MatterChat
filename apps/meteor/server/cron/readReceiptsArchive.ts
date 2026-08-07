import { cronJobs } from '@rocket.chat/cron';
import { ReadReceipts, ReadReceiptsArchive } from '@rocket.chat/models';

import { settings } from '../settings';
import { SystemLogger } from '../lib/logger/system';

/**
 * MATTERCHAT: MIT read-receipts ARCHIVE cron.
 *
 * The `Message_Read_Receipt_Archive_*` settings are MIT (server/settings/message.ts) but the
 * cron that acted on them lived only in the EE tree upstream — without it the admin-visible
 * settings silently do nothing and `read_receipts` grows unbounded. This fork uses read
 * receipts, so the job is re-provided here, clean-room, derived from the settings semantics:
 *
 *   - `Message_Read_Receipt_Archive_Enabled`         — master toggle (job removed when off)
 *   - `Message_Read_Receipt_Archive_Retention_Days`  — receipts with `ts` older than this many
 *                                                      days are moved out of the live collection
 *   - `Message_Read_Receipt_Archive_Cron`            — cron expression (default nightly 02:00)
 *   - `Message_Read_Receipt_Archive_Batch_Size`      — docs moved per batch within one run
 *
 * Each run sweeps in batches: read a batch of expired receipts, upsert them into the archive
 * collection FIRST (idempotent — `saveReceipts` upserts by `_id`), then delete exactly those
 * `_id`s from the live collection. Archive-before-delete means a crash mid-run can only leave
 * a receipt duplicated into the archive (repaired by the upsert on the next run), never lost.
 * The job never throws; failures are logged and retried on the next scheduled run.
 *
 * Registration mirrors `boardsDigestCron`: watch the enable toggle + cron expression and
 * add/remove/re-schedule the job (retention/batch size are read at run time, so changing
 * them needs no re-registration). Wired from `server/cron/start.ts`.
 */

const JOB_NAME = 'ReadReceiptsArchive';

const DEFAULT_SCHEDULE = '0 2 * * *';
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 10000;

const DAY_MS = 24 * 60 * 60 * 1000;

function archiveEnabled(): boolean {
	try {
		return settings.get('Message_Read_Receipt_Archive_Enabled') === true;
	} catch {
		return false;
	}
}

/** The cron expression (degrades to nightly 02:00 if unset/blank). */
function archiveSchedule(): string {
	try {
		const raw = settings.get<string>('Message_Read_Receipt_Archive_Cron');
		return raw && raw.trim() ? raw.trim() : DEFAULT_SCHEDULE;
	} catch {
		return DEFAULT_SCHEDULE;
	}
}

/** Positive-int setting with a sane fallback (guards 0/negative/NaN admin input). */
function positiveIntSetting(id: string, fallback: number): number {
	try {
		const raw = Number(settings.get(id));
		return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
	} catch {
		return fallback;
	}
}

/**
 * One sweep: move every receipt with `ts` older than the retention window into the archive,
 * `batchSize` documents at a time. Returns the number moved. Never throws.
 */
export async function runReadReceiptsArchive(): Promise<number> {
	// Re-checked at run time — the toggle can flip between scheduling and execution.
	if (!archiveEnabled()) {
		return 0;
	}

	const retentionDays = positiveIntSetting('Message_Read_Receipt_Archive_Retention_Days', DEFAULT_RETENTION_DAYS);
	const batchSize = positiveIntSetting('Message_Read_Receipt_Archive_Batch_Size', DEFAULT_BATCH_SIZE);
	const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

	let moved = 0;
	try {
		while (true) {
			const receipts = await ReadReceipts.findOlderThan(cutoff).limit(batchSize).toArray();
			if (receipts.length === 0) {
				break;
			}

			// Archive first (upsert by _id — idempotent), delete after.
			await ReadReceiptsArchive.saveReceipts(receipts);
			await ReadReceipts.deleteMany({ _id: { $in: receipts.map(({ _id }) => _id) } });
			moved += receipts.length;

			if (receipts.length < batchSize) {
				break;
			}
		}
	} catch (err) {
		SystemLogger.error({ msg: 'readReceipts.archive.failed', cutoff, moved, err });
		return moved;
	}

	if (moved > 0) {
		SystemLogger.info({ msg: 'readReceipts.archive.swept', moved, cutoff });
	}
	return moved;
}

/**
 * Add/remove/re-schedule the archive job to match the enable toggle + cron string.
 * Idempotent: cronJobs keys by name, so a schedule change drops+re-adds the job.
 */
let registeredSchedule: string | undefined;

async function syncArchiveJob(): Promise<void> {
	const enabled = archiveEnabled();
	const schedule = archiveSchedule();
	const has = await cronJobs.has(JOB_NAME);

	if (!enabled) {
		if (has) {
			await cronJobs.remove(JOB_NAME);
			registeredSchedule = undefined;
			SystemLogger.debug({ msg: 'readReceipts.archive.disabled' });
		}
		return;
	}

	if (has && registeredSchedule === schedule) {
		return;
	}
	if (has) {
		await cronJobs.remove(JOB_NAME);
	}
	await cronJobs.add(JOB_NAME, schedule, async () => {
		await runReadReceiptsArchive();
	});
	registeredSchedule = schedule;
	SystemLogger.debug({ msg: 'readReceipts.archive.enabled', schedule });
}

/**
 * Register the archive cron. Watches the enable toggle + cron expression and evaluates once
 * at boot for the initial state. Called from `server/cron/start.ts` after the scheduler has
 * a live driver, mirroring `boardsDigestCron`.
 */
export async function readReceiptsArchiveCron(): Promise<void> {
	settings.watch('Message_Read_Receipt_Archive_Enabled', async () => {
		await syncArchiveJob();
	});
	settings.watch('Message_Read_Receipt_Archive_Cron', async () => {
		await syncArchiveJob();
	});
	// initial state (the watches fire on change; this covers boot).
	await syncArchiveJob();
}
