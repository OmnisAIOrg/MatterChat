import type { IBoardUserNotificationPrefs, BoardNotificationPreset } from '@rocket.chat/core-typings';
import type { IBaseModel } from './IBaseModel';
import type { IUser } from '@rocket.chat/core-typings';
import type { IBoard } from '@rocket.chat/core-typings';

export interface IBoardUserNotificationPrefsModel extends IBaseModel<IBoardUserNotificationPrefs> {
	/**
	 * Find notification preferences for a user.
	 * Returns defaults if no prefs exist yet.
	 */
	findByUserId(userId: IUser['_id']): Promise<IBoardUserNotificationPrefs | null>;

	/**
	 * Create default notification preferences for a user.
	 */
	createDefaults(userId: IUser['_id']): Promise<IBoardUserNotificationPrefs>;

	/**
	 * Update user's notification preferences (partial update).
	 */
	updatePrefs(
		userId: IUser['_id'],
		updates: Partial<Omit<IBoardUserNotificationPrefs, '_id' | 'userId' | 'createdAt' | '_updatedAt'>>,
	): Promise<IBoardUserNotificationPrefs | null>;

	/**
	 * Set the notification preset for a user (e.g., 'all', 'urgent_only', 'silent').
	 * Automatically updates the preferences matrix based on the preset.
	 */
	setPreset(userId: IUser['_id'], preset: BoardNotificationPreset): Promise<IBoardUserNotificationPrefs | null>;

	/**
	 * Mute all notifications for a board.
	 */
	muteBoard(userId: IUser['_id'], boardId: IBoard['_id']): Promise<IBoardUserNotificationPrefs | null>;

	/**
	 * Unmute notifications for a board.
	 */
	unmuteBoard(userId: IUser['_id'], boardId: IBoard['_id']): Promise<IBoardUserNotificationPrefs | null>;

	/**
	 * Check if a board is muted for a user.
	 */
	isBoardMuted(userId: IUser['_id'], boardId: IBoard['_id']): Promise<boolean>;
}
