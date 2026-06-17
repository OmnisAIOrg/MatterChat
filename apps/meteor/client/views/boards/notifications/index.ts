/**
 * Boards M8 — notifications client barrel.
 *
 * The NavBar bell (client/navbar/NavBarPagesGroup/NavBarItemBoardsNotifications.tsx)
 * renders <NotificationsInbox/> in a dropdown; the bell + inbox share the
 * react-query cache keys exported here so a markRead anywhere updates the badge.
 */
export { default as NotificationsInbox, NOTIFICATIONS_LIST_KEY, NOTIFICATIONS_UNREAD_KEY } from './NotificationsInbox';
export { notificationIcon, relativeTime } from './lib/presentation';
export type { ClientNotification } from './lib/presentation';
