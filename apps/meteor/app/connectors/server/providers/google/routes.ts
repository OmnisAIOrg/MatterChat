/**
 * Google Chat OAuth routes — the per-user "Connect Google Chat" redirect dance.
 *
 * Mirrors providers/teams/routes.ts. Mounted at /_google/oauth/* (the path registered as the Google
 * app's authorized redirect URI):
 *
 *   GET /_google/oauth/start    → resolve the signed-in MatterChat user (login-token cookie), mint
 *                                 PKCE (S256) + state, park the verifier + userId in CredentialTokens
 *                                 (TTL), set a one-time HttpOnly state cookie, then redirect to
 *                                 `https://accounts.google.com/o/oauth2/v2/auth` with the delegated
 *                                 scopes + access_type=offline + prompt=consent (so we GET a
 *                                 refresh_token).
 *   GET /_google/oauth/callback → verify state (cookie + parked token), exchange code + verifier +
 *                                 client_secret at `https://oauth2.googleapis.com/token`, read the
 *                                 id_token email/domain (externalOrgName = Workspace domain), persist
 *                                 a per-user IExternalWorkspaceConnection (provider 'google', status
 *                                 'connected'), and bounce back to the app.
 *
 * Clean-room clone of the proven Teams/`/_omnisai` PKCE pattern: server-owned redirect dance, PKCE
 * S256, state in CredentialTokens, serverFetch for the token exchange. Nothing under apps/meteor/ee/
 * was read.
 *
 * STANDALONE-SAFE: when Google Chat is disabled or unconfigured, `/start` refuses (redirects with an
 * error) and never reaches Google.
 */
import crypto from 'crypto';

import { hashLoginToken } from '@rocket.chat/account-utils';
import { CredentialTokens, Users, ExternalWorkspaceConnections } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';
import { Meteor } from 'meteor/meteor';
import { Cookies } from 'meteor/ostrio:cookies';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import {
	getGoogleConfig,
	isGoogleConfigured,
	GOOGLE_AUTHORIZE_ENDPOINT,
	GOOGLE_TOKEN_ENDPOINT,
	redirectUri,
	GOOGLE_DELEGATED_SCOPES,
} from './config';
import { SystemLogger } from '../../../../../server/lib/logger/system';
import { finishDesktopConnectorCallback, isDesktopAuthorizeRequest, isDesktopState } from '../../desktopOAuth';
import { encryptCredentials } from '../../tokenCrypto';

// NOTE: must NOT be under `/api/...` — Rocket.Chat's REST/Apps router owns `/api/*` and shadows
// custom connect-handlers there (→ 404). Mirror the working `/_teams/` OAuth routes.
const ROUTE_PREFIX = '/_google/oauth';
const STATE_COOKIE = 'google_oauth_state';

// Read-only cookie helper (the vendored ostrio:cookies server class ignores constructor cookie
// input, so — like the Teams route — we read via get(name, rawCookieHeader)).
const cookieReader = new Cookies();
const readCookie = (req: any, name: string): string | undefined => cookieReader.get(name, req.headers?.cookie);

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const stateKey = (state: string): string => `google:state:${state}`;

/** Decode a JWT's claims payload (no signature verify — the id_token came straight from the token
 * endpoint over TLS, not relayed by the user; mirrors the Teams rationale). */
function decodeJwtClaims(jwt: string): Record<string, any> {
	try {
		const payload = jwt.split('.')[1];
		const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
		return JSON.parse(json) as Record<string, any>;
	} catch {
		return {};
	}
}

/** A `Set-Cookie` value that expires the one-time state cookie (used on every callback exit). */
function clearStateCookie(): string {
	return `${STATE_COOKIE}=; Path=${ROUTE_PREFIX}; Max-Age=0; SameSite=Lax; HttpOnly`;
}

/**
 * Bounce back to the app's connectors UI with a result/error flag, clearing the one-time state
 * cookie on the way out.
 */
function done(res: any, params: Record<string, string>, desktop = false): void {
	// DESKTOP: hand back via `matterchat://oauth/google?status=...` (status only, never a token) with
	// the "Return to MatterChat" interstitial fallback (spec §A.4). Success vs error is the presence of
	// the `google_error` param.
	if (desktop) {
		const isError = typeof params.google_error === 'string';
		return finishDesktopConnectorCallback(res, 'google', isError ? 'error' : 'ok', params.google_error, {
			'Set-Cookie': clearStateCookie(),
		});
	}
	const qs = new URLSearchParams(params).toString();
	res.writeHead(302, { 'Location': Meteor.absoluteUrl(`home?${qs}`), 'Set-Cookie': clearStateCookie() });
	res.end();
}

function fail(res: any, reason: string, extra: Record<string, string> = {}, desktop = false): void {
	SystemLogger.warn({ msg: 'Google Chat OAuth failed', reason });
	done(res, { google_error: reason, ...extra }, desktop);
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
	// Lax so the cookie survives the top-level redirect back from Google.
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
 * The reusable "mint PKCE + park state (bound to the userId) + build the Google authorize URL" step,
 * factored out of `/start` so the AUTHENTICATED `connectors:getAuthorizeUrl` Meteor method can reuse
 * it without a cookie. Same binding model as Teams: the parked token is keyed by a server-minted
 * random state and bound to a userId with a short TTL; the callback falls back to it when the state
 * cookie is absent (method-based flow), and rejects a present-but-mismatched cookie.
 *
 * `access_type=offline` + `prompt=consent` are REQUIRED to receive a refresh_token from Google.
 *
 * Returns both the ready-to-redirect `authorizeUrl` and the `state`. Throws 'google-not-configured'
 * when Google Chat is off/unconfigured.
 *
 * `desktop` (optional): when true, the callback hands the result back to the desktop app via the
 * `matterchat://` scheme. Carried TAMPER-PROOF in the server-side parked state doc, never a query
 * param (spec §A.4).
 */
export async function buildGoogleAuthorizeUrl(userId: string, desktop = false): Promise<{ authorizeUrl: string; state: string }> {
	if (!isGoogleConfigured()) {
		throw new Error('google-not-configured');
	}
	if (!userId) {
		throw new Error('not_authenticated');
	}

	const config = getGoogleConfig();
	const state = Random.id();
	const codeVerifier = base64url(crypto.randomBytes(32));
	const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

	// Park the verifier + owner userId (+ the desktop flag) server-side, keyed by state (TTL via
	// CredentialTokens). This binds the callback to THIS user without trusting a cookie, and makes the
	// desktop flag tamper-proof.
	await CredentialTokens.create(stateKey(state), { profile: { codeVerifier, userId, desktop } });

	const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('scope', GOOGLE_DELEGATED_SCOPES.join(' '));
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	// access_type=offline + prompt=consent → Google returns a refresh_token (and re-prompts so we get
	// one even if the user already granted before).
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');
	url.searchParams.set('include_granted_scopes', 'true');

	return { authorizeUrl: url.toString(), state };
}

// ─── /start ──────────────────────────────────────────────────────────────────────────────────

async function handleStart(req: any, res: any): Promise<void> {
	// Desktop hand-off: the desktop shell opens this in the system browser with `?client=desktop`.
	// Read it FIRST so even the pre-auth refusals below hand back to the app via `matterchat://`.
	const desktop = isDesktopAuthorizeRequest(req.url);

	if (!isGoogleConfigured()) {
		return fail(res, 'not_configured', {}, desktop);
	}

	const userId = await resolveUserId(req);
	if (!userId) {
		return fail(res, 'not_authenticated', {}, desktop);
	}

	const { authorizeUrl, state } = await buildGoogleAuthorizeUrl(userId, desktop);

	// One-time HttpOnly state cookie set in the same redirect (CSRF defence — mirrors Teams). Lax +
	// 10-min Max-Age survives the Google consent round-trip.
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
	const config = getGoogleConfig();
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

		// Google returned an error (e.g. the user declined consent).
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
		const codeVerifier = stateDoc?.userInfo?.profile?.codeVerifier;
		const userId = stateDoc?.userInfo?.profile?.userId;
		if (!codeVerifier || !userId) {
			return fail(res, 'invalid_state', {}, desktop);
		}

		// Exchange the code (+ PKCE verifier + client secret) for tokens.
		const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
			ignoreSsrfValidation: true, // Google token host, not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				code_verifier: codeVerifier,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: redirectUri(),
			}).toString(),
		});

		const tokens: any = await tokenRes.json().catch(() => ({}));
		if (!tokenRes.ok || !tokens?.access_token) {
			return fail(res, `token_exchange_${tokenRes.status}`, {}, desktop);
		}

		// Read identity from the id_token (present via `openid email`). The Workspace domain is the
		// external org id/name; fall back to "Google Chat" for personal/consumer accounts (no domain).
		const claims = typeof tokens.id_token === 'string' ? decodeJwtClaims(tokens.id_token) : {};
		const email = String(claims.email || '');
		const domain = claims.hd || (email.includes('@') ? email.split('@')[1] : '') || '';
		const externalOrgId = domain || email || 'google';
		const externalOrgName = domain ? `Google Chat (${domain})` : 'Google Chat';
		const grantedScopes = typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : GOOGLE_DELEGATED_SCOPES;

		// Encrypt the tokens and persist the per-user connection (status 'connected').
		const credentials = encryptCredentials({
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : undefined,
			externalGoogleEmail: email || undefined,
		});

		const { _id } = await ExternalWorkspaceConnections.upsertUserConnection(userId, 'google', externalOrgId, {
			externalOrgName,
			status: 'connected',
			scopes: grantedScopes,
			credentials,
			lastSyncAt: new Date(),
		});

		SystemLogger.info({ msg: 'Google Chat connection established', userId, connectionId: _id, externalOrgId });
		return done(res, { google_connected: '1', connectionId: _id }, desktop);
	} catch (err) {
		SystemLogger.error({ msg: 'Google Chat OAuth callback error', err: String(err) });
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
		SystemLogger.error({ msg: 'Google Chat OAuth route error', err: String(err) });
		return fail(res, 'route_exception');
	}
});
