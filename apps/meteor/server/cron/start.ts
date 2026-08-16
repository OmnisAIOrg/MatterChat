import { cronJobs } from '@rocket.chat/cron';
import { MongoInternals } from 'meteor/mongo';

import { automationEngineCron } from './automationEngine';
import { boardsCaseProSnapshotCron } from './boardsCaseProSnapshotCron';
import { boardsCaseProSyncCron } from './boardsCaseProSyncCron';
import { boardsDigestCron } from './boardsDigestCron';
import { boardsCalendarSyncCron } from './boardsCalendarSyncCron';
import { boardsMattersCron } from './boardsMattersCron';
import { caseproClientSyncCron } from './caseproClientSyncCron';
import { chiMorningBriefCron } from './chiMorningBriefCron';
import { chiRemindersCron } from './chiRemindersCron';
import { chiSearchIndexCron } from './chiSearchIndexCron';
// MATTERCHAT: MIT port of the read-receipts archive job (was EE-only upstream).
import { readReceiptsArchiveCron } from './readReceiptsArchive';

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
	// Chi morning brief: a daily DM of what each opted-in user missed, with jump
	// links. Gated by Chi_Morning_Brief_Enabled AND a per-user opt-in
	// (settings.chi.morningBrief); schedule from Chi_Morning_Brief_Schedule.
	await chiMorningBriefCron();
	// Chi reminders: per-minute delivery of due reminders and follow-ups.
	// Conditional ("if nobody replies") reminders re-check at delivery time and
	// stay silent when the reply arrived.
	await chiRemindersCron();
	// Chi "Ask Anything" backfill: bounded periodic indexing of history the
	// afterSaveMessage hook never saw — gated by Chi_Search_Backfill_Enabled AND a
	// configured embedding provider, schedule from Chi_Search_Backfill_Schedule.
	await chiSearchIndexCron();
	// CasePro live wire: periodic leads pull from CasePro intake (gated on
	// CasePro_Enabled + a LIVE transport) + the boot-time misconfig warning.
	await boardsCaseProSyncCron();
	// CasePro CLIENT-message two-way sync: inbound poll of client→firm portal messages into the
	// per-matter "Client" channel — gated by CasePro_Enabled + CasePro_Client_Sync_Enabled,
	// schedule from CasePro_Client_Sync_Poll_Schedule. (Outbound leg is the afterSaveMessage hook.)
	await caseproClientSyncCron();
	// Boards two-way calendar sync (Phase 3): every 15 min, push due-dated cards to connected
	// Google/Outlook calendars and poll for calendar-side changes — gated by Boards_Calendar_Sync_Enabled.
	await boardsCalendarSyncCron();
	// MATTERCHAT: read-receipts archival — moves ReadReceipts docs older than
	// Message_Read_Receipt_Archive_Retention_Days into `read_receipts_archive`, gated by
	// Message_Read_Receipt_Archive_Enabled, schedule from Message_Read_Receipt_Archive_Cron.
	await readReceiptsArchiveCron();
	return started;
};
