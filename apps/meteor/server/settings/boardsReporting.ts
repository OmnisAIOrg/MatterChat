import { settingsRegistry } from '.';

/**
 * Settings for Boards M8 — REPORTING + NOTIFICATIONS + AI.
 *
 * These back the three M8 capabilities that need org-level configuration; the
 * delivery + provider modules read them and DEGRADE GRACEFULLY when unset
 * (never throw): no SMTP / digest-off → email is skipped; provider 'none' or no
 * API key → ai.generate writes a "not configured" note instead of failing a run.
 *
 * Notifications:
 * - Boards_Notifications_InApp_Enabled  : master toggle for the in-app inbox/bell delivery.
 * - Boards_Notifications_WebPush_Enabled : master toggle for browser/PWA push (VAPID).
 * - Boards_Email_Digest_Enabled        : whether the periodic email digest of unread items is sent.
 * - Boards_Email_Digest_Schedule       : cron/time the digest cron fires (firm-local; see automation tz).
 *
 * AI (the ai.generate action + the demand/summary card buttons):
 * - Boards_AI_Provider     : which backend powers generation ('claude' direct | 'litdraft' via the
 *                            LitDraft service | 'none' = disabled). Default 'claude'.
 * - Boards_AI_Api_Key      : provider API key (secret). Empty → AI degrades to "not configured".
 * - Boards_AI_Model        : model id for the 'claude' provider. Default 'claude-opus-4-8'.
 * - Boards_AI_LitDraft_Url : base URL of the LitDraft service for the 'litdraft' provider.
 *
 * Mirrors createBoardsAutomationSettings (the addGroup/this.section/this.add idiom)
 * so the group auto-surfaces under Admin → Settings → Boards Reporting & AI.
 */
export const createBoardsReportingSettings = () =>
	settingsRegistry.addGroup('Boards_Reporting', async function () {
		await this.section('Notifications', async function () {
			await this.add('Boards_Notifications_InApp_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Boards_Notifications_InApp_Enabled',
				i18nDescription: 'Boards_Notifications_InApp_Enabled_Description',
			});

			await this.add('Boards_Notifications_WebPush_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Boards_Notifications_WebPush_Enabled',
				i18nDescription: 'Boards_Notifications_WebPush_Enabled_Description',
			});

			await this.add('Boards_Email_Digest_Enabled', false, {
				type: 'boolean',
				public: false,
				i18nLabel: 'Boards_Email_Digest_Enabled',
				i18nDescription: 'Boards_Email_Digest_Enabled_Description',
			});

			await this.add('Boards_Email_Digest_Schedule', '0 8 * * *', {
				type: 'string',
				public: false,
				i18nLabel: 'Boards_Email_Digest_Schedule',
				i18nDescription: 'Boards_Email_Digest_Schedule_Description',
				placeholder: '0 8 * * *',
				enableQuery: {
					_id: 'Boards_Email_Digest_Enabled',
					value: true,
				},
			});
		});

		await this.section('AI', async function () {
			await this.add('Boards_AI_Provider', 'claude', {
				type: 'select',
				public: false,
				i18nLabel: 'Boards_AI_Provider',
				i18nDescription: 'Boards_AI_Provider_Description',
				values: [
					{ key: 'claude', i18nLabel: 'Boards_AI_Provider_Claude' },
					{ key: 'litdraft', i18nLabel: 'Boards_AI_Provider_LitDraft' },
					{ key: 'none', i18nLabel: 'Boards_AI_Provider_None' },
				],
			});

			await this.add('Boards_AI_Api_Key', '', {
				type: 'string',
				public: false,
				secret: true,
				i18nLabel: 'Boards_AI_Api_Key',
				i18nDescription: 'Boards_AI_Api_Key_Description',
				enableQuery: {
					_id: 'Boards_AI_Provider',
					value: 'claude',
				},
			});

			await this.add('Boards_AI_Model', 'claude-opus-4-8', {
				type: 'string',
				public: false,
				i18nLabel: 'Boards_AI_Model',
				i18nDescription: 'Boards_AI_Model_Description',
				placeholder: 'claude-opus-4-8',
				enableQuery: {
					_id: 'Boards_AI_Provider',
					value: 'claude',
				},
			});

			await this.add('Boards_AI_LitDraft_Url', '', {
				type: 'string',
				public: false,
				i18nLabel: 'Boards_AI_LitDraft_Url',
				i18nDescription: 'Boards_AI_LitDraft_Url_Description',
				placeholder: 'https://litdraft.omnisai.io',
				enableQuery: {
					_id: 'Boards_AI_Provider',
					value: 'litdraft',
				},
			});
		});
	});
