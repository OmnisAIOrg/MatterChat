import { cronJobs } from '@rocket.chat/cron';

import { Automation } from '../services/automation/service';
import { ensureAutomationTemplates } from '../startup/boards/automationTemplates';
import { settings } from '../settings';
import { SystemLogger } from '../lib/logger/system';

/**
 * Automation-engine cron (M7 — 05-automation-engine.md §7). ONE master tick per minute
 * drives everything time-based: scheduled automations due this minute, the synthesized
 * `card.dueSoon`/`card.overdue`/`deadline.due` events, and due drip-sequence steps (the
 * tick delegates entirely to `Automation.tick()` → `runScheduledTick`). A separate daily
 * job prunes the run-log per `Boards_Automation_Run_Retention_Days`.
 *
 * The per-minute tick is gated by `Boards_Automation_Scheduling_Enabled`: we watch the
 * setting and add/remove the job exactly like `cronPruneMessages.ts`, so an admin can
 * silence all scheduled work without a redeploy. The master kill switch
 * (`Boards_Automation_Enabled`) is also honored inside `Automation.tick()`.
 *
 * Registered from `cron/start.ts` (after the scheduler has a live driver), mirroring
 * `boardsMattersCron`.
 */

const TICK_JOB = 'BoardsAutomationTick';
const PRUNE_JOB = 'BoardsAutomationPrune';

/** Add/remove the per-minute tick to match the scheduling toggle. Idempotent. */
async function syncTickJob(): Promise<void> {
	const enabled = settings.get<boolean>('Boards_Automation_Scheduling_Enabled');
	const has = await cronJobs.has(TICK_JOB);
	if (enabled && !has) {
		await cronJobs.add(TICK_JOB, '* * * * *', async () => Automation.tick());
		SystemLogger.debug({ msg: 'boards.automation.cron.tickEnabled' });
	} else if (!enabled && has) {
		await cronJobs.remove(TICK_JOB);
		SystemLogger.debug({ msg: 'boards.automation.cron.tickDisabled' });
	}
}

/**
 * Register the automation-engine cron jobs. The 1-minute tick is wired through the
 * scheduling-toggle watcher; the daily prune always runs (it is cheap + bounded and
 * honors retention=0 by simply deleting nothing very old).
 */
export async function automationEngineCron(): Promise<void> {
	// seed the prebuilt automation templates once (idempotent on seedKey). Done here — the
	// engine cron is the boards-automation boot seam, runs after the DB driver is live, and
	// keeps the seed registration self-contained.
	await ensureAutomationTemplates();

	// daily at 03:30 — prune the run-log to the retention window.
	await cronJobs.add(PRUNE_JOB, '30 3 * * *', async () => {
		await Automation.pruneRuns();
	});

	// per-minute master tick, gated by the scheduling toggle (watch → add/remove).
	settings.watch<boolean>('Boards_Automation_Scheduling_Enabled', async () => {
		await syncTickJob();
	});
	// also evaluate once at boot (the watch fires on change; this covers the initial state).
	await syncTickJob();
}
