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
				{ key: 'xai', i18nLabel: 'Chi_Assistant_Provider_XAI' },
				{ key: 'deepseek', i18nLabel: 'Chi_Assistant_Provider_DeepSeek' },
				{ key: 'gemini', i18nLabel: 'Chi_Assistant_Provider_Gemini' },
				{ key: 'ollama', i18nLabel: 'Chi_Assistant_Provider_Ollama' },
				{ key: 'lmstudio', i18nLabel: 'Chi_Assistant_Provider_LMStudio' },
				{ key: 'llamacpp', i18nLabel: 'Chi_Assistant_Provider_LlamaCpp' },
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
		await this.add('Chi_STT_Provider', 'none', {
			type: 'select',
			values: [
				{ key: 'none', i18nLabel: 'Chi_STT_Provider_None' },
				{ key: 'openai', i18nLabel: 'Chi_Assistant_Provider_OpenAI' },
				{ key: 'groq', i18nLabel: 'Chi_Assistant_Provider_Groq' },
				{ key: 'custom', i18nLabel: 'Chi_Assistant_Provider_Custom' },
			],
			public: false,
			i18nLabel: 'Chi_STT_Provider',
			i18nDescription: 'Chi_STT_Provider_Description',
		});
		await this.add('Chi_STT_API_Key', '', {
			type: 'password',
			secret: true,
			public: false,
			i18nLabel: 'Chi_STT_API_Key',
			i18nDescription: 'Chi_STT_API_Key_Description',
		});
		await this.add('Chi_STT_Model', '', {
			type: 'string',
			public: false,
			i18nLabel: 'Chi_STT_Model',
			i18nDescription: 'Chi_STT_Model_Description',
		});
		await this.add('Chi_STT_Base_URL', '', {
			type: 'string',
			public: false,
			i18nLabel: 'Chi_STT_Base_URL',
			i18nDescription: 'Chi_STT_Base_URL_Description',
		});
		await this.add('Chi_MCP_Signing_Secret', '', {
			type: 'password',
			secret: true,
			public: false,
			i18nLabel: 'Chi_MCP_Signing_Secret',
			i18nDescription: 'Chi_MCP_Signing_Secret_Description',
		});
		await this.add('Chi_MCP_Enabled', false, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Chi_MCP_Enabled',
			i18nDescription: 'Chi_MCP_Enabled_Description',
		});
		await this.add('Chi_MCP_Servers', '', {
			type: 'code',
			code: 'application/json',
			multiline: true,
			public: false,
			secret: true,
			i18nLabel: 'Chi_MCP_Servers',
			i18nDescription: 'Chi_MCP_Servers_Description',
		});
		// ── Standalone-Chi auth bridge (POST /v1/chi.session-exchange) ──────────────────────────
		// OFF by default: it exposes an UNAUTHENTICATED (hard-verified, rate-limited) route that
		// trades a CentralizedAuth token for a MatterChat session — an admin opts the workspace in.
		await this.add('Chi_Session_Exchange_Enabled', false, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Chi_Session_Exchange_Enabled',
			i18nDescription: 'Chi_Session_Exchange_Enabled_Description',
		});
		await this.add('Chi_Session_Exchange_Client_Ids', '', {
			type: 'string',
			public: false,
			i18nLabel: 'Chi_Session_Exchange_Client_Ids',
			i18nDescription: 'Chi_Session_Exchange_Client_Ids_Description',
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

		// ── Realtime voice (talk ↔ Chi talks back, OpenAI Realtime API over WebRTC) ─────────────
		// The real API key never reaches the browser: the client fetches a short-lived ephemeral
		// token from /v1/chi.realtime-session (minted server-side with the key below).
		await this.add('Chi_Realtime_Voice_Enabled', false, {
			type: 'boolean',
			public: true, // the orb needs to know whether to offer the voice-call button
			i18nLabel: 'Chi_Realtime_Voice_Enabled',
			i18nDescription: 'Chi_Realtime_Voice_Enabled_Description',
		});
		await this.add('Chi_Realtime_API_Key', '', {
			type: 'password',
			secret: true,
			public: false,
			i18nLabel: 'Chi_Realtime_API_Key',
			i18nDescription: 'Chi_Realtime_API_Key_Description', // OpenAI key; falls back to Chi_Assistant_API_Key when the provider is OpenAI
		});
		await this.add('Chi_Realtime_Model', 'gpt-realtime', {
			type: 'string',
			public: false,
			i18nLabel: 'Chi_Realtime_Model',
			i18nDescription: 'Chi_Realtime_Model_Description',
		});
		await this.add('Chi_Realtime_Voice', 'alloy', {
			type: 'select',
			values: [
				{ key: 'alloy', i18nLabel: 'alloy' },
				{ key: 'ash', i18nLabel: 'ash' },
				{ key: 'ballad', i18nLabel: 'ballad' },
				{ key: 'coral', i18nLabel: 'coral' },
				{ key: 'echo', i18nLabel: 'echo' },
				{ key: 'sage', i18nLabel: 'sage' },
				{ key: 'shimmer', i18nLabel: 'shimmer' },
				{ key: 'verse', i18nLabel: 'verse' },
			],
			public: false,
			i18nLabel: 'Chi_Realtime_Voice',
			i18nDescription: 'Chi_Realtime_Voice_Description',
		});
	});
