import { cronJobs } from '@rocket.chat/cron';
import { BoardCalendarConnections } from '@rocket.chat/models';

import { isCalendarSyncEnabled } from '../lib/boards/calendar-sync/config';
import { pollConnection, pushUserCards } from '../lib/boards/calendar-sync/service';
import { SystemLogger } from '../lib/logger/system';

/**
 * Boards two-way calendar sync cron (Phase 3). Every 15 minutes: for each connected calendar
 * connection, PUSH the user's due-dated cards out (create/update/delete mirror events) and POLL for
 * calendar-side changes (moved events → card due dates; new events → opt-in cards).
 *
 * GATED: the whole job is a no-op when Boards_Calendar_Sync_Enabled is off — it doesn't even enumerate
 * connections, so a disabled instance makes ZERO external calls. Best-effort per connection: one
 * failing connection never aborts the sweep. Called from cron/start.ts.
 */
async function runCalendarSyncTick(): Promise<void> {
	if (!isCalendarSyncEnabled()) {
		return;
	}
	const conns = await BoardCalendarConnections.findConnected().toArray();
	for (const conn of conns) {
		try {
			const pushed = await pushUserCards(conn);
			const polled = await pollConnection(conn);
			SystemLogger.debug({ msg: 'boards.calendar.sync.tick', connectionId: conn._id, ...pushed, ...polled });
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.calendar.sync.tick.failed', connectionId: conn._id, err: String(err) });
		}
	}
}

export async function boardsCalendarSyncCron(): Promise<void> {
	// every 15 minutes
	await cronJobs.add('BoardsCalendarSync', '*/15 * * * *', async () => runCalendarSyncTick());
}
