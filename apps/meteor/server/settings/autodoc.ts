import { settingsRegistry } from '.';
import { addOmnisConnectionSettings } from './omnis-product';

/**
 * AutoDoc document-intake settings.
 *
 * The seven connection settings are the shared Omnis set (see
 * `server/settings/omnis-product.ts`); everything below them exists for
 * auto-processing, which is the only part of this integration that spends money
 * without a human in the loop.
 *
 * `AutoDoc_Transport` defaults to `stub`, so a fresh MatterChat boots with a
 * working queue widget, drop zones, approve flow and receipts and no AutoDoc
 * credentials at all.
 */
export const createAutoDocSettings = () =>
	settingsRegistry.addGroup('AutoDoc', async function () {
		await addOmnisConnectionSettings(this, {
			product: 'AutoDoc',
			baseUrlPlaceholder: 'https://autodoc.stg-omnisai.io',
			webUrlPlaceholder: 'https://autodoc.omnisai.io',
		});

		await this.add('AutoDoc_Poll_Interval', 15, {
			type: 'int',
			public: false,
			i18nLabel: 'AutoDoc_Poll_Interval',
			i18nDescription: 'AutoDoc_Poll_Interval_Description',
		});

		await this.section('AutoDoc_Auto_Processing', async function () {
			await this.add('AutoDoc_Auto_Process_Max_MB', 25, {
				type: 'int',
				public: false,
				i18nLabel: 'AutoDoc_Auto_Process_Max_MB',
				i18nDescription: 'AutoDoc_Auto_Process_Max_MB_Description',
			});

			await this.add('AutoDoc_Auto_Process_Daily_Cap', 50, {
				type: 'int',
				public: false,
				i18nLabel: 'AutoDoc_Auto_Process_Daily_Cap',
				i18nDescription: 'AutoDoc_Auto_Process_Daily_Cap_Description',
			});
		});
	});
