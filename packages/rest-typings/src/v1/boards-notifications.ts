import type { IBoardNotification, IBoardSubscription } from '@rocket.chat/core-typings';

import { ajvQuery, ajv } from './Ajv';
import { type PaginatedRequest } from '../helpers/PaginatedRequest';

/**
 * REST validators + endpoint types for Boards NOTIFICATIONS + SUBSCRIPTIONS (M8 — the
 * in-app bell/inbox + watch model).
 *
 *   GET  boards.notifications.list        — the inbox feed (read+unread, or unreadOnly), paginated
 *   GET  boards.notifications.unreadCount — the bell badge count
 *   POST boards.notifications.markRead    — flip one notification read (owner-scoped)
 *   POST boards.notifications.markAllRead — clear the user's unread set
 *   GET  boards.subscriptions.list        — the caller's "things I follow"
 *   POST boards.subscriptions.watch       — follow a board/list/card/matter/lead
 *   POST boards.subscriptions.unwatch     — stop following
 *
 * Notifications + subscriptions are per-user (a row is private to its owner; the finders
 * key on `userId`), so there is no extra board permission on these endpoints beyond an
 * authenticated user — the watch/unwatch service additionally checks board VISIBILITY
 * (you can only follow what you can see). Mirrors `boards-automations.ts`: a permissive
 * `successSchema` on the route side, `ajvQuery` for query strings, `ajv` for POST bodies.
 */

// ---------------------------------------------------------------------------
// GET — notifications.list / notifications.unreadCount / subscriptions.list
// ---------------------------------------------------------------------------

type BoardsNotificationsListProps = PaginatedRequest<{ unreadOnly?: string }>;

const BoardsNotificationsListSchema = {
	type: 'object',
	properties: {
		count: { type: 'number', nullable: true },
		offset: { type: 'number', nullable: true },
		sort: { type: 'string', nullable: true },
		query: { type: 'string', nullable: true },
		unreadOnly: { type: 'string', nullable: true },
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsNotificationsListProps = ajvQuery.compile<BoardsNotificationsListProps>(BoardsNotificationsListSchema);

// unreadCount + subscriptions.list take no params; accept an empty query object.
type BoardsNotificationsUnreadCountProps = Record<string, never>;

const EmptyQuerySchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsNotificationsUnreadCountProps = ajvQuery.compile<BoardsNotificationsUnreadCountProps>(EmptyQuerySchema);

type BoardsSubscriptionsListProps = Record<string, never>;

export const isBoardsSubscriptionsListProps = ajvQuery.compile<BoardsSubscriptionsListProps>(EmptyQuerySchema);

// ---------------------------------------------------------------------------
// POST — notifications.markRead / notifications.markAllRead
// ---------------------------------------------------------------------------

type BoardsNotificationsMarkReadProps = { notificationId: string };

const BoardsNotificationsMarkReadSchema = {
	type: 'object',
	properties: { notificationId: { type: 'string', minLength: 1 } },
	required: ['notificationId'],
	additionalProperties: false,
};

export const isBoardsNotificationsMarkReadProps = ajv.compile<BoardsNotificationsMarkReadProps>(BoardsNotificationsMarkReadSchema);

type BoardsNotificationsMarkAllReadProps = Record<string, never>;

const EmptyBodySchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsNotificationsMarkAllReadProps = ajv.compile<BoardsNotificationsMarkAllReadProps>(EmptyBodySchema);

// ---------------------------------------------------------------------------
// POST — subscriptions.watch / subscriptions.unwatch
// ---------------------------------------------------------------------------

const TARGET_KINDS = ['board', 'list', 'card', 'matter', 'lead'] as const;

type BoardsSubscriptionsWatchProps = {
	kind: (typeof TARGET_KINDS)[number];
	id: string;
	/** required for matter/lead targets where the board is not derivable from the target id. */
	boardId?: string;
	/** narrow which event names notify this watcher; omit = all events. */
	events?: string[];
};

const BoardsSubscriptionsWatchSchema = {
	type: 'object',
	properties: {
		kind: { type: 'string', enum: TARGET_KINDS as unknown as string[] },
		id: { type: 'string', minLength: 1 },
		boardId: { type: 'string', nullable: true },
		events: { type: 'array', items: { type: 'string' }, nullable: true },
	},
	required: ['kind', 'id'],
	additionalProperties: false,
};

export const isBoardsSubscriptionsWatchProps = ajv.compile<BoardsSubscriptionsWatchProps>(BoardsSubscriptionsWatchSchema);

type BoardsSubscriptionsUnwatchProps = {
	kind: (typeof TARGET_KINDS)[number];
	id: string;
	boardId?: string;
};

const BoardsSubscriptionsUnwatchSchema = {
	type: 'object',
	properties: {
		kind: { type: 'string', enum: TARGET_KINDS as unknown as string[] },
		id: { type: 'string', minLength: 1 },
		boardId: { type: 'string', nullable: true },
	},
	required: ['kind', 'id'],
	additionalProperties: false,
};

export const isBoardsSubscriptionsUnwatchProps = ajv.compile<BoardsSubscriptionsUnwatchProps>(BoardsSubscriptionsUnwatchSchema);

// ---------------------------------------------------------------------------
// Endpoint map
// ---------------------------------------------------------------------------

export type BoardsNotificationsEndpoints = {
	'/v1/boards.notifications.list': {
		GET: (params: BoardsNotificationsListProps) => {
			notifications: IBoardNotification[];
			unread: number;
			count: number;
			offset: number;
			total: number;
		};
	};
	'/v1/boards.notifications.unreadCount': {
		GET: (params: BoardsNotificationsUnreadCountProps) => { unread: number };
	};
	'/v1/boards.notifications.markRead': {
		POST: (params: BoardsNotificationsMarkReadProps) => { success: boolean };
	};
	'/v1/boards.notifications.markAllRead': {
		POST: (params: BoardsNotificationsMarkAllReadProps) => { success: boolean; modified: number };
	};
	'/v1/boards.subscriptions.list': {
		GET: (params: BoardsSubscriptionsListProps) => { subscriptions: IBoardSubscription[]; total: number };
	};
	'/v1/boards.subscriptions.watch': {
		POST: (params: BoardsSubscriptionsWatchProps) => { subscribed: boolean; target: { kind: string; id: string }; boardId: string };
	};
	'/v1/boards.subscriptions.unwatch': {
		POST: (params: BoardsSubscriptionsUnwatchProps) => { unsubscribed: boolean; target: { kind: string; id: string } };
	};
};
