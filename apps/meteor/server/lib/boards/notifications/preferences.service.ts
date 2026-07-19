import type { IUser, IBoardUserNotificationPrefs, BoardNotificationPreset, BoardNotificationAction } from '@rocket.chat/core-typings';
import { BoardsUserNotificationPrefs } from '@rocket.chat/models';
import type { IBoard } from '@rocket.chat/core-typings';

/**
 * Service for managing board notification preferences.
 * Handles CRUD, presets, board muting, and preference enforcement.
 */

export class BoardNotificationPrefsService {
	/**
	 * Get or create default notification preferences for a user.
	 */
	async getPreferences(userId: IUser['_id']): Promise<IBoardUserNotificationPrefs> {
		let prefs = await BoardsUserNotificationPrefs.findByUserId(userId);

		if (!prefs) {
			prefs = await BoardsUserNotificationPrefs.createDefaults(userId);
		}

		return prefs;
	}

	/**
	 * Update notification preferences for a user.
	 */
	async updatePreferences(
		userId: IUser['_id'],
		updates: Partial<Omit<IBoardUserNotificationPrefs, '_id' | 'userId' | 'createdAt' | '_updatedAt'>>,
	): Promise<IBoardUserNotificationPrefs | null> {
		// Ensure doc exists
		let prefs = await BoardsUserNotificationPrefs.findByUserId(userId);
		if (!prefs) {
			prefs = await BoardsUserNotificationPrefs.createDefaults(userId);
		}

		return BoardsUserNotificationPrefs.updatePrefs(userId, updates);
	}

	/**
	 * Set a notification preset (all, urgent_only, digest_only, silent).
	 */
	async setPreset(userId: IUser['_id'], preset: BoardNotificationPreset): Promise<IBoardUserNotificationPrefs | null> {
		return BoardsUserNotificationPrefs.setPreset(userId, preset);
	}

	/**
	 * Mute all notifications for a board.
	 */
	async muteBoard(userId: IUser['_id'], boardId: IBoard['_id']): Promise<IBoardUserNotificationPrefs | null> {
		return BoardsUserNotificationPrefs.muteBoard(userId, boardId);
	}

	/**
	 * Unmute notifications for a board.
	 */
	async unmuteBoard(userId: IUser['_id'], boardId: IBoard['_id']): Promise<IBoardUserNotificationPrefs | null> {
		return BoardsUserNotificationPrefs.unmuteBoard(userId, boardId);
	}

	/**
	 * Check if a board is muted for a user.
	 */
	async isBoardMuted(userId: IUser['_id'], boardId: IBoard['_id']): Promise<boolean> {
		return BoardsUserNotificationPrefs.isBoardMuted(userId, boardId);
	}

	/**
	 * Check if a notification should be sent based on user preferences.
	 * Returns an object with flags for each channel (inApp, email, push).
	 */
	async shouldNotify(
		userId: IUser['_id'],
		eventType: BoardNotificationAction,
		boardId: IBoard['_id'],
	): Promise<{ inApp: boolean; email: boolean; push: boolean }> {
		// Check if board is muted
		if (await this.isBoardMuted(userId, boardId)) {
			return { inApp: false, email: false, push: false };
		}

		// Get user preferences
		const prefs = await this.getPreferences(userId);

		// Return the preference for this event type
		return prefs.preferences[eventType] || { inApp: true, email: false, push: false };
	}

	/**
	 * Validate notification preferences object.
	 */
	validatePreferences(preferences: Record<BoardNotificationAction, any>): boolean {
		const validActions: BoardNotificationAction[] = ['assigned', 'mentioned', 'due_soon', 'approval_requested', 'stage_changed'];

		for (const action of validActions) {
			if (!preferences[action]) {
				return false;
			}

			const pref = preferences[action];
			if (typeof pref.inApp !== 'boolean' || typeof pref.email !== 'boolean' || typeof pref.push !== 'boolean') {
				return false;
			}
		}

		return true;
	}
}

// Export singleton instance
export const boardNotificationPrefsService = new BoardNotificationPrefsService();
