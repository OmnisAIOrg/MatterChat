/**
 * Slack connector configuration — read from admin settings ONLY.
 *
 * Nothing here is hardcoded except the Slack API base + the OAuth path segments. The client id /
 * secret / user scopes all come from the `Slack_*` settings group (defaults registered in
 * apps/meteor/server/settings/slack.ts). The secret defaults to EMPTY and is masked — the founder
 * pastes it in admin. `isSlackConfigured()` is the standalone-safe gate: false when the connector
 * is disabled or no secret is set, so the authorize route and provider no-op cleanly.
 *
 * SLACK OAUTH v2 (NOT Microsoft Graph): per-user identity. Each MatterChat user OAuth-connects
 * their OWN Slack workspace and acts AS themselves with a USER token (authed_user.access_token).
 * USER scopes go in the `user_scope` authorize param (NOT `scope`). Slack user tokens do NOT
 * expire by default, so there is no refresh flow.
 *
 * Mirrors providers/teams/config.ts.
 */
import { Meteor } from 'meteor/meteor';

import { settings } from '../../../../settings/server';

/** Slack Web API base URL — the only Slack host the provider talks to. */
export const SLACK_API_BASE = 'https://slack.com/api';

/** Slack OAuth v2 authorize endpoint (user-token flow). */
export const SLACK_AUTHORIZE_ENDPOINT = 'https://slack.com/oauth/v2/authorize';

/** Slack OAuth v2 token-exchange endpoint. Returns { ok, authed_user, team }. */
export const SLACK_TOKEN_ENDPOINT = 'https://slack.com/api/oauth.v2.access';

/**
 * Default USER-token scopes requested at authorize time. USER scopes (the human acts as themselves)
 * — they go in the `user_scope` authorize param. read scopes for channels + history + identity, plus
 * chat:write so the user can post AS themselves in the read/post milestone.
 */
export const SLACK_USER_SCOPES = ['channels:read', 'groups:read', 'channels:history', 'groups:history', 'chat:write', 'users:read', 'team:read'];

export type SlackConfig = {
	enabled: boolean;
	clientId: string;
	clientSecret: string;
	userScopes: string[];
};

/** Read the live Slack config from settings. */
export function getSlackConfig(): SlackConfig {
	const rawScopes = String(settings.get('Slack_OAuth_User_Scopes') || '').trim();
	return {
		enabled: Boolean(settings.get('Slack_Enabled')),
		clientId: String(settings.get('Slack_OAuth_Client_Id') || '').trim(),
		clientSecret: String(settings.get('Slack_OAuth_Client_Secret') || '').trim(),
		// Comma-separated csv in settings → array; fall back to the built-in defaults if blank.
		userScopes: rawScopes
			? rawScopes
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: SLACK_USER_SCOPES,
	};
}

/**
 * STANDALONE-SAFE GATE. True only when the connector is enabled AND fully configured (client id +
 * secret). The authorize route and the provider check this and no-op when false, so a fresh
 * MatterChat with Slack off (or no secret pasted yet) has zero Slack behavior.
 */
export function isSlackConfigured(): boolean {
	const c = getSlackConfig();
	return c.enabled && Boolean(c.clientId) && Boolean(c.clientSecret);
}

/**
 * The OAuth redirect URI. MUST match the Slack app registration EXACTLY:
 *   https://matterchat.stg-omnisai.io/_slack/oauth/callback
 * NOTE: not under `/api/...` — Rocket.Chat's REST/Apps router owns `/api/*` and 404s custom routes
 * there. Built from the instance Site_Url so prod/staging/dev each produce their own registered URI.
 */
export const SLACK_REDIRECT_PATH = '_slack/oauth/callback';
export const redirectUri = (): string => Meteor.absoluteUrl(SLACK_REDIRECT_PATH);
