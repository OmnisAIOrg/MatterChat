import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the Google Chat connector (the greenfield Google Chat REST provider for the
 * external-workspace connector layer). Per-user delegated OAuth: each MatterChat user connects
 * their OWN Google identity and reads/posts AS themselves. Mirrors server/settings/teams.ts.
 *
 * STANDALONE-SAFE: everything is off by default. With `GoogleChat_Enabled=false` (default) or no
 * client secret configured, the provider is a no-op and the authorize route refuses to start —
 * a fresh MatterChat instance has no Google Chat behavior until an admin opts in.
 *
 * Config provenance (Google Cloud OAuth client created by the founder; "Internal" consent, Web app):
 *  - GoogleChat_OAuth_Client_Id     : the OAuth 2.0 Client ID. NOT a secret — registered as a default
 *                                     so the connector works out of the box for THIS app.
 *  - GoogleChat_OAuth_Client_Secret : the client secret. MASKED + secret. Default EMPTY — the founder
 *                                     pastes it in admin later. Never hardcoded, never sent to clients.
 *
 * Authorized redirect URI (must match the Google app EXACTLY):
 *   https://matterchat.stg-omnisai.io/_google/oauth/callback
 *
 * Delegated OAuth scopes (sent by the authorize route):
 *   https://www.googleapis.com/auth/chat.spaces.readonly
 *   https://www.googleapis.com/auth/chat.messages.readonly
 *   https://www.googleapis.com/auth/chat.messages.create  openid email
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3 (Teams is the proven sibling).
 */
export const createGoogleSettings = () =>
	settingsRegistry.addGroup('GoogleChat', async function () {
		// Setup guide — read-only informational setting with step-by-step instructions.
		await this.add('GoogleChat_Setup_Guide', '', {
			type: 'string',
			readonly: true,
			public: false,
			i18nLabel: 'GoogleChat_Setup_Guide',
			i18nDescription: 'GoogleChat_Setup_Guide_Description',
		});

		// Master switch. Gates the authorize route + provider. Off by default (standalone principle).
		await this.add('GoogleChat_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'GoogleChat_Enabled',
			i18nDescription: 'GoogleChat_Enabled_Description',
		});

		// OAuth 2.0 Client ID — NOT a secret. Default = the founder's registered "Internal" Google app.
		await this.add('GoogleChat_OAuth_Client_Id', '107698894832-ckm2j4u1pa3nfsiv7uqqq3fesabl5sh8.apps.googleusercontent.com', {
			type: 'string',
			public: false,
			i18nLabel: 'GoogleChat_OAuth_Client_Id',
			i18nDescription: 'GoogleChat_OAuth_Client_Id_Description',
		});

		// Client secret — MASKED + secret. EMPTY by default; the founder pastes it in admin later.
		await this.add('GoogleChat_OAuth_Client_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'GoogleChat_OAuth_Client_Secret',
			i18nDescription: 'GoogleChat_OAuth_Client_Secret_Description',
		});
	});
