/**
 * Boards notifications + subscriptions (M8). The delivery seam that closes the M7
 * NOTIFY-action gap and powers the Boards bell/inbox.
 *
 *  - `deliver`       — write `boards_notifications` rows per recipient (in-app inbox),
 *                      gated by `Boards_Notifications_InApp_Enabled`; email is the
 *                      digest cron's job, not inline. Self-contained (no RC core bell).
 *  - `subscriptions` — recipient resolution (assignees + watchers + subscribers),
 *                      auto-subscribe on engage, and explicit watch/unwatch.
 *
 * Mirrors the leads lib's `index.ts` re-export barrel so callers import from one place
 * (`../notifications`).
 */
export * from './deliver';
export * from './subscriptions';
