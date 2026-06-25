import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the Slack connector (per-user Slack OAuth v2 provider for the external-workspace
 * connector layer). Per-user USER-token OAuth: each MatterChat user connects their OWN Slack
 * workspace and reads/posts AS themselves.
 *
 * STANDALONE-SAFE: everything is off by default. With `Slack_Enabled=false` (default) or no client
 * secret configured, the provider is a no-op and the authorize route refuses to start — a fresh
 * MatterChat instance has no Slack-connector behavior until an admin opts in.
 *
 * NOTE: this is the NEW per-user Slack CONNECTOR (provider 'slack', /_slack/oauth). It is distinct
 * from the legacy workspace-level SlackBridge (admin token) under the SlackBridge settings group.
 *
 * Config provenance (Slack app registered by the founder; redirect
 * https://matterchat.stg-omnisai.io/_slack/oauth/callback):
 *  - Slack_OAuth_Client_Id      : the Slack app Client ID. NOT a secret — registered as a default so
 *                                 the connector works out of the box for THIS app.
 *  - Slack_OAuth_Client_Secret  : the Slack app client secret. MASKED + secret. Default EMPTY — the
 *                                 founder pastes it in admin later. Never hardcoded, never sent to
 *                                 clients.
 *  - Slack_OAuth_User_Scopes    : the comma-separated USER scopes requested at authorize time (they
 *                                 go in the Slack v2 `user_scope` param).
 *
 * USER scopes (sent by the authorize route as `user_scope`):
 *   channels:read groups:read channels:history groups:history chat:write users:read team:read
 */
export const createSlackSettings = () =>
	settingsRegistry.addGroup('Slack', async function () {
		// Master switch. Gates the authorize route + provider. Off by default (standalone principle).
		await this.add('Slack_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Slack_Enabled',
			i18nDescription: 'Slack_Enabled_Description',
		});

		// Slack app Client ID — NOT a secret. Default = the founder's registered Slack app.
		await this.add('Slack_OAuth_Client_Id', '7931694564787.11447444567381', {
			type: 'string',
			public: false,
			i18nLabel: 'Slack_OAuth_Client_Id',
			i18nDescription: 'Slack_OAuth_Client_Id_Description',
		});

		// Client secret — MASKED + secret. EMPTY by default; the founder pastes it in admin later.
		await this.add('Slack_OAuth_Client_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'Slack_OAuth_Client_Secret',
			i18nDescription: 'Slack_OAuth_Client_Secret_Description',
		});

		// USER token scopes (comma-separated). Sent in the Slack v2 `user_scope` authorize param.
		await this.add('Slack_OAuth_User_Scopes', 'channels:read,groups:read,channels:history,groups:history,chat:write,users:read,team:read', {
			type: 'string',
			public: false,
			i18nLabel: 'Slack_OAuth_User_Scopes',
			i18nDescription: 'Slack_OAuth_User_Scopes_Description',
		});
	});
