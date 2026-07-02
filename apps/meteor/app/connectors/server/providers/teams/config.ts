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
	// Chat.ReadWrite → read/post 1:1 + group DMs (listDirectChats / chat read+post).
	'Chat.ReadWrite',
	// TeamMember.Read.All → list team members across joined teams for the "People" section (listMembers).
	'TeamMember.Read.All',
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

/**
 * Read the live Teams config: admin setting first, `TEAMS_*` env var as the fallback.
 *
 * ENV FALLBACKS (mirrors the OmnisAI OIDC pattern in apps/meteor/app/omnisai-oauth/server/index.ts,
 * `settings.get(...) || process.env.OMNISAI_OIDC_*`): a k8s/ArgoCD deploy can carry the whole Teams
 * config — INCLUDING the client secret — as container env without an admin ever pasting it into
 * Mongo. The admin setting, when set, still wins (a live UI override). Secrets are env-or-admin
 * only; never committed, never defaulted.
 *
 *   Teams_Enabled              || TEAMS_ENABLED=true
 *   Teams_OAuth_Client_Id      || TEAMS_OAUTH_CLIENT_ID
 *   Teams_OAuth_Tenant_Id      || TEAMS_OAUTH_TENANT_ID
 *   Teams_OAuth_Client_Secret  || TEAMS_OAUTH_CLIENT_SECRET
 *   Teams_OAuth_Authority      || TEAMS_OAUTH_AUTHORITY   (default /organizations)
 *   (redirect URI)             || TEAMS_OAUTH_REDIRECT_URI (default Site_Url + /_teams/oauth/callback)
 */
export function getTeamsConfig(): TeamsConfig {
	const env = (name: string): string => String(process.env[name] || '').trim();
	const settingStr = (id: string): string => String(settings.get(id) || '').trim();
	return {
		enabled: Boolean(settings.get('Teams_Enabled')) || env('TEAMS_ENABLED') === 'true',
		clientId: settingStr('Teams_OAuth_Client_Id') || env('TEAMS_OAUTH_CLIENT_ID'),
		tenantId: settingStr('Teams_OAuth_Tenant_Id') || env('TEAMS_OAUTH_TENANT_ID'),
		clientSecret: settingStr('Teams_OAuth_Client_Secret') || env('TEAMS_OAUTH_CLIENT_SECRET'),
		// Strip a trailing slash so `${authority}/oauth2/...` is always well-formed.
		authority: (settingStr('Teams_OAuth_Authority') || env('TEAMS_OAUTH_AUTHORITY') || 'https://login.microsoftonline.com/organizations').replace(
			/\/$/,
			'',
		),
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
 *   https://matterchat.stg-omnisai.io/_teams/oauth/callback
 * NOTE: not under `/api/...` — Rocket.Chat's REST/Apps router owns `/api/*` and 404s custom routes
 * there. Built from the instance Site_Url so prod/staging/dev each produce their own registered URI.
 */
export const TEAMS_REDIRECT_PATH = '_teams/oauth/callback';
// `TEAMS_OAUTH_REDIRECT_URI` env override for deploys where the externally-registered URI differs
// from Site_Url (e.g. an ingress alias). Must STILL match the Entra registration exactly — the same
// value is sent in the authorize request AND the token exchange (both call this function).
export const redirectUri = (): string => String(process.env.TEAMS_OAUTH_REDIRECT_URI || '').trim() || Meteor.absoluteUrl(TEAMS_REDIRECT_PATH);

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
