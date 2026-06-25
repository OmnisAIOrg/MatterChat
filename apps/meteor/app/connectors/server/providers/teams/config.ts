/**
 * Microsoft Teams connector configuration — read from admin settings ONLY.
 *
 * Nothing here is hardcoded except the Graph base + the OAuth path segments. The client id /
 * tenant id / authority / secret all come from the `Teams_*` settings group (defaults registered
 * in apps/meteor/server/settings/teams.ts). The secret defaults to EMPTY and is masked — the
 * founder pastes it in admin. `isTeamsConfigured()` is the standalone-safe gate: false when the
 * connector is disabled or no secret is set, so the authorize route and provider no-op cleanly.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3.1.
 */
import { Meteor } from 'meteor/meteor';

import { settings } from '../../../../settings/server';

/** Microsoft Graph v1.0 base URL — the only Graph host the provider talks to. */
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Delegated Graph scopes requested at authorize time. DELEGATED (act as the signed-in user), not
 * application — so messages post as the real human (spec §3.1). `offline_access` is mandatory to
 * receive a refresh token; `openid profile email` give us the id_token (we read `tid` + `sub`).
 */
export const TEAMS_DELEGATED_SCOPES = [
	'Team.ReadBasic.All',
	'Channel.ReadBasic.All',
	'ChannelMessage.Read.All',
	'ChannelMessage.Send',
	'Chat.ReadWrite',
	'offline_access',
	'openid',
	'profile',
	'email',
];

export type TeamsConfig = {
	enabled: boolean;
	clientId: string;
	tenantId: string;
	clientSecret: string;
	authority: string;
};

/** Read the live Teams config from settings. */
export function getTeamsConfig(): TeamsConfig {
	return {
		enabled: Boolean(settings.get('Teams_Enabled')),
		clientId: String(settings.get('Teams_OAuth_Client_Id') || '').trim(),
		tenantId: String(settings.get('Teams_OAuth_Tenant_Id') || '').trim(),
		clientSecret: String(settings.get('Teams_OAuth_Client_Secret') || '').trim(),
		// Strip a trailing slash so `${authority}/oauth2/...` is always well-formed.
		authority: String(settings.get('Teams_OAuth_Authority') || 'https://login.microsoftonline.com/organizations')
			.trim()
			.replace(/\/$/, ''),
	};
}

/**
 * STANDALONE-SAFE GATE. True only when the connector is enabled AND fully configured (client id +
 * secret + authority). The authorize route and the provider check this and no-op when false, so a
 * fresh MatterChat with Teams off (or no secret pasted yet) has zero Teams behavior.
 */
export function isTeamsConfigured(): boolean {
	const c = getTeamsConfig();
	return c.enabled && Boolean(c.clientId) && Boolean(c.clientSecret) && Boolean(c.authority);
}

export const authorizeEndpoint = (c: TeamsConfig): string => `${c.authority}/oauth2/v2.0/authorize`;
export const tokenEndpoint = (c: TeamsConfig): string => `${c.authority}/oauth2/v2.0/token`;

/**
 * The OAuth redirect URI. MUST match the Entra app registration EXACTLY:
 *   https://matterchat.stg-omnisai.io/api/apps/teamsbridge/oauth/callback
 * Built from the instance Site_Url so prod/staging/dev each produce their own registered URI; the
 * path segment is fixed to the registered value.
 */
export const TEAMS_REDIRECT_PATH = 'api/apps/teamsbridge/oauth/callback';
export const redirectUri = (): string => Meteor.absoluteUrl(TEAMS_REDIRECT_PATH);

/**
 * The admin-consent request URL. When a tenant admin hasn't granted the read scopes, point the
 * user's admin here once to grant tenant-wide consent for our multi-tenant app (spec §3.2). Uses
 * the v2 admin-consent endpoint on the same authority.
 */
export const adminConsentUrl = (c: TeamsConfig): string => {
	const url = new URL(`${c.authority}/v2.0/adminconsent`);
	url.searchParams.set('client_id', c.clientId);
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('scope', TEAMS_DELEGATED_SCOPES.join(' '));
	return url.toString();
};
