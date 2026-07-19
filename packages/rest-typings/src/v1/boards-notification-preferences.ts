import type { IBoardUserNotificationPrefs, BoardNotificationAction, BoardNotificationPreset } from '@rocket.chat/core-typings';
import { ajv } from './Ajv';

/**
 * REST validators + endpoint types for Boards NOTIFICATION PREFERENCES (Spec #4).
 * Per-user per-event-type by-channel settings for in-app/email/push notifications.
 *
 *   GET  boards.user.notification-preferences        — read user's pref matrix
 *   PUT  boards.user.notification-preferences        — update pref matrix
 *   PUT  boards.user.notification-preferences.board-mute — mute/unmute a board
 *   POST boards.user.notification-preferences.test   — send test notification
 */

const NOTIFICATION_ACTIONS = ['assigned', 'mentioned', 'due_soon', 'approval_requested', 'stage_changed'] as const;
const PRESETS = ['all', 'urgent_only', 'digest_only', 'silent'] as const;
const DIGEST_FREQUENCIES = ['daily', 'weekly'] as const;

// GET — no params
type BoardsUserNotificationPrefsGetProps = Record<string, never>;

const EmptyQuerySchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
};

export const isBoardsUserNotificationPrefsGetProps = ajv.compile<BoardsUserNotificationPrefsGetProps>(EmptyQuerySchema);

// PUT — update prefs
type BoardsUserNotificationPrefsUpdateProps = {
	preset?: BoardNotificationPreset;
	preferences?: Partial<Record<BoardNotificationAction, { inApp?: boolean; email?: boolean; push?: boolean }>>;
	mutedBoards?: string[];
	digestFrequency?: 'daily' | 'weekly';
	digestTime?: string;
};

const BoardsUserNotificationPrefsUpdateSchema = {
	type: 'object',
	properties: {
		preset: { type: 'string', enum: PRESETS as unknown as string[] },
		preferences: {
			type: 'object',
			additionalProperties: {
				type: 'object',
				properties: {
					inApp: { type: 'boolean' },
					email: { type: 'boolean' },
					push: { type: 'boolean' },
				},
				additionalProperties: false,
			},
		},
		mutedBoards: { type: 'array', items: { type: 'string' } },
		digestFrequency: { type: 'string', enum: DIGEST_FREQUENCIES as unknown as string[] },
		digestTime: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, // HH:MM format
	},
	required: [],
	additionalProperties: false,
};

export const isBoardsUserNotificationPrefsUpdateProps = ajv.compile<BoardsUserNotificationPrefsUpdateProps>(
	BoardsUserNotificationPrefsUpdateSchema,
);

// PUT — board mute toggle
type BoardsUserNotificationPrefsBoardMuteProps = {
	boardId: string;
	mute: boolean;
};

const BoardsUserNotificationPrefsBoardMuteSchema = {
	type: 'object',
	properties: {
		boardId: { type: 'string', minLength: 1 },
		mute: { type: 'boolean' },
	},
	required: ['boardId', 'mute'],
	additionalProperties: false,
};

export const isBoardsUserNotificationPrefsBoardMuteProps = ajv.compile<BoardsUserNotificationPrefsBoardMuteProps>(
	BoardsUserNotificationPrefsBoardMuteSchema,
);

// POST — send test notification
type BoardsUserNotificationPrefsTestProps = {
	eventType: BoardNotificationAction;
	boardId?: string;
};

const BoardsUserNotificationPrefsTestSchema = {
	type: 'object',
	properties: {
		eventType: { type: 'string', enum: NOTIFICATION_ACTIONS as unknown as string[] },
		boardId: { type: 'string', nullable: true },
	},
	required: ['eventType'],
	additionalProperties: false,
};

export const isBoardsUserNotificationPrefsTestProps = ajv.compile<BoardsUserNotificationPrefsTestProps>(
	BoardsUserNotificationPrefsTestSchema,
);

// Response DTO
export type BoardsUserNotificationPrefsDTO = IBoardUserNotificationPrefs;

// Endpoint map
export type BoardsNotificationPreferencesEndpoints = {
	'/v1/boards.user.notification-preferences': {
		GET: (params: BoardsUserNotificationPrefsGetProps) => { preferences: BoardsUserNotificationPrefsDTO };
	};
	'/v1/boards.user.notification-preferences': {
		PUT: (params: BoardsUserNotificationPrefsUpdateProps) => { success: boolean; updated: BoardsUserNotificationPrefsDTO };
	};
	'/v1/boards.user.notification-preferences.board-mute': {
		PUT: (params: BoardsUserNotificationPrefsBoardMuteProps) => { success: boolean; mutedBoards: string[] };
	};
	'/v1/boards.user.notification-preferences.test': {
		POST: (params: BoardsUserNotificationPrefsTestProps) => { success: boolean; sent: { inApp: boolean; email: boolean; push: boolean } };
	};
};
