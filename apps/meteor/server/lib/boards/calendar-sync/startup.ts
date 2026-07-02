/**
 * Server startup entry for Boards two-way calendar sync + email-to-task (Phase 3).
 *
 * Importing this module mounts (side-effect):
 *   - the calendar OAuth routes  /_boards_calendar/:provider/oauth/{start,callback}  (./routes)
 *   - the email-to-task webhook  POST /_boards_email/inbound                          (./emailWebhook)
 *
 * Both mounts are SAFE AT BOOT even when the features are OFF: the route handlers check the gates
 * (isCalendarSyncEnabled / isEmailToTaskEnabled + the fail-closed secret) on every request and refuse
 * before any external call. The inbound POLL is a cron (cron/boardsCalendarSyncCron.ts); the outbound
 * PUSH runs both on that cron and on-demand via the syncNow REST endpoint. Imported from
 * apps/meteor/server/importPackages.ts alongside the other Boards modules.
 */
import './routes';
import './emailWebhook';
