import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the Slack connector (the Slack Web API provider for the external-workspace connector
 * layer). Per-user delegated OAuth: each MatterChat user connects their OWN Slack identity and
 * reads/posts AS themselves (USER scopes → a user token, not a bot token). Mirrors
 * server/settings/teams.ts + server/settings/google.ts.
 *
 * STANDALONE-SAFE: everything is off by default. With `Slack_Enabled=false` (default) or no client
 * secret configured, the provider is a no-op and the authorize route refuses to start — a fresh
 * MatterChat instance has no Slack behavior until an admin opts in.
 *
 * NOTE: this is a DISTINCT setting group from the legacy `SlackBridge_*` settings (the workspace-wide
 * admin-token bridge). This group drives the per-user external-workspace connector + the org-switcher
 * rail; they do not overlap.
 *
 * Config provenance (Slack app created by the founder; user-token OAuth, Web redirect):
 *  - Slack_OAuth_Client_Id     : the Slack app Client ID. NOT a secret — registered as a default so
 *                                the connector works out of the box for THIS app.
 *  - Slack_OAuth_Client_Secret : the client secret. MASKED + secret. Default EMPTY — the founder
 *                                pastes it in admin later. Never hardcoded, never sent to clients.
 *
 * Redirect URL (must match the Slack app's "Redirect URLs" EXACTLY):
 *   https://matterchat.stg-omnisai.io/_slack/oauth/callback
 *
 * Delegated USER scopes (sent by the authorize route via `user_scope`):
 *   channels:read groups:read channels:history groups:history chat:write users:read team:read
 *   im:read im:history mpim:read mpim:history
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.1 + §3 (Teams/Google are the proven siblings).
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

		// Signing secret — MASKED + secret. Authenticates every Events API delivery to
		// /_slack/events (v0 HMAC over the raw body). EMPTY by default — FAIL-CLOSED: with no
		// signing secret, inbound realtime stays entirely off (outbound + the reconcile poll keep
		// working). `SLACK_SIGNING_SECRET` env is the deploy-level fallback (setting wins when set;
		// same setting-then-env pattern as the Teams config fields).
		await this.add('Slack_Signing_Secret', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'Slack_Signing_Secret',
			i18nDescription: 'Slack_Signing_Secret_Description',
		});
	});
