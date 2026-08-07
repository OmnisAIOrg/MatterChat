import { settingsRegistry } from '.';

export const createBoardsSettings = () =>
	settingsRegistry.addGroup('Boards', async function () {
		await this.add('Boards_Enabled', true, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Boards_Enabled',
		});

		await this.add('Boards_SOL_Warning_Days', 60, {
			type: 'int',
			public: true,
			i18nLabel: 'Boards_SOL_Warning_Days',
		});

		await this.add('Boards_Default_Visibility', 'team', {
			type: 'select',
			public: true,
			i18nLabel: 'Boards_Default_Visibility',
			values: [
				{ key: 'private', i18nLabel: 'Private' },
				{ key: 'team', i18nLabel: 'Team' },
				{ key: 'shared', i18nLabel: 'Shared' },
			],
		});

		await this.add('Boards_Block_PII_Public_Sharing', true, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Boards_Block_PII_Public_Sharing',
		});
	});
