import { settingsRegistry } from '.';
import { addOmnisConnectionSettings } from './omnis-product';
import { DEFAULT_BOT_NAME, DEFAULT_DISCLOSURE } from '../lib/casenotes/config';

/**
 * CaseNotes settings: the shared seven, plus the two consent settings.
 *
 * Both consent settings ship with a real default rather than an empty string,
 * because an empty disclosure would mean a recorder that announces nothing.
 * `dispatchBot` refuses to run without them, so a firm that clears these turns
 * the feature off rather than getting a silent bot.
 */
export const createCaseNotesSettings = () =>
	settingsRegistry.addGroup('CaseNotes', async function () {
		await addOmnisConnectionSettings(this, {
			product: 'CaseNotes',
			baseUrlPlaceholder: 'https://casenotes.stg-omnisai.io',
			webUrlPlaceholder: 'https://casenotes.omnisai.io',
		});

		await this.section('CaseNotes_Consent', async function () {
			await this.add('CaseNotes_Bot_Display_Name', DEFAULT_BOT_NAME, {
				type: 'string',
				public: true,
				i18nLabel: 'CaseNotes_Bot_Display_Name',
				i18nDescription: 'CaseNotes_Bot_Display_Name_Description',
			});

			await this.add('CaseNotes_Recording_Disclosure', DEFAULT_DISCLOSURE, {
				type: 'string',
				multiline: true,
				public: true,
				i18nLabel: 'CaseNotes_Recording_Disclosure',
				i18nDescription: 'CaseNotes_Recording_Disclosure_Description',
			});
		});
	});
