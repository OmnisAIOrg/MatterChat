import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the Chi Admin Assistant — the in-app AI ops bot admins DM (@chi.bot) to execute
 * admin work (users, bulk users, channels, Slack provisioning, allowlisted settings). Engine:
 * server/lib/chi/admin/. Distinct from the /chi slash-command relay (CHI_API_URL env → the
 * external AI-Agents platform); this group is the BYO-LLM key the in-app assistant runs on.
 *
 * STANDALONE-SAFE: OFF by default, and inert until an API key is pasted. Non-admin senders are
 * refused at execution time regardless of these settings (tools re-check the admin role).
 */
export const createChiAssistantSettings = () =>
	settingsRegistry.addGroup('Chi_Assistant', async function () {
		await this.add('Chi_Assistant_Enabled', false, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Chi_Assistant_Enabled',
			i18nDescription: 'Chi_Assistant_Enabled_Description',
		});
		await this.add('Chi_Assistant_Provider', 'anthropic', {
			type: 'select',
			values: [
				{ key: 'anthropic', i18nLabel: 'Chi_Assistant_Provider_Anthropic' },
				{ key: 'openai', i18nLabel: 'Chi_Assistant_Provider_OpenAI' },
				{ key: 'cerebras', i18nLabel: 'Chi_Assistant_Provider_Cerebras' },
				{ key: 'groq', i18nLabel: 'Chi_Assistant_Provider_Groq' },
				{ key: 'openrouter', i18nLabel: 'Chi_Assistant_Provider_OpenRouter' },
				{ key: 'custom', i18nLabel: 'Chi_Assistant_Provider_Custom' },
			],
			public: false,
			i18nLabel: 'Chi_Assistant_Provider',
			i18nDescription: 'Chi_Assistant_Provider_Description',
		});
		await this.add('Chi_Assistant_API_Key', '', {
			type: 'password',
			secret: true,
			public: false,
			i18nLabel: 'Chi_Assistant_API_Key',
			i18nDescription: 'Chi_Assistant_API_Key_Description',
		});
		await this.add('Chi_Assistant_Model', '', {
			type: 'string',
			public: false,
			i18nLabel: 'Chi_Assistant_Model',
			i18nDescription: 'Chi_Assistant_Model_Description',
		});
		await this.add('Chi_Assistant_Base_URL', '', {
			type: 'string',
			public: false,
			i18nLabel: 'Chi_Assistant_Base_URL',
			i18nDescription: 'Chi_Assistant_Base_URL_Description',
		});
		await this.add('Chi_Assistant_Audit_Channel', 'chi-admin-audit', {
			type: 'string',
			public: false,
			i18nLabel: 'Chi_Assistant_Audit_Channel',
			i18nDescription: 'Chi_Assistant_Audit_Channel_Description',
		});
		await this.add('Chi_Assistant_Allow_Settings_Writes', false, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Chi_Assistant_Allow_Settings_Writes',
			i18nDescription: 'Chi_Assistant_Allow_Settings_Writes_Description',
		});
	});
