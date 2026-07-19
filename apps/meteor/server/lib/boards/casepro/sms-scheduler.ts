import { Meteor } from 'meteor/meteor';
import { SystemLogger } from '../../logger/system';
import { syncAllSMSMessages } from './sms-sync';

/**
 * SMS Sync Scheduler — registers a periodic job to sync SMS messages.
 *
 * The job runs every 30 seconds (configurable), pulling new messages from CasePro
 * for all SMS-enabled rooms and creating corresponding MatterChat messages.
 *
 * This is called once on server startup (via the app's startup hook).
 */

let syncJobHandle: number | undefined;

/** Interval between syncs (milliseconds). Default: 30 seconds. */
const SYNC_INTERVAL_MS = process.env.SMS_SYNC_INTERVAL_MS ? parseInt(process.env.SMS_SYNC_INTERVAL_MS, 10) : 30_000;

/**
 * Start the SMS sync job.
 * Called on server startup; safe to call multiple times (previous job is cleared).
 */
export function startSMSSyncScheduler(): void {
	if (syncJobHandle !== undefined) {
		Meteor.clearInterval(syncJobHandle);
	}

	syncJobHandle = Meteor.setInterval(async () => {
		try {
			const synced = await syncAllSMSMessages();
			if (synced > 0) {
				SystemLogger.debug('SMSScheduler: sync completed', { synced });
			}
		} catch (err) {
			SystemLogger.error('SMSScheduler: sync failed', {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}, SYNC_INTERVAL_MS);

	SystemLogger.info('SMSScheduler: started', { intervalMs: SYNC_INTERVAL_MS });
}

/**
 * Stop the SMS sync job (for graceful shutdown or testing).
 */
export function stopSMSSyncScheduler(): void {
	if (syncJobHandle !== undefined) {
		Meteor.clearInterval(syncJobHandle);
		syncJobHandle = undefined;
		SystemLogger.info('SMSScheduler: stopped');
	}
}

/**
 * Initialize the scheduler on server startup.
 * This is idempotent; calling multiple times just restarts the job.
 */
export function initSMSSyncScheduler(): void {
	// Register the startup hook with Meteor.
	Meteor.startup(() => {
		startSMSSyncScheduler();
	});
}
