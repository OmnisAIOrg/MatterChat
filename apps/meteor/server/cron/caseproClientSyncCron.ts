import { cronJobs } from '@rocket.chat/cron';

import { runClientSyncSweep, isClientSyncEnabled } from '../lib/boards/casepro-clientsync/index';
import { caseProClientMessagesClient } from '../lib/boards/casepro-clientsync/client';
import { settings } from '../settings';
import { SystemLogger } from '../lib/logger/system';

/**
 * CasePro CLIENT-message inbound poll cron — the client→firm leg of the two-way sync.
 *
 * Each tick sweeps every "Client" channel (rooms with `clientChannel: true`) and ingests any
 * new `client_messages` (from='client') from the CasePro portal into that channel. The
 * firm→client leg is event-driven (afterSaveMessage), so this cron only paces the inbound side.
 *
 * GRACEFUL DEGRADE (hard rule): the whole job no-ops unless
 *   1. CasePro_Enabled AND CasePro_Client_Sync_Enabled are both true, AND
 *   2. a service base URL is configured (`caseProClientMessagesClient.isConfigured()`).
 * Otherwise the sweep is silently skipped — "gating off = zero traffic". Per-matter failures
 * are swallowed inside the sweep so one bad matter can't abort the tick.
 *
 * SCHEDULING: the cron expression comes from `CasePro_Client_Sync_Poll_Schedule` (default
 * `* * * * *` = every minute). We watch BOTH the enable toggle and the schedule string and
 * re-register the job — mirroring `boardsDigestCron` / `automationEngine` — so an admin can
 * change cadence or silence the poll with no redeploy. Registered from `cron/start.ts` after
 * the scheduler has a live driver.
 */

const POLL_JOB = 'CaseProClientSyncPoll';

/** Poll enabled = the toggles are on AND a service URL is configured. */
function pollEnabled(): boolean {
	try {
		return isClientSyncEnabled() && caseProClientMessagesClient.isConfigured();
	} catch {
		return false;
	}
}

/** The schedule cron string (degrades to every-minute if unset/blank). */
function pollSchedule(): string {
	try {
		const raw = settings.get<string>('CasePro_Client_Sync_Poll_Schedule');
		return raw && raw.trim() ? raw.trim() : '* * * * *';
	} catch {
		return '* * * * *';
	}
}

async function runPollSweep(): Promise<void> {
	if (!pollEnabled()) {
		return;
	}
	try {
		const { rooms, ingested } = await runClientSyncSweep();
		if (ingested > 0) {
			SystemLogger.debug({ msg: 'casepro.clientSync.poll.swept', rooms, ingested });
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'casepro.clientSync.poll.failed', err });
	}
}

let registeredSchedule: string | undefined;

/** Add/remove/re-schedule the poll job to match the enable toggles + schedule string. Idempotent. */
async function syncPollJob(): Promise<void> {
	const enabled = pollEnabled();
	const schedule = pollSchedule();
	const has = await cronJobs.has(POLL_JOB);

	if (!enabled) {
		if (has) {
			await cronJobs.remove(POLL_JOB);
			registeredSchedule = undefined;
			SystemLogger.debug({ msg: 'casepro.clientSync.poll.disabled' });
		}
		return;
	}

	if (has && registeredSchedule === schedule) {
		return;
	}
	if (has) {
		await cronJobs.remove(POLL_JOB);
	}
	await cronJobs.add(POLL_JOB, schedule, async () => {
		await runPollSweep();
	});
	registeredSchedule = schedule;
	SystemLogger.debug({ msg: 'casepro.clientSync.poll.enabled', schedule });
}

/**
 * Register the client-sync poll cron. Watches the enable toggles + schedule string (add/remove/
 * re-schedule) and evaluates once at boot for the initial state. Called from `cron/start.ts`,
 * mirroring `boardsMattersCron` / `boardsDigestCron`.
 */
export async function caseproClientSyncCron(): Promise<void> {
	settings.watch('CasePro_Enabled', async () => syncPollJob());
	settings.watch('CasePro_Client_Sync_Enabled', async () => syncPollJob());
	settings.watch('CasePro_Client_Sync_Poll_Schedule', async () => syncPollJob());
	await syncPollJob();
}
