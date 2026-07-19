import type { IBoardUserNotificationPrefs, BoardNotificationPreset, BoardNotificationAction } from '@rocket.chat/core-typings';
import type { IUser, IBoard } from '@rocket.chat/core-typings';
import { BaseRaw } from './BaseRaw';
import type { IBoardUserNotificationPrefsModel } from '@rocket.chat/model-typings';

export class BoardsUserNotificationPrefsRaw extends BaseRaw<IBoardUserNotificationPrefs> implements IBoardUserNotificationPrefsModel {
	constructor(db: any, trash?: any) {
		super(db, 'boards_user_notification_prefs', trash);
	}

	async findByUserId(userId: IUser['_id']): Promise<IBoardUserNotificationPrefs | null> {
		return this.findOne({ userId });
	}

	async createDefaults(userId: IUser['_id']): Promise<IBoardUserNotificationPrefs> {
		const defaultPrefs: Omit<IBoardUserNotificationPrefs, '_id' | '_updatedAt'> = {
			userId,
			preset: 'all',
			preferences: {
				assigned: { inApp: true, email: true, push: false },
				mentioned: { inApp: true, email: true, push: false },
				due_soon: { inApp: true, email: false, push: false },
				approval_requested: { inApp: true, email: true, push: false },
				stage_changed: { inApp: true, email: false, push: false },
			} as Record<BoardNotificationAction, any>,
			mutedBoards: [],
			digestFrequency: 'daily',
			digestTime: '08:00',
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		// The modern mongo driver's InsertOneResult has no `.ops`; read the inserted doc back.
		await this.insertOne(defaultPrefs as any);
		return (await this.findByUserId(userId))!;
	}

	async updatePrefs(
		userId: IUser['_id'],
		updates: Partial<Omit<IBoardUserNotificationPrefs, '_id' | 'userId'>>,
	): Promise<IBoardUserNotificationPrefs | null> {
		await this.updateOne(
			{ userId },
			{
				$set: {
					...updates,
					updatedAt: new Date(),
				},
			},
		);
		return this.findByUserId(userId);
	}

	async setPreset(userId: IUser['_id'], preset: BoardNotificationPreset): Promise<IBoardUserNotificationPrefs | null> {
		// Map preset to preferences matrix
		const presetPreferences = this.getPreferencesForPreset(preset);

		const updateData: any = {
			preset,
			preferences: presetPreferences,
			updatedAt: new Date(),
		};

		// Ensure document exists
		let doc = await this.findByUserId(userId);
		if (!doc) {
			doc = await this.createDefaults(userId);
		}

		await this.updateOne({ userId }, { $set: updateData });
		return this.findByUserId(userId);
	}

	private getPreferencesForPreset(preset: BoardNotificationPreset): Record<BoardNotificationAction, any> {
		const actions: BoardNotificationAction[] = ['assigned', 'mentioned', 'due_soon', 'approval_requested', 'stage_changed'];

		switch (preset) {
			case 'all':
				return actions.reduce((acc, action) => {
					acc[action] = { inApp: true, email: true, push: false };
					return acc;
				}, {} as any);

			case 'urgent_only':
				return actions.reduce((acc, action) => {
					// Only assigned and approval_requested are urgent
					if (action === 'assigned' || action === 'approval_requested') {
						acc[action] = { inApp: true, email: true, push: true };
					} else {
						acc[action] = { inApp: false, email: false, push: false };
					}
					return acc;
				}, {} as any);

			case 'digest_only':
				return actions.reduce((acc, action) => {
					acc[action] = { inApp: false, email: true, push: false };
					return acc;
				}, {} as any);

			case 'silent':
				return actions.reduce((acc, action) => {
					acc[action] = { inApp: false, email: false, push: false };
					return acc;
				}, {} as any);

			default:
				// Standard defaults for every action (in-app on, email/push off) — must cover
				// all BoardNotificationAction keys, not an empty object.
				return actions.reduce((acc, action) => {
					acc[action] = { inApp: true, email: false, push: false };
					return acc;
				}, {} as any);
		}
	}

	async muteBoard(userId: IUser['_id'], boardId: IBoard['_id']): Promise<IBoardUserNotificationPrefs | null> {
		const doc = await this.findByUserId(userId);
		if (!doc) {
			await this.createDefaults(userId);
		}

		await this.updateOne(
			{ userId },
			{
				$addToSet: { mutedBoards: boardId },
				$set: { updatedAt: new Date() },
			},
		);
		return this.findByUserId(userId);
	}

	async unmuteBoard(userId: IUser['_id'], boardId: IBoard['_id']): Promise<IBoardUserNotificationPrefs | null> {
		await this.updateOne(
			{ userId },
			{
				$pull: { mutedBoards: boardId },
				$set: { updatedAt: new Date() },
			},
		);
		return this.findByUserId(userId);
	}

	async isBoardMuted(userId: IUser['_id'], boardId: IBoard['_id']): Promise<boolean> {
		const count = await this.col.countDocuments({
			userId,
			mutedBoards: boardId,
		});
		return count > 0;
	}
}
