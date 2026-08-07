import {
	ajv,
	isBoardsNotificationsListProps,
	isBoardsNotificationsUnreadCountProps,
	isBoardsNotificationsMarkReadProps,
	isBoardsNotificationsMarkAllReadProps,
	isBoardsSubscriptionsListProps,
	isBoardsSubscriptionsWatchProps,
	isBoardsSubscriptionsUnwatchProps,
	validateBadRequestErrorResponse,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';
import type { BoardSubscriptionEvent } from '@rocket.chat/core-typings';
import { BoardsNotifications } from '@rocket.chat/models';

import { watch, unwatch, listWatches } from '../../lib/boards/notifications';
import { API } from '../api';
import { getPaginationItems } from '../lib/getPaginationItems';

/**
 * REST surface for Boards NOTIFICATIONS + SUBSCRIPTIONS (M8 — the in-app bell/inbox the
 * client renders, plus the watch model).
 *
 *   GET  boards.notifications.list        — inbox feed (read+unread, or unreadOnly), paginated + unread badge
 *   GET  boards.notifications.unreadCount — bell badge count
 *   POST boards.notifications.markRead    — flip one notification read
 *   POST boards.notifications.markAllRead — clear the unread set
 *   GET  boards.subscriptions.list        — the caller's watches
 *   POST boards.subscriptions.watch       — follow an entity
 *   POST boards.subscriptions.unwatch     — stop following
 *
 * Notifications + subscriptions are PER-USER: every model finder/mutator keys on the
 * caller's `userId`, so a user can only ever read/flip their OWN rows. There is therefore
 * no extra board permission on the notification endpoints (authRequired is the gate); the
 * watch/unwatch service additionally enforces board VISIBILITY (`assertBoardRole observer`).
 * Mirrors `boards-automations.ts`: permissive `successSchema`, `getPaginationItems` paging,
 * gating delegated to the service where it applies.
 */

const successSchema = ajv.compile<{ success: true }>({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: true,
});

// ---------------------------------------------------------------------------
// Notifications — reads
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.notifications.list',
	{
		authRequired: true,
		query: isBoardsNotificationsListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { offset, count } = await getPaginationItems(this.queryParams);
		const unreadOnly = this.queryParams.unreadOnly === 'true';

		const cursor = unreadOnly
			? BoardsNotifications.findUnreadByUser(userId, { skip: offset, limit: count })
			: BoardsNotifications.findByUser(userId, { skip: offset, limit: count });

		const [notifications, total, unread] = await Promise.all([
			cursor.toArray(),
			unreadOnly ? BoardsNotifications.countUnread(userId) : BoardsNotifications.col.countDocuments({ userId }),
			BoardsNotifications.countUnread(userId),
		]);

		return API.v1.success({ notifications, unread, count: notifications.length, offset, total });
	},
);

API.v1.get(
	'boards.notifications.unreadCount',
	{
		authRequired: true,
		query: isBoardsNotificationsUnreadCountProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const unread = await BoardsNotifications.countUnread(userId);
		return API.v1.success({ unread });
	},
);

// ---------------------------------------------------------------------------
// Notifications — mutations (owner-scoped via the model finders)
// ---------------------------------------------------------------------------

API.v1.post(
	'boards.notifications.markRead',
	{
		authRequired: true,
		body: isBoardsNotificationsMarkReadProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		// markRead is scoped by userId in the model, so a caller cannot flip another
		// user's notification (a non-matching id simply modifies nothing).
		await BoardsNotifications.markRead(userId, this.bodyParams.notificationId);
		return API.v1.success({ success: true });
	},
);

API.v1.post(
	'boards.notifications.markAllRead',
	{
		authRequired: true,
		body: isBoardsNotificationsMarkAllReadProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const result = await BoardsNotifications.markAllRead(userId);
		const modified = typeof (result as { modifiedCount?: number }).modifiedCount === 'number' ? (result as { modifiedCount: number }).modifiedCount : 0;
		return API.v1.success({ success: true, modified });
	},
);

// ---------------------------------------------------------------------------
// Subscriptions — list / watch / unwatch
// ---------------------------------------------------------------------------

API.v1.get(
	'boards.subscriptions.list',
	{
		authRequired: true,
		query: isBoardsSubscriptionsListProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const subscriptions = await listWatches(userId);
		return API.v1.success({ subscriptions, total: subscriptions.length });
	},
);

API.v1.post(
	'boards.subscriptions.watch',
	{
		authRequired: true,
		body: isBoardsSubscriptionsWatchProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { kind, id, boardId, events } = this.bodyParams;
		const result = await watch(userId, {
			kind,
			id,
			...(boardId ? { boardId } : {}),
			...(events ? { events: events as BoardSubscriptionEvent[] } : {}),
		});
		return API.v1.success(result);
	},
);

API.v1.post(
	'boards.subscriptions.unwatch',
	{
		authRequired: true,
		body: isBoardsSubscriptionsUnwatchProps,
		response: {
			200: successSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { kind, id, boardId } = this.bodyParams;
		const result = await unwatch(userId, { kind, id, ...(boardId ? { boardId } : {}) });
		return API.v1.success(result);
	},
);
