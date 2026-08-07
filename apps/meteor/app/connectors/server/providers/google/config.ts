/**
 * Google Chat connector configuration — read from admin settings ONLY.
 *
 * Mirrors providers/teams/config.ts. Nothing is hardcoded except the Google API hosts + the OAuth
 * path segments. The client id / secret come from the `GoogleChat_*` settings group (defaults
 * registered in apps/meteor/server/settings/google.ts). The client id defaults to the founder's
 * registered "Internal" Google app id (NOT a secret); the secret defaults to EMPTY and is masked —
 * the founder pastes it in admin. `isGoogleConfigured()` is the standalone-safe gate: false when the
 * connector is disabled or no secret is set, so the authorize route and provider no-op cleanly.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3.1 (Teams is the proven sibling).
 */
import { Meteor } from 'meteor/meteor';

import { settings } from '../../../../../server/settings';

/** Google Chat REST v1 base URL — the only Chat host the provider talks to. */
export const CHAT_BASE = 'https://chat.googleapis.com/v1';

/** Google OAuth 2.0 authorize + token endpoints (fixed Google hosts, not user input). */
export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Delegated OAuth scopes requested at authorize time. DELEGATED (act as the signed-in user), not a
 * service account — so messages post AS the real human. `chat.spaces.readonly` lists spaces,
 * `chat.messages.readonly` reads messages, `chat.messages.create` posts, `chat.memberships.readonly`
 * lists a space's members (powers the "People" directory + names DMs by the other member); `openid
 * email` give us the id_token (we read the email/domain for the workspace name).
 */
export const GOOGLE_DELEGATED_SCOPES = [
	'https://www.googleapis.com/auth/chat.spaces.readonly',
	'https://www.googleapis.com/auth/chat.messages.readonly',
	'https://www.googleapis.com/auth/chat.messages.create',
	'https://www.googleapis.com/auth/chat.memberships.readonly',
	'openid',
	'email',
];

export type GoogleConfig = {
	enabled: boolean;
	clientId: string;
	clientSecret: string;
};

/** Read the live Google Chat config from settings. */
export function getGoogleConfig(): GoogleConfig {
	return {
		enabled: Boolean(settings.get('GoogleChat_Enabled')),
		clientId: String(settings.get('GoogleChat_OAuth_Client_Id') || '').trim(),
		clientSecret: String(settings.get('GoogleChat_OAuth_Client_Secret') || '').trim(),
	};
}

/**
 * STANDALONE-SAFE GATE. True only when the connector is enabled AND fully configured (client id +
 * secret). The authorize route and the provider check this and no-op when false, so a fresh
 * MatterChat with Google Chat off (or no secret pasted yet) has zero Google behavior.
 */
export function isGoogleConfigured(): boolean {
	const c = getGoogleConfig();
	return c.enabled && Boolean(c.clientId) && Boolean(c.clientSecret);
}

/**
 * The OAuth redirect URI. MUST match the Google app's "Authorized redirect URIs" EXACTLY:
 *   https://matterchat.stg-omnisai.io/_google/oauth/callback
 * NOTE: not under `/api/...` — Rocket.Chat's REST/Apps router owns `/api/*` and 404s custom routes
 * there. Built from the instance Site_Url so prod/staging/dev each produce their own registered URI.
 */
export const GOOGLE_REDIRECT_PATH = '_google/oauth/callback';
export const redirectUri = (): string => Meteor.absoluteUrl(GOOGLE_REDIRECT_PATH);
