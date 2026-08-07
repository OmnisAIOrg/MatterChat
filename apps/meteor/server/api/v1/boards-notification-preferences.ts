import {
	isBoardsUserNotificationPrefsGetProps,
	isBoardsUserNotificationPrefsUpdateProps,
	isBoardsUserNotificationPrefsBoardMuteProps,
	isBoardsUserNotificationPrefsTestProps,
} from '@rocket.chat/rest-typings';

import { boardNotificationPrefsService } from '../../lib/boards/notifications/preferences.service';
import { API } from '../api';

/**
 * The authenticated user's Boards notification preferences.
 * Uses the standard RC API.v1.addRoute pattern (NOT the microservice Router) — every
 * handler reads this.userId / this.bodyParams and returns API.v1.success/failure. All
 * routes are self-scoped to the caller (no cross-user access).
 *
 *   GET boards.user.notification-preferences        — read my prefs
 *   PUT boards.user.notification-preferences        — set a preset OR partial-update the matrix
 */
API.v1.addRoute(
	'boards.user.notification-preferences',
	{ authRequired: true },
	{
		async get() {
			// GET carries no meaningful params; validate defensively for the contract.
			if (this.queryParams && !isBoardsUserNotificationPrefsGetProps(this.queryParams)) {
				return API.v1.failure('invalid-params');
			}
			const preferences = await boardNotificationPrefsService.getPreferences(this.userId);
			return API.v1.success({ preferences });
		},
		async put() {
			if (!isBoardsUserNotificationPrefsUpdateProps(this.bodyParams)) {
				return API.v1.failure('invalid-params');
			}
			const { preset, preferences, mutedBoards, digestFrequency, digestTime } = this.bodyParams as {
				preset?: 'all' | 'urgent_only' | 'digest_only' | 'silent' | 'default';
				preferences?: any;
				mutedBoards?: string[];
				digestFrequency?: string;
				digestTime?: string;
			};

			// A preset takes precedence and replaces the whole matrix.
			if (preset) {
				const updated = await boardNotificationPrefsService.setPreset(this.userId, preset);
				if (!updated) {
					return API.v1.failure('Failed to update preferences');
				}
				return API.v1.success({ success: true, updated });
			}

			const updates: Record<string, unknown> = {};
			if (preferences) {
				if (!boardNotificationPrefsService.validatePreferences(preferences)) {
					return API.v1.failure('Invalid preferences structure');
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

			const updated = await boardNotificationPrefsService.updatePreferences(this.userId, updates);
			if (!updated) {
				return API.v1.failure('Failed to update preferences');
			}
			return API.v1.success({ success: true, updated });
		},
	},
);

/**
 * PUT boards.user.notification-preferences.board-mute — mute/unmute one board for me.
 */
API.v1.addRoute(
	'boards.user.notification-preferences.board-mute',
	{ authRequired: true, validateParams: isBoardsUserNotificationPrefsBoardMuteProps },
	{
		async put() {
			const { boardId, mute } = this.bodyParams;
			const updated = mute
				? await boardNotificationPrefsService.muteBoard(this.userId, boardId)
				: await boardNotificationPrefsService.unmuteBoard(this.userId, boardId);
			if (!updated) {
				return API.v1.failure('Failed to update board mute status');
			}
			return API.v1.success({ success: true, mutedBoards: updated.mutedBoards });
		},
	},
);

/**
 * POST boards.user.notification-preferences.test — report which channels WOULD fire for an
 * event type under my current prefs (a dry-run; sends nothing).
 */
API.v1.addRoute(
	'boards.user.notification-preferences.test',
	{ authRequired: true, validateParams: isBoardsUserNotificationPrefsTestProps },
	{
		async post() {
			const { eventType, boardId } = this.bodyParams;
			const testBoardId = boardId || 'test-board-id';
			const sent = await boardNotificationPrefsService.shouldNotify(this.userId, eventType, testBoardId);
			return API.v1.success({
				success: true,
				sent: { inApp: sent.inApp, email: sent.email, push: sent.push },
			});
		},
	},
);
