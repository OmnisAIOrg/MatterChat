/**
 * Slack OAuth v2 routes — the per-user "Connect Slack" redirect dance.
 *
 * Mounted at  /_slack/oauth/*  (the path registered as the Slack app redirect URI):
 *
 *   GET /_slack/oauth/start    → resolve the signed-in MatterChat user (login-token cookie), mint
 *                                state, park the owner userId in CredentialTokens (TTL), set a
 *                                one-time HttpOnly state cookie, then redirect to
 *                                https://slack.com/oauth/v2/authorize with the USER scopes in
 *                                `user_scope` + the redirect_uri + state.
 *   GET /_slack/oauth/callback → verify state (cookie + parked token), exchange the code at
 *                                https://slack.com/api/oauth.v2.access, read authed_user.access_token
 *                                (the USER token) + team.{id,name}, persist a per-user
 *                                IExternalWorkspaceConnection (provider 'slack', status 'connected'),
 *                                and bounce back to /home?slack_connected=1.
 *
 * SLACK v2 DIFFERENCES FROM TEAMS/GRAPH:
 *  - USER scopes go in `user_scope` (NOT `scope`).
 *  - PKCE is optional for Slack; state binding (mirroring Teams) is the CSRF defence we use.
 *  - The token exchange is form-encoded (code, client_id, client_secret, redirect_uri) and returns
 *    { ok, authed_user:{ id, access_token, scope }, team:{ id, name } }. The USER token is
 *    authed_user.access_token. Slack user tokens do NOT expire (no refresh flow).
 *  - On failure Slack returns ok:false + error — surfaced, not swallowed.
 *
 * Clean-room clone of the proven `/_teams/oauth` pattern (server-owned redirect dance, state in
 * CredentialTokens, serverFetch for the token exchange). Nothing under apps/meteor/ee/ was read.
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
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { SystemLogger } from '../../../../../server/lib/logger/system';
import { encryptCredentials } from '../../tokenCrypto';
import { getSlackConfig, isSlackConfigured, redirectUri, SLACK_AUTHORIZE_ENDPOINT, SLACK_TOKEN_ENDPOINT } from './config';

// NOTE: must NOT be under `/api/...` — Rocket.Chat's REST/Apps router owns `/api/*` and shadows
// custom connect-handlers there (→ 404). Mirror the working `/_teams/` OAuth routes.
const ROUTE_PREFIX = '/_slack/oauth';
const STATE_COOKIE = 'slack_oauth_state';

// Read-only cookie helper (the vendored ostrio:cookies server class ignores constructor cookie
// input, so — like the Teams routes — we read via get(name, rawCookieHeader) and write Set-Cookie
// directly on the response).
const cookieReader = new Cookies();
const readCookie = (req: any, name: string): string | undefined => cookieReader.get(name, req.headers?.cookie);

const stateKey = (state: string): string => `slack:state:${state}`;

/** A `Set-Cookie` value that expires the one-time state cookie (used on every callback exit). */
function clearStateCookie(): string {
	return `${STATE_COOKIE}=; Path=${ROUTE_PREFIX}; Max-Age=0; SameSite=Lax; HttpOnly`;
}

/**
 * Bounce back to the app's connectors UI with a result/error flag (the rail reads it), clearing the
 * one-time state cookie on the way out. Lands on /home (a page that EXISTS) with
 * slack_connected=1 / slack_error=<reason> in the URL.
 */
function done(res: any, params: Record<string, string>): void {
	const qs = new URLSearchParams(params).toString();
	res.writeHead(302, { Location: Meteor.absoluteUrl(`home?${qs}`), 'Set-Cookie': clearStateCookie() });
	res.end();
}

function fail(res: any, reason: string, extra: Record<string, string> = {}): void {
	SystemLogger.warn({ msg: 'Slack OAuth failed', reason });
	done(res, { slack_error: reason, ...extra });
}

/** Build a `Set-Cookie` header value with the given attributes. */
function buildSetCookie(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean; secure?: boolean; path?: string }): string {
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
 * The reusable "park state (bound to the userId) + build the Slack authorize URL" step, factored out
 * of `/start` so the AUTHENTICATED `connectors:getAuthorizeUrl` Meteor method can reuse it without a
 * cookie. The state cookie is the one-time CSRF binding for the COOKIE-based `/start` flow; the
 * method-based flow doesn't set it (it has no response to write a cookie on), and the callback
 * degrades gracefully — it falls back to the parked token (which is bound to this userId) when the
 * state cookie is absent.
 *
 * Returns both the ready-to-redirect `authorizeUrl` and the `state` (so the cookie-based `/start`
 * can set its one-time state cookie). Throws 'slack-not-configured' when Slack is off/unconfigured.
 *
 * SLACK v2: USER scopes go in `user_scope` (NOT `scope`). PKCE is optional, so we omit it and rely on
 * state binding (the same CSRF defence Teams uses alongside PKCE).
 */
export async function buildSlackAuthorizeUrl(userId: string): Promise<{ authorizeUrl: string; state: string }> {
	if (!isSlackConfigured()) {
		throw new Error('slack-not-configured');
	}
	if (!userId) {
		throw new Error('not_authenticated');
	}

	const config = getSlackConfig();
	const state = Random.id();

	// Park the owner userId server-side, keyed by state (TTL via CredentialTokens). This is what binds
	// the callback to THIS user without trusting a cookie.
	await CredentialTokens.create(stateKey(state), { profile: { userId } });

	const url = new URL(SLACK_AUTHORIZE_ENDPOINT);
	url.searchParams.set('client_id', config.clientId);
	// USER scopes — Slack v2 reads these from `user_scope`, NOT `scope`.
	url.searchParams.set('user_scope', config.userScopes.join(','));
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('state', state);

	return { authorizeUrl: url.toString(), state };
}

// ─── /start ──────────────────────────────────────────────────────────────────────────────────

async function handleStart(req: any, res: any): Promise<void> {
	if (!isSlackConfigured()) {
		return fail(res, 'not_configured');
	}

	const userId = await resolveUserId(req);
	if (!userId) {
		return fail(res, 'not_authenticated');
	}

	const { authorizeUrl, state } = await buildSlackAuthorizeUrl(userId);

	// One-time HttpOnly state cookie set in the same redirect: the callback must present a state
	// matching BOTH this cookie and the parked token (CSRF defence). Lax + 10-min Max-Age survives the
	// Slack consent round-trip.
	const setCookie = buildSetCookie(STATE_COOKIE, state, {
		httpOnly: true,
		secure: Meteor.absoluteUrl().startsWith('https://'),
		path: ROUTE_PREFIX,
		maxAge: 600000,
	});
	res.writeHead(302, { Location: authorizeUrl, 'Set-Cookie': setCookie });
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

		// Slack returned an error (e.g. the user declined the request).
		if (error) {
			if (state) {
				await CredentialTokens.removeById(stateKey(state));
			}
			return fail(res, `oauth_${error}`);
		}

		if (!code || !state) {
			return fail(res, 'missing_code_or_state');
		}

		// Verify state. The cookie-based `/start` flow sets a one-time state cookie, so when a cookie IS
		// present it MUST match the returned state. The method-based `connectors:getAuthorizeUrl` flow
		// can't set a cookie, so a MISSING cookie is allowed: the binding falls back to the parked token
		// below (server-minted random state, bound to a userId, short TTL). A PRESENT-but-mismatched
		// cookie is always rejected.
		if (cookieState && cookieState !== state) {
			return fail(res, 'state_cookie_mismatch');
		}
		const stateDoc = await CredentialTokens.findOneNotExpiredById(stateKey(state));
		await CredentialTokens.removeById(stateKey(state));
		const userId = stateDoc?.userInfo?.profile?.userId;
		if (!userId) {
			return fail(res, 'invalid_state');
		}

		// Exchange the code for tokens (Slack OAuth v2 — form-encoded, no PKCE verifier).
		const tokenRes = await fetch(SLACK_TOKEN_ENDPOINT, {
			ignoreSsrfValidation: true, // slack.com — a fixed Slack host, not user input
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
		// Slack returns HTTP 200 with ok:false on logical failure — check the envelope, not the status.
		if (!tokens?.ok) {
			return fail(res, `token_exchange_${tokens?.error || tokenRes.status}`);
		}

		// The USER token lives at authed_user.access_token (NOT the top-level access_token, which would
		// be the bot token). We connect AS the user, so we persist the user token.
		const userToken: string = tokens?.authed_user?.access_token || '';
		if (!userToken) {
			return fail(res, 'no_user_token');
		}

		const teamId: string = tokens?.team?.id || '';
		const teamName: string = tokens?.team?.name || 'Slack';
		if (!teamId) {
			return fail(res, 'no_team_id');
		}

		// Granted USER scopes are echoed on authed_user.scope (csv); fall back to the requested set.
		const grantedScopes =
			typeof tokens?.authed_user?.scope === 'string' ? tokens.authed_user.scope.split(',').filter(Boolean) : config.userScopes;

		// Encrypt the USER token and persist the per-user connection (status 'connected'). Slack user
		// tokens do not expire, so there is no refreshToken/expiresAt to store.
		const credentials = encryptCredentials({
			accessToken: userToken,
			externalSlackUserId: tokens?.authed_user?.id,
			externalOrgId: teamId,
		});

		const { _id } = await ExternalWorkspaceConnections.upsertUserConnection(userId, 'slack', teamId, {
			externalOrgName: teamName,
			status: 'connected',
			scopes: grantedScopes,
			credentials,
			lastSyncAt: new Date(),
		});

		SystemLogger.info({ msg: 'Slack connection established', userId, connectionId: _id, teamId });
		return done(res, { slack_connected: '1', connectionId: _id });
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
