/**
 * Server startup entry for Boards two-way calendar sync + email-to-task (Phase 3).
 *
 * Importing this module mounts (side-effect):
 *   - the calendar OAuth routes   /_boards_calendar/:provider/oauth/{start,callback}  (./routes)
 *   - the email-to-task webhook   POST /_boards_email/inbound                          (./emailWebhook)
 *   - the calendar PUSH receiver  POST /_boards_calendar/push/{google,outlook}         (./pushWebhook)
 *
 * All mounts are SAFE AT BOOT even when the features are OFF: the route handlers check the gates
 * (isCalendarSyncEnabled / isEmailToTaskEnabled + the fail-closed secret) on every request and refuse
 * before any external call. The inbound POLL is a cron (cron/boardsCalendarSyncCron.ts); the outbound
 * PUSH runs both on that cron and on-demand via the syncNow REST endpoint. The real-time PUSH webhook
 * subscriptions (the poll's parity follow-up) are best-effort — when BOARDS_CALENDAR_PUSH_SECRET is
 * unset the receiver drops every notification and NO subscription is created, so the system silently
 * keeps polling as the fallback. Imported from apps/meteor/server/importPackages.ts.
 */
import { getCalendarPushSecret, isCalendarSyncEnabled, pushPublicBaseUrl } from './config';
import './routes';
import './emailWebhook';
import './pushWebhook';
import { SystemLogger } from '../../logger/system';

// LOUD BOOT WARNING: sync is enabled but real-time push can't run → we fall back to the 15-min poll.
// Deferred to the next tick so `settings` is populated (this module is imported at server boot).
setTimeout(() => {
	try {
		if (!isCalendarSyncEnabled()) {
			return;
		}
		if (!getCalendarPushSecret()) {
			SystemLogger.warn({
				msg: 'BOARDS_CALENDAR_PUSH_SECRET is not set — real-time calendar push is DISABLED; falling back to the 15-min poll. Set the env var (and an https public base URL) to enable webhook subscriptions.',
			});
			return;
		}
		if (!pushPublicBaseUrl().startsWith('https://')) {
			SystemLogger.warn({
				msg: 'Boards calendar push public base URL is not https — real-time calendar push is DISABLED; falling back to the poll. Set Boards_Calendar_Push_Public_Base_Url or BOARDS_CALENDAR_PUSH_PUBLIC_BASE_URL to a public https URL.',
			});
		}
	} catch {
		// settings not ready / non-fatal — the per-request gates still fail closed
	}
}, 10_000);
