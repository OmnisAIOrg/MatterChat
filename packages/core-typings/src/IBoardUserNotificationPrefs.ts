import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';
import type { IBoard } from './IBoard';

/**
 * Per-user notification preferences for Boards events.
 * Stores event-type × channel preferences (in-app, email, push).
 * One row per user (mutable).
 *
 * Supports presets (all/urgent_only/digest_only/silent) for quick
 * configuration, plus granular overrides for each event type.
 */

export type BoardNotificationAction = 'assigned' | 'mentioned' | 'due_soon' | 'approval_requested' | 'stage_changed';

export type BoardNotificationPreset = 'all' | 'urgent_only' | 'digest_only' | 'silent';

export interface IBoardNotificationChannels {
	inApp: boolean;
	email: boolean;
	push: boolean;
}

export interface IBoardUserNotificationPrefs extends IRocketChatRecord {
	userId: IUser['_id'];

	// Event-type × channel matrix
	preferences: Record<BoardNotificationAction, IBoardNotificationChannels>;

	// Presets & bulk settings
	preset: BoardNotificationPreset; // 'silent' = all false

	// Per-board mutes (list of boardIds to ignore all notifications)
	mutedBoards: IBoard['_id'][];

	// Digest settings
	digestFrequency?: 'daily' | 'weekly'; // only used if preset = 'digest_only'
	digestTime?: string; // ISO time, e.g. "09:00", default "08:00"

	updatedAt: Date;
	createdAt: Date;
}
