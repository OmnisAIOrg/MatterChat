/**
 * Slack connector configuration — read from admin settings ONLY.
 *
 * Mirrors providers/teams/config.ts + providers/google/config.ts. Nothing is hardcoded except the
 * Slack API host + the OAuth path segments. The client id / secret come from the `Slack_OAuth_*`
 * settings group (defaults registered in apps/meteor/server/settings/slack.ts). The client id
 * defaults to the founder's registered Slack app id (NOT a secret); the secret defaults to EMPTY
 * and is masked — the founder pastes it in admin. `isSlackConfigured()` is the standalone-safe gate:
 * false when the connector is disabled or no secret is set, so the authorize route and provider
 * no-op cleanly.
 *
 * PER-USER DELEGATED OAUTH. We request USER scopes (`user_scope`), so the token Slack returns acts
 * AS the signed-in human — `conversations.history`/`chat.postMessage` see/post as the real user,
 * not a bot. The user token comes back under `authed_user.access_token` (see slack/routes.ts), NOT
 * the top-level bot token.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.1 + §3 (Teams/Google are the proven siblings).
 */
import { Meteor } from 'meteor/meteor';

import { settings } from '../../../../../server/settings';

/** Slack Web API base URL — the only Slack host the provider talks to. */
export const SLACK_API_BASE = 'https://slack.com/api';

/** Slack OAuth v2 authorize + token endpoints (fixed Slack hosts, not user input). */
export const SLACK_AUTHORIZE_ENDPOINT = 'https://slack.com/oauth/v2/authorize';
export const SLACK_TOKEN_ENDPOINT = 'https://slack.com/api/oauth.v2.access';

/**
 * Delegated USER scopes requested at authorize time (sent via the `user_scope` param so we get a
 * user token, not a bot token). Acts AS the signed-in user — so reads/posts are as the real human.
 *  - channels:read / groups:read   → list public + private channels (conversations.list).
 *  - channels:history / groups:history → read channel messages (conversations.history).
 *  - chat:write                     → post messages AS the user (chat.postMessage).
 *  - users:read                     → list/resolve workspace members (users.list / users.info).
 *  - team:read                      → resolve the workspace (team) id + name (team.info).
 *  - im:read / im:history           → list + read 1:1 DMs.
 *  - mpim:read / mpim:history       → list + read group DMs (multi-person IMs).
 *  - channels:write / groups:write / im:write / mpim:write
 *                                   → mark conversations read AS the user (conversations.mark —
 *                                     the read-sync path, SlackProvider.markRead). Slack gates
 *                                     conversations.mark per conversation TYPE, so all four are
 *                                     needed for read-sync to cover channels + DMs.
 *
 * NOTE: users who connected BEFORE a scope was added hold a token WITHOUT it — Slack user tokens
 * only carry the scopes granted at authorize time. Calls needing a missing scope fail with
 * `slack_error:missing_scope` until the user reconnects the workspace.
 */
export const SLACK_USER_SCOPES = [
	'channels:read',
	'groups:read',
	'channels:history',
	'groups:history',
	'chat:write',
	'users:read',
	'team:read',
	'im:read',
	'im:history',
	'mpim:read',
	'mpim:history',
	'channels:write',
	'groups:write',
	'im:write',
	'mpim:write',
];

export type SlackConfig = {
	enabled: boolean;
	clientId: string;
	clientSecret: string;
};

/** Read the live Slack config from settings. */
export function getSlackConfig(): SlackConfig {
	return {
		enabled: Boolean(settings.get('Slack_Enabled')),
		clientId: String(settings.get('Slack_OAuth_Client_Id') || '').trim(),
		clientSecret: String(settings.get('Slack_OAuth_Client_Secret') || '').trim(),
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
 * The OAuth redirect URI. MUST match the Slack app's "Redirect URLs" EXACTLY:
 *   https://matterchat.stg-omnisai.io/_slack/oauth/callback
 * NOTE: not under `/api/...` — Rocket.Chat's REST/Apps router owns `/api/*` and 404s custom routes
 * there. Built from the instance Site_Url so prod/staging/dev each produce their own registered URI.
 */
export const SLACK_REDIRECT_PATH = '_slack/oauth/callback';
export const redirectUri = (): string => Meteor.absoluteUrl(SLACK_REDIRECT_PATH);

// ─── Events API endpoint (the live message bridge's inbound transport) ────────────────────────

/**
 * Events endpoint mount prefix — OUTSIDE /api (RC's REST/Apps router owns `/api/*` and 404s custom
 * connect-handlers there; mirrors the `/_slack/oauth` + `/_connectors/teams` mounting precedent).
 * Registered in the Slack app as Event Subscriptions → Request URL:
 *   https://<Site_Url host>/_slack/events
 */
export const SLACK_EVENTS_ROUTE_PREFIX = '/_slack/events';

/** Absolute URL to register as the Slack app's Event Subscriptions Request URL (docs/UI helper). */
export const slackEventsUrl = (): string => Meteor.absoluteUrl(SLACK_EVENTS_ROUTE_PREFIX.replace(/^\//, ''));

/**
 * The Slack app SIGNING SECRET that authenticates every Events API delivery (v0 HMAC over the raw
 * body — see eventsSecurity.verifySlackSignature). Admin setting first, `SLACK_SIGNING_SECRET` env
 * as the deploy-level fallback (same setting-then-env pattern as the Teams `getTeamsConfig`
 * fields: a k8s/ArgoCD deploy can carry it as container env without an admin pasting it into
 * Mongo; the admin setting, when set, still wins). Never committed, never defaulted.
 */
export function slackSigningSecret(): string {
	const fromSetting = String(settings.get('Slack_Signing_Secret') || '').trim();
	const fromEnv = String(process.env.SLACK_SIGNING_SECRET || '').trim();
	return fromSetting || fromEnv;
}

/**
 * FAIL-CLOSED events gate: true only when the Slack connector itself is configured AND the signing
 * secret is set. Without it, NO event payload is processed — bridges still work outbound (and the
 * reconcile poll still backfills); inbound realtime simply stays off until the admin provides the
 * signing secret. Unlike Teams/Graph there is NO per-channel subscription to create: the app-level
 * USER event subscription (message.channels + message.groups + message.im + message.mpim) covers
 * every conversation — channels AND direct chats — the connected user can see, so "subscribing" a
 * bridge is just recording the channel mapping.
 */
export function isSlackEventsConfigured(): boolean {
	return isSlackConfigured() && Boolean(slackSigningSecret());
}
