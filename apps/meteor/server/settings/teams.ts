import { settingsRegistry } from '.';

/**
 * Settings for the Microsoft Teams connector (the greenfield Microsoft Graph provider for the
 * external-workspace connector layer). Per-user delegated OAuth: each MatterChat user connects
 * their OWN Teams identity and reads/posts AS themselves.
 *
 * STANDALONE-SAFE: everything is off by default. With `Teams_Enabled=false` (default) or no
 * client secret configured, the provider is a no-op and the authorize route refuses to start —
 * a fresh MatterChat instance has no Teams behavior until an admin opts in.
 *
 * Config provenance (Entra app registration created by the founder; multi-tenant, Web platform):
 *  - Teams_OAuth_Client_Id     : the Application (client) ID. NOT a secret — registered as a
 *                                default so the connector works out of the box for THIS app.
 *  - Teams_OAuth_Tenant_Id     : our app's home directory tenant id. Informational for a
 *                                multi-tenant app (we authorize against `/organizations`, not this
 *                                tenant) — kept for reference / future single-tenant lockdown.
 *  - Teams_OAuth_Authority     : the authority root the per-user OAuth runs against. Multi-tenant,
 *                                org accounts only → `/organizations` (NOT `/common`, NOT our tid).
 *  - Teams_OAuth_Client_Secret : the client secret. MASKED + secret. Default EMPTY — the founder
 *                                pastes it in admin later. Never hardcoded, never sent to clients.
 *
 * Delegated Graph scopes (sent by the authorize route):
 *   Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All ChannelMessage.Send
 *   Chat.ReadWrite offline_access openid profile email
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3 (the load-bearing Graph detail).
 */
export const createTeamsSettings = () =>
	settingsRegistry.addGroup('Teams', async function () {
		// Setup guide — read-only informational setting with step-by-step instructions.
		await this.add('Teams_Setup_Guide', '', {
			type: 'string',
			readonly: true,
			public: false,
			i18nLabel: 'Teams_Setup_Guide',
			i18nDescription: 'Teams_Setup_Guide_Description',
		});

		// Master switch. Gates the authorize route + provider. Off by default (standalone principle).
		await this.add('Teams_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Teams_Enabled',
			i18nDescription: 'Teams_Enabled_Description',
		});

		// Application (client) ID — NOT a secret. Default = the founder's registered multi-tenant app.
		await this.add('Teams_OAuth_Client_Id', '099f4168-d175-4716-9241-31431be6325e', {
			type: 'string',
			public: false,
			i18nLabel: 'Teams_OAuth_Client_Id',
			i18nDescription: 'Teams_OAuth_Client_Id_Description',
		});

		// Our app's home directory tenant id. Informational for the multi-tenant app (we authorize
		// against `/organizations`); kept for reference.
		await this.add('Teams_OAuth_Tenant_Id', '600ceefb-6b2a-49d3-9094-da429e0ffabd', {
			type: 'string',
			public: false,
			i18nLabel: 'Teams_OAuth_Tenant_Id',
			i18nDescription: 'Teams_OAuth_Tenant_Id_Description',
		});

		// Client secret — MASKED + secret. EMPTY by default; the founder pastes it in admin later.
		await this.add('Teams_OAuth_Client_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'Teams_OAuth_Client_Secret',
			i18nDescription: 'Teams_OAuth_Client_Secret_Description',
		});

		// OAuth authority root. Multi-tenant org accounts → `/organizations` (NOT `/common`).
		await this.add('Teams_OAuth_Authority', 'https://login.microsoftonline.com/organizations', {
			type: 'string',
			public: false,
			i18nLabel: 'Teams_OAuth_Authority',
			i18nDescription: 'Teams_OAuth_Authority_Description',
		});

		// PUBLIC base URL Microsoft Graph delivers change notifications to (the live message
		// bridge's inbound webhook). Empty (default) → TEAMS_WEBHOOK_PUBLIC_BASE_URL env → Site_Url.
		// The webhook additionally requires the env-only TEAMS_WEBHOOK_CLIENT_STATE_SECRET — with no
		// secret, webhook mode stays entirely off (fail-closed); this URL alone enables nothing.
		await this.add('Teams_Webhook_Public_Base_Url', '', {
			type: 'string',
			public: false,
			i18nLabel: 'Teams_Webhook_Public_Base_Url',
			i18nDescription: 'Teams_Webhook_Public_Base_Url_Description',
		});
	});
