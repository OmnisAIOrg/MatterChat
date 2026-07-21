/**
 * Slack OAuth routes — the per-user "Connect Slack" redirect dance.
 *
 * Mirrors providers/teams/routes.ts + providers/google/routes.ts. Mounted at /_slack/oauth/* (the
 * path registered as the Slack app's Redirect URL):
 *
 *   GET /_slack/oauth/start    → resolve the signed-in MatterChat user (login-token cookie), mint
 *                                state, park the userId in CredentialTokens (TTL), set a one-time
 *                                HttpOnly state cookie, then redirect to
 *                                `https://slack.com/oauth/v2/authorize` with the USER scopes (sent
 *                                via `user_scope`, so we get a user token that acts AS the human).
 *   GET /_slack/oauth/callback → verify state (cookie + parked token), exchange code +
 *                                client_secret at `https://slack.com/api/oauth.v2.access`, read the
 *                                USER token from `authed_user.access_token` + the workspace from
 *                                `team.{id,name}`, persist a per-user IExternalWorkspaceConnection
 *                                (provider 'slack', status 'connected'), and bounce back to the app.
 *
 * Clean-room clone of the proven Teams/Google `/_omnisai` PKCE pattern: server-owned redirect dance,
 * state in CredentialTokens, serverFetch for the token exchange. NOTE: Slack's OAuth v2 does NOT
 * support PKCE, so there is no code_verifier/code_challenge — the client_secret authenticates the
 * token exchange. The CSRF binding is still the userId-bound parked state + one-time cookie.
 * Nothing under apps/meteor/ee/ was read.
 *
 * STANDALONE-SAFE: when Slack is disabled or unconfigured, `/start` refuses (redirects with an
 * error) and never reaches Slack.
 */
import { hashLoginToken } from '@rocket.chat/account-utils';
import { CredentialTokens, Users, ExternalWorkspaceConnections } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';
import { Meteor } from 'meteor/meteor';
import { Cookies } from 'meteor/ostrio:cookies';
// eslint-disable-next-line import/no-duplicates -- NOT a duplicate: eslint's resolver cannot see
// meteor/* packages and its autofix once MERGED this into the ostrio:cookies import, importing
// RoutePolicy from a package that does not export it — undefined at boot, RoutePolicy.declare
// crashed the whole server (2026-07-20). Keep these two imports separate.
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import {
	getSlackConfig,
	isSlackConfigured,
	SLACK_AUTHORIZE_ENDPOINT,
	SLACK_TOKEN_ENDPOINT,
	redirectUri,
	SLACK_USER_SCOPES,
} from './config';
import { SystemLogger } from '../../../../../server/lib/logger/system';
import { finishDesktopConnectorCallback, isDesktopAuthorizeRequest, isDesktopState } from '../../desktopOAuth';
import { encryptCredentials } from '../../tokenCrypto';

// NOTE: must NOT be under `/api/...` — Rocket.Chat's REST/Apps router owns `/api/*` and shadows
// custom connect-handlers there (→ 404). Mirror the working `/_teams/` + `/_google/` OAuth routes.
const ROUTE_PREFIX = '/_slack/oauth';
const STATE_COOKIE = 'slack_oauth_state';

// Read-only cookie helper (the vendored ostrio:cookies server class ignores constructor cookie
// input, so — like the Teams/Google routes — we read via get(name, rawCookieHeader)).
const cookieReader = new Cookies();
const readCookie = (req: any, name: string): string | undefined => cookieReader.get(name, req.headers?.cookie);

const stateKey = (state: string): string => `slack:state:${state}`;

/** A `Set-Cookie` value that expires the one-time state cookie (used on every callback exit). */
function clearStateCookie(): string {
	return `${STATE_COOKIE}=; Path=${ROUTE_PREFIX}; Max-Age=0; SameSite=Lax; HttpOnly`;
}

/**
 * Bounce back to the app's connectors UI with a result/error flag, clearing the one-time state
 * cookie on the way out.
 */
function done(res: any, params: Record<string, string>, desktop = false): void {
	// DESKTOP: hand back to the app via `matterchat://oauth/slack?status=...` (status only, never a
	// token) with the "Return to MatterChat" interstitial fallback (spec §A.4). Success vs error is the
	// presence of the `slack_error` param.
	if (desktop) {
		const isError = typeof params.slack_error === 'string';
		return finishDesktopConnectorCallback(res, 'slack', isError ? 'error' : 'ok', params.slack_error, {
			'Set-Cookie': clearStateCookie(),
		});
	}
	const qs = new URLSearchParams(params).toString();
	res.writeHead(302, { 'Location': Meteor.absoluteUrl(`home?${qs}`), 'Set-Cookie': clearStateCookie() });
	res.end();
}

function fail(res: any, reason: string, extra: Record<string, string> = {}, desktop = false): void {
	SystemLogger.warn({ msg: 'Slack OAuth failed', reason });
	done(res, { slack_error: reason, ...extra }, desktop);
}

/** Build a `Set-Cookie` header value with the given attributes. */
function buildSetCookie(
	name: string,
	value: string,
	opts: { maxAge?: number; httpOnly?: boolean; secure?: boolean; path?: string },
): string {
	const parts = [`${name}=${value}`];
	if (opts.path) {
		parts.push(`Path=${opts.path}`);
	}
	if (typeof opts.maxAge === 'number') {
		parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
	}
	// Lax so the cookie survives the top-level redirect back from Slack.
	parts.push('SameSite=Lax');
	if (opts.httpOnly) {
		parts.push('HttpOnly');
	}
	if (opts.secure) {
		parts.push('Secure');
	}
	return parts.join('; ');
}

/** Resolve the signed-in MatterChat user from the RC login-token cookie (expiry-safe lookup). */
async function resolveUserId(req: any): Promise<string | null> {
	const uid = readCookie(req, 'rc_uid');
	const token = readCookie(req, 'rc_token');
	if (!uid || !token) {
		return null;
	}
	const user = await Users.findOneByIdAndLoginToken(uid, hashLoginToken(token), { projection: { _id: 1 } });
	return user?._id ?? null;
}

// ─── authorize URL (shared) ────────────────────────────────────────────────────────────────────

/**
 * The reusable "mint state (bound to the userId) + build the Slack authorize URL" step, factored out
 * of `/start` so the AUTHENTICATED `connectors:getAuthorizeUrl` Meteor method can reuse it without a
 * cookie. Same binding model as Teams/Google: the parked token is keyed by a server-minted random
 * state and bound to a userId with a short TTL; the callback falls back to it when the state cookie
 * is absent (method-based flow), and rejects a present-but-mismatched cookie.
 *
 * The USER scopes go in `user_scope` (NOT `scope`) so Slack issues a USER token that acts AS the
 * signed-in human — the token comes back under `authed_user.access_token` in the callback.
 *
 * Returns both the ready-to-redirect `authorizeUrl` and the `state`. Throws 'slack-not-configured'
 * when Slack is off/unconfigured.
 *
 * `desktop` (optional): when true, the callback hands the result back to the desktop app via the
 * `matterchat://` scheme. Carried TAMPER-PROOF in the server-side parked state doc, never a query
 * param (spec §A.4).
 */
export async function buildSlackAuthorizeUrl(userId: string, desktop = false): Promise<{ authorizeUrl: string; state: string }> {
	if (!isSlackConfigured()) {
		throw new Error('slack-not-configured');
	}
	if (!userId) {
		throw new Error('not_authenticated');
	}

	const config = getSlackConfig();
	const state = Random.id();

	// Park the owner userId (+ the desktop flag) server-side, keyed by state (TTL via CredentialTokens).
	// This binds the callback to THIS user without trusting a cookie, and makes the desktop flag
	// tamper-proof. (No PKCE verifier — Slack OAuth v2 uses the client_secret at the token endpoint.)
	await CredentialTokens.create(stateKey(state), { profile: { userId, desktop } });

	const url = new URL(SLACK_AUTHORIZE_ENDPOINT);
	url.searchParams.set('client_id', config.clientId);
	// USER scopes (not bot scopes) → a user token that reads/posts AS the human.
	url.searchParams.set('user_scope', SLACK_USER_SCOPES.join(','));
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('state', state);

	return { authorizeUrl: url.toString(), state };
}

// ─── /start ──────────────────────────────────────────────────────────────────────────────────

async function handleStart(req: any, res: any): Promise<void> {
	// Desktop hand-off: the desktop shell opens this in the system browser with `?client=desktop`.
	// Read it FIRST so even the pre-auth refusals below hand back to the app via `matterchat://`.
	const desktop = isDesktopAuthorizeRequest(req.url);

	if (!isSlackConfigured()) {
		return fail(res, 'not_configured', {}, desktop);
	}

	const userId = await resolveUserId(req);
	if (!userId) {
		return fail(res, 'not_authenticated', {}, desktop);
	}

	const { authorizeUrl, state } = await buildSlackAuthorizeUrl(userId, desktop);

	// One-time HttpOnly state cookie set in the same redirect (CSRF defence — mirrors Teams/Google).
	// Lax + 10-min Max-Age survives the Slack consent round-trip.
	const setCookie = buildSetCookie(STATE_COOKIE, state, {
		httpOnly: true,
		secure: Meteor.absoluteUrl().startsWith('https://'),
		path: ROUTE_PREFIX,
		maxAge: 600000,
	});
	res.writeHead(302, { 'Location': authorizeUrl, 'Set-Cookie': setCookie });
	res.end();
}

// ─── /callback ───────────────────────────────────────────────────────────────────────────────

async function handleCallback(req: any, res: any): Promise<void> {
	const config = getSlackConfig();
	try {
		const url = new URL(req.url, 'http://localhost');
		const error = url.searchParams.get('error');
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');

		// Read the one-time state cookie (cleared on every exit via done()/fail()).
		const cookieState = readCookie(req, STATE_COOKIE);

		// Peek the parked state doc up-front (read-only; consumed below) to recover the TAMPER-PROOF
		// desktop flag so even the early error exits hand back via the `matterchat://` scheme.
		const peekDoc = state ? await CredentialTokens.findOneNotExpiredById(stateKey(state)) : null;
		const desktop = isDesktopState(peekDoc?.userInfo?.profile?.desktop);

		// Slack returned an error (e.g. the user declined consent → `access_denied`).
		if (error) {
			if (state) {
				await CredentialTokens.removeById(stateKey(state));
			}
			return fail(res, `oauth_${error}`, {}, desktop);
		}

		if (!code || !state) {
			return fail(res, 'missing_code_or_state', {}, desktop);
		}

		// Verify state. When a cookie IS present it MUST match (CSRF defence for the cookie `/start`
		// flow). A MISSING cookie is allowed (the method-based flow can't set one): the binding falls
		// back to the parked token, which is server-minted, userId-bound, and short-TTL. A
		// PRESENT-but-mismatched cookie is always rejected.
		if (cookieState && cookieState !== state) {
			return fail(res, 'state_cookie_mismatch', {}, desktop);
		}
		const stateDoc = await CredentialTokens.findOneNotExpiredById(stateKey(state));
		await CredentialTokens.removeById(stateKey(state));
		const userId = stateDoc?.userInfo?.profile?.userId;
		if (!userId) {
			return fail(res, 'invalid_state', {}, desktop);
		}

		// Exchange the code (+ client secret) for tokens. Slack's oauth.v2.access is
		// application/x-www-form-urlencoded and returns HTTP 200 with `{ ok:false }` on logical errors.
		const tokenRes = await fetch(SLACK_TOKEN_ENDPOINT, {
			ignoreSsrfValidation: true, // Slack token host, not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: redirectUri(),
			}).toString(),
		});

		const tokens: any = await tokenRes.json().catch(() => ({}));
		// Slack reports failures via `ok:false` (HTTP 200) — surface, don't swallow.
		if (!tokens?.ok) {
			return fail(res, `token_exchange_${tokens?.error || tokenRes.status}`, {}, desktop);
		}

		// The USER token lives under authed_user.access_token (we requested user_scope). The top-level
		// access_token is the bot token — NOT what we want for acting AS the human.
		const authedUser = tokens.authed_user || {};
		const userAccessToken = authedUser.access_token;
		if (!userAccessToken) {
			// No user token means user_scope wasn't granted — the connection would be useless.
			return fail(res, 'no_user_token', {}, desktop);
		}

		// The workspace (team) is the external org id/name.
		const team = tokens.team || {};
		const externalOrgId = String(team.id || tokens.team_id || '');
		const externalOrgName = team.name ? `Slack (${team.name})` : 'Slack';
		// Slack echoes the granted user scopes as a comma-separated string on authed_user.scope.
		const grantedScopes =
			typeof authedUser.scope === 'string' && authedUser.scope ? authedUser.scope.split(',').filter(Boolean) : SLACK_USER_SCOPES;

		if (!externalOrgId) {
			return fail(res, 'no_team_id', {}, desktop);
		}

		// Encrypt the token and persist the per-user connection (status 'connected'). Slack user tokens
		// (without token rotation) don't expire, so there's no refresh token / expiry to store.
		const credentials = encryptCredentials({
			accessToken: userAccessToken,
			externalOrgId,
			externalSlackUserId: authedUser.id || undefined,
		});

		const { _id } = await ExternalWorkspaceConnections.upsertUserConnection(userId, 'slack', externalOrgId, {
			externalOrgName,
			status: 'connected',
			scopes: grantedScopes,
			credentials,
			lastSyncAt: new Date(),
		});

		SystemLogger.info({ msg: 'Slack connection established', userId, connectionId: _id, externalOrgId });
		return done(res, { slack_connected: '1', connectionId: _id }, desktop);
	} catch (err) {
		SystemLogger.error({ msg: 'Slack OAuth callback error', err: String(err) });
		return fail(res, 'callback_exception');
	}
}

// ─── mount ───────────────────────────────────────────────────────────────────────────────────

RoutePolicy.declare(`${ROUTE_PREFIX}/`, 'network');

WebApp.connectHandlers.use(ROUTE_PREFIX, async (req: any, res: any, next: () => void) => {
	try {
		// connect strips the mount prefix, so req.url here is '/start' | '/callback' (+ query).
		const path = new URL(req.url, 'http://localhost').pathname;
		if (path === '/start' || path.endsWith('/start')) {
			return await handleStart(req, res);
		}
		if (path === '/callback' || path.endsWith('/callback')) {
			return await handleCallback(req, res);
		}
		return next();
	} catch (err) {
		SystemLogger.error({ msg: 'Slack OAuth route error', err: String(err) });
		return fail(res, 'route_exception');
	}
});
