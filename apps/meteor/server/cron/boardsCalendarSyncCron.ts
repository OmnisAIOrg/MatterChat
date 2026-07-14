import { cronJobs } from '@rocket.chat/cron';
import { BoardCalendarConnections, BoardsCards } from '@rocket.chat/models';

import { getCaseProBridgeForUser } from '../lib/boards/calendar-sync/caseproBridge';
import { pollCasePro, pushUserCardsThroughCasePro } from '../lib/boards/calendar-sync/caseproSync';
import { isCalendarSyncEnabled } from '../lib/boards/calendar-sync/config';
import { ensurePushSubscription, renewExpiringPushSubscriptions } from '../lib/boards/calendar-sync/pushSubscriptions';
import { pollConnection, pushUserCards } from '../lib/boards/calendar-sync/service';
import { SystemLogger } from '../lib/logger/system';

/**
 * Boards two-way calendar sync cron (Phase 3). Every 15 minutes: PUSH each user's due-dated cards out
 * (create/update/delete mirror events) and POLL for calendar-side changes (moved events → card due
 * dates; new events → opt-in cards).
 *
 * LAYERED: a user whose calendar lives in CasePro (enabled + linked + connected there) is swept THROUGH
 * CasePro — including CasePro-only users who have NO standalone `boards_calendar_connections` document
 * (found via their existing CasePro mirrors). Everyone else is swept via their standalone connection,
 * exactly as before. A user is swept at most once per tick (CasePro-preferred users are de-duped out of
 * the standalone loop).
 *
 * GATED: the whole job is a no-op when Boards_Calendar_Sync_Enabled is off — it doesn't enumerate
 * anything, so a disabled instance makes ZERO external calls. Best-effort per connection/user: one
 * failure never aborts the sweep. Called from cron/start.ts.
 */
async function runCalendarSyncTick(): Promise<void> {
	if (!isCalendarSyncEnabled()) {
		return;
	}

	// Users already routed through CasePro this tick — so the standalone loop skips them.
	const sweptViaCasePro = new Set<string>();

	// 1. CasePro-only users: those with an existing CasePro mirror but (possibly) no standalone connection.
	let caseProUserIds: string[] = [];
	try {
		caseProUserIds = await BoardsCards.findUserIdsWithCaseProMirror();
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.calendar.sync.caseproEnumFailed', err: String(err) });
	}
	for (const userId of caseProUserIds) {
		try {
			const bridge = await getCaseProBridgeForUser(userId);
			if (!bridge) {
				continue;
			}
			const pushed = await pushUserCardsThroughCasePro(userId, bridge);
			const polled = await pollCasePro(userId, bridge);
			sweptViaCasePro.add(userId);
			SystemLogger.debug({ msg: 'boards.calendar.sync.casepro.tick', userId, ...pushed, ...polled });
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.calendar.sync.casepro.tick.failed', userId, err: String(err) });
		}
	}

	// 2. Standalone connections — but prefer CasePro when it's this user's source (and skip if already swept).
	const conns = await BoardCalendarConnections.findConnected().toArray();
	for (const conn of conns) {
		try {
			if (sweptViaCasePro.has(conn.userId)) {
				continue;
			}
			const bridge = await getCaseProBridgeForUser(conn.userId);
			if (bridge) {
				const pushed = await pushUserCardsThroughCasePro(conn.userId, bridge);
				const polled = await pollCasePro(conn.userId, bridge);
				sweptViaCasePro.add(conn.userId);
				SystemLogger.debug({ msg: 'boards.calendar.sync.casepro.tick', userId: conn.userId, ...pushed, ...polled });
				continue;
			}
			const pushed = await pushUserCards(conn);
			const polled = await pollConnection(conn);
			// Best-effort: make sure this standalone connection has a live real-time push subscription
			// (create if missing / newly-configured). Renewal of near-expiry ones is the sweep below.
			// The poll above ALWAYS runs first, so push is a pure enhancement — sync never depends on it.
			await ensurePushSubscription(conn).catch(() => undefined);
			SystemLogger.debug({ msg: 'boards.calendar.sync.tick', connectionId: conn._id, ...pushed, ...polled });
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.calendar.sync.tick.failed', connectionId: conn._id, err: String(err) });
		}
	}

	// 3. Renew any real-time push subscriptions nearing expiry (Google ~7d / Graph ~3d → renew early).
	//    No-op when push is unconfigured (the query only matches connections that already have a push).
	try {
		const swept = await renewExpiringPushSubscriptions();
		if (swept.renewed || swept.failed) {
			SystemLogger.debug({ msg: 'boards.calendar.push.sweep', ...swept });
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.calendar.push.sweep.failed', err: String(err) });
	}
}

export async function boardsCalendarSyncCron(): Promise<void> {
	// every 15 minutes
	await cronJobs.add('BoardsCalendarSync', '*/15 * * * *', async () => runCalendarSyncTick());
}
