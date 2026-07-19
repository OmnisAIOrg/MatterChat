/**
 * Boards notifications + subscriptions (M8). The delivery seam that closes the M7
 * NOTIFY-action gap and powers the Boards bell/inbox + web push.
 *
 *  - `deliver`          — write `boards_notifications` rows per recipient (in-app inbox),
 *                         gated by `Boards_Notifications_InApp_Enabled`; also sends web
 *                         push (VAPID) per `Boards_Notifications_WebPush_Enabled`. Email
 *                         is the digest cron's job, not inline.
 *  - `subscriptions`    — recipient resolution (assignees + watchers + subscribers),
 *                         auto-subscribe on engage, and explicit watch/unwatch.
 *  - `formatters`       — board event → notification title/body (for in-app + web push).
 *  - `eventNotifications` — board event hooks → automatic notification delivery for
 *                         assignments, deadlines, mentions, approvals, stage changes.
 *
 * Mirrors the leads lib's `index.ts` re-export barrel so callers import from one place
 * (`../notifications`).
 */
export * from './deliver';
export * from './subscriptions';
export * from './formatters';
export * from './eventNotifications';
