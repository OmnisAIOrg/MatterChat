import { cronJobs } from '@rocket.chat/cron';
import { MongoInternals } from 'meteor/mongo';

import { automationEngineCron } from './automationEngine';
import { boardsCaseProSnapshotCron } from './boardsCaseProSnapshotCron';
import { boardsCaseProSyncCron } from './boardsCaseProSyncCron';
import { boardsDigestCron } from './boardsDigestCron';
import { boardsMattersCron } from './boardsMattersCron';
import { caseproClientSyncCron } from './caseproClientSyncCron';

export const startCron = async () => {
	const started = await cronJobs.start((MongoInternals.defaultRemoteCollectionDriver().mongo as any).client.db());
	// Boards/Matters depth (M5): SOL watch + deadline reminders + stuck-matter sweep.
	// Registered after the scheduler is started so `cronJobs.add` has a live driver.
	await boardsMattersCron();
	// CasePro snapshot refresh: periodic re-pull of every matter-bound card's cached
	// `link.snapshot` (gated by caseProMode; cadence from CasePro_Snapshot_Refresh_Interval).
	await boardsCaseProSnapshotCron();
	// Boards Automation engine (M7): per-minute master tick (scheduled automations +
	// synthesized due/overdue events + drip steps) + daily run-log prune.
	await automationEngineCron();
	// Boards Notifications (M8): email digest of unread board notifications — gated by
	// Boards_Email_Digest_Enabled + SMTP, schedule from Boards_Email_Digest_Schedule.
	await boardsDigestCron();
	// CasePro live wire: periodic leads pull from CasePro intake (gated on
	// CasePro_Enabled + a LIVE transport) + the boot-time misconfig warning.
	await boardsCaseProSyncCron();
	// CasePro CLIENT-message two-way sync: inbound poll of client→firm portal messages into the
	// per-matter "Client" channel — gated by CasePro_Enabled + CasePro_Client_Sync_Enabled,
	// schedule from CasePro_Client_Sync_Poll_Schedule. (Outbound leg is the afterSaveMessage hook.)
	await caseproClientSyncCron();
	return started;
};
