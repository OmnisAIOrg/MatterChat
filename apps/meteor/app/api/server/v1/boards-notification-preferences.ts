import type { IUser } from '@rocket.chat/core-typings';
import { Router } from '@rocket.chat/core-services';
import { BoardsUserNotificationPrefs } from '@rocket.chat/models';
import {
	isBoardsUserNotificationPrefsGetProps,
	isBoardsUserNotificationPrefsUpdateProps,
	isBoardsUserNotificationPrefsBoardMuteProps,
	isBoardsUserNotificationPrefsTestProps,
} from '@rocket.chat/rest-typings';
import { boardNotificationPrefsService } from '../../../server/lib/boards/notifications/preferences.service';

/**
 * GET /api/v1/boards.user.notification-preferences
 * Fetch the authenticated user's notification preferences.
 */
Router.get('/api/v1/boards.user.notification-preferences', {
	authRequired: true,
	validateParams: isBoardsUserNotificationPrefsGetProps,
	action: async (req, res) => {
		try {
			const userId = (req.user as IUser)._id;

			const preferences = await boardNotificationPrefsService.getPreferences(userId);

			return res.success({ preferences });
		} catch (error: any) {
			return res.fail({ error: error.message });
		}
	},
});

/**
 * PUT /api/v1/boards.user.notification-preferences
 * Update the authenticated user's notification preferences.
 * Can update preset, preferences matrix, muted boards, or digest settings.
 */
Router.put('/api/v1/boards.user.notification-preferences', {
	authRequired: true,
	validateParams: isBoardsUserNotificationPrefsUpdateProps,
	action: async (req, res) => {
		try {
			const userId = (req.user as IUser)._id;
			const { preset, preferences, mutedBoards, digestFrequency, digestTime } = req.body;

			// If preset is provided, set it and ignore preferences
			if (preset) {
				const updated = await boardNotificationPrefsService.setPreset(userId, preset);
				if (!updated) {
					return res.fail({ error: 'Failed to update preferences' });
				}
				return res.success({ success: true, updated });
			}

			// Otherwise, do a partial update
			const updates: any = {};

			if (preferences) {
				if (!boardNotificationPrefsService.validatePreferences(preferences)) {
					return res.fail({ error: 'Invalid preferences structure' });
				}
				updates.preferences = preferences;
			}

			if (mutedBoards !== undefined) {
				updates.mutedBoards = mutedBoards;
			}

			if (digestFrequency) {
				updates.digestFrequency = digestFrequency;
			}

			if (digestTime) {
				updates.digestTime = digestTime;
			}

			const updated = await boardNotificationPrefsService.updatePreferences(userId, updates);

			if (!updated) {
				return res.fail({ error: 'Failed to update preferences' });
			}

			return res.success({ success: true, updated });
		} catch (error: any) {
			return res.fail({ error: error.message });
		}
	},
});

/**
 * PUT /api/v1/boards.user.notification-preferences.board-mute
 * Mute or unmute notifications for a specific board.
 */
Router.put('/api/v1/boards.user.notification-preferences.board-mute', {
	authRequired: true,
	validateParams: isBoardsUserNotificationPrefsBoardMuteProps,
	action: async (req, res) => {
		try {
			const userId = (req.user as IUser)._id;
			const { boardId, mute } = req.body;

			let updated;
			if (mute) {
				updated = await boardNotificationPrefsService.muteBoard(userId, boardId);
			} else {
				updated = await boardNotificationPrefsService.unmuteBoard(userId, boardId);
			}

			if (!updated) {
				return res.fail({ error: 'Failed to update board mute status' });
			}

			return res.success({ success: true, mutedBoards: updated.mutedBoards });
		} catch (error: any) {
			return res.fail({ error: error.message });
		}
	},
});

/**
 * POST /api/v1/boards.user.notification-preferences.test
 * Send a test notification to verify user preferences are working.
 * Returns which channels would be used for the given event type.
 */
Router.post('/api/v1/boards.user.notification-preferences.test', {
	authRequired: true,
	validateParams: isBoardsUserNotificationPrefsTestProps,
	action: async (req, res) => {
		try {
			const userId = (req.user as IUser)._id;
			const { eventType, boardId } = req.body;

			// If no boardId provided, use a dummy board ID to check preferences
			const testBoardId = boardId || 'test-board-id';

			// Check what channels would notify for this event type
			const sent = await boardNotificationPrefsService.shouldNotify(userId, eventType, testBoardId);

			// TODO: In a real implementation, actually send test notifications here
			// For now, just return what would be sent

			return res.success({
				success: true,
				sent: {
					inApp: sent.inApp,
					email: sent.email,
					push: sent.push,
				},
			});
		} catch (error: any) {
			return res.fail({ error: error.message });
		}
	},
});
