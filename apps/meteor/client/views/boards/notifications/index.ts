/**
 * Boards M8 — notifications client barrel.
 *
 * The /boards/inbox route (Activity on the AppLeftRail) renders
 * <NotificationsInbox/>; consumers share the react-query cache keys exported
 * here so a markRead anywhere updates every unread-count reader.
 */
export { default as NotificationsInbox, NOTIFICATIONS_LIST_KEY, NOTIFICATIONS_UNREAD_KEY } from './NotificationsInbox';
export { notificationIcon, relativeTime } from './lib/presentation';
export type { ClientNotification } from './lib/presentation';
