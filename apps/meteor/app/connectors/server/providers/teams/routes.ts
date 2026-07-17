/**
 * Microsoft Teams OAuth routes — the per-user "Connect Teams" redirect dance.
 *
 * Mounted at  /_teams/oauth/*  (the path registered as the Entra redirect URI):
 *
 *   GET /_teams/oauth/start    → resolve the signed-in MatterChat user (login-token
 *                                cookie), mint PKCE (S256) + state, park the verifier
 *                                + userId in CredentialTokens (60s TTL), set a
 *                                one-time HttpOnly state cookie, then redirect to
 *                                `${authority}/oauth2/v2.0/authorize` with the
 *                                delegated scopes + offline_access.
 *   GET /_teams/oauth/callback → verify state (cookie + parked token), exchange
 *                                code + verifier + client_secret at
 *                                `${authority}/oauth2/v2.0/token`, read the id_token
 *                                `tid` (external tenant) + `sub`, persist a per-user
 *                                IExternalWorkspaceConnection (status 'connected'),
 *                                and bounce back to the app. On admin-consent errors,
 *                                persist 'consent_required' + surface the admin URL.
 *
 * This is a clean-room clone of the proven `/_omnisai` PKCE pattern
 * (apps/meteor/app/omnisai-oauth/server/index.ts): server-owned redirect dance, PKCE S256, state
 * in CredentialTokens, serverFetch for the token exchange. Nothing under apps/meteor/ee/ was read.
 *
 * STANDALONE-SAFE: when Teams is disabled or unconfigured, `/start` refuses (redirects with an
 * error) and never reaches Microsoft.
 *
 * See MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.2 + §3.1.
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

import { SystemLogger } from '../../../../../server/lib/logger/system';
import { finishDesktopConnectorCallback, isDesktopAuthorizeRequest, isDesktopState } from '../../desktopOAuth';
import { encryptCredentials } from '../../tokenCrypto';
import {
	getTeamsConfig,
	isTeamsConfigured,
	authorizeEndpoint,
	tokenEndpoint,
	redirectUri,
	adminConsentUrl,
	TEAMS_DELEGATED_SCOPES,
} from './config';

// NOTE: must NOT be under `/api/...` — Rocket.Chat's REST/Apps router owns `/api/*` and shadows
// custom connect-handlers there (→ 404). Mirror the working `/_omnisai/` OAuth routes.
const ROUTE_PREFIX = '/_teams/oauth';
const STATE_COOKIE = 'teams_oauth_state';

// Read-only cookie helper (the vendored ostrio:cookies server class ignores constructor cookie
// input, so — like FileUpload.ts — we read via get(name, rawCookieHeader) and write Set-Cookie
// directly on the response to avoid the class's response-binding ambiguity).
const cookieReader = new Cookies();
const readCookie = (req: any, name: string): string | undefined => cookieReader.get(name, req.headers?.cookie);

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const stateKey = (state: string): string => `teams:state:${state}`;

/** Decode a JWT's claims payload (no signature verify — the id_token came straight from the token
 * endpoint over TLS, not relayed by the user; mirrors the `/_omnisai` rationale). */
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
 * Bounce back to the app's connectors UI with a result/error flag (the rail reads it), clearing
 * the one-time state cookie on the way out.
 */
function done(res: any, params: Record<string, string>, desktop = false): void {
	// DESKTOP: hand the result back to the app via the `matterchat://` scheme (status only, never a
	// token) with an HTML "Return to MatterChat" interstitial fallback (spec §A.4). The success vs
	// error distinction is the presence of the `teams_error` param.
	if (desktop) {
		const isError = typeof params.teams_error === 'string';
		return finishDesktopConnectorCallback(res, 'teams', isError ? 'error' : 'ok', params.teams_error, {
			'Set-Cookie': clearStateCookie(),
		});
	}
	const qs = new URLSearchParams(params).toString();
	// Land on a page that EXISTS. The dedicated /admin/external-workspaces UI is the next milestone;
	// until then bounce to home with the teams_connected=1 / teams_error=<reason> result in the URL.
	res.writeHead(302, { Location: Meteor.absoluteUrl(`home?${qs}`), 'Set-Cookie': clearStateCookie() });
	res.end();
}

function fail(res: any, reason: string, extra: Record<string, string> = {}, desktop = false): void {
	SystemLogger.warn({ msg: 'Teams OAuth failed', reason });
	done(res, { teams_error: reason, ...extra }, desktop);
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
	// Lax so the cookie survives the top-level redirect back from Microsoft.
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
 * The reusable "mint PKCE + park state (bound to the userId) + build the Microsoft authorize URL"
 * step, factored out of `/start` so the AUTHENTICATED `connectors:getAuthorizeUrl` Meteor method can
 * reuse it without a cookie. The state cookie is the one-time CSRF binding for the COOKIE-based
 * `/start` flow; the method-based flow doesn't set it (it has no response to write a cookie on), and
 * the callback degrades gracefully — it falls back to the parked token (which is bound to this
 * userId) when the state cookie is absent.
 *
 * Returns both the ready-to-redirect `authorizeUrl` and the `state` (so the cookie-based `/start`
 * can set its one-time state cookie). Throws 'teams-not-configured' when Teams is off/unconfigured.
 *
 * `desktop` (optional): when true, the callback will hand the result back to the desktop app via the
 * `matterchat://` scheme instead of the HTTPS landing. The flag is carried TAMPER-PROOF — stored in
 * the server-side parked state doc here, never echoed as a query param (spec §A.4).
 */
export async function buildTeamsAuthorizeUrl(userId: string, desktop = false): Promise<{ authorizeUrl: string; state: string }> {
	if (!isTeamsConfigured()) {
		throw new Error('teams-not-configured');
	}
	if (!userId) {
		throw new Error('not_authenticated');
	}

	const config = getTeamsConfig();
	const state = Random.id();
	const codeVerifier = base64url(crypto.randomBytes(32));
	const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

	// Park the verifier + owner userId (+ the desktop flag) server-side, keyed by state (TTL via
	// CredentialTokens). This is what binds the callback to THIS user without trusting a cookie, and
	// what makes the desktop flag tamper-proof (it lives only in this server-side doc).
	await CredentialTokens.create(stateKey(state), { profile: { codeVerifier, userId, desktop } });

	const url = new URL(authorizeEndpoint(config));
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('response_mode', 'query');
	url.searchParams.set('scope', TEAMS_DELEGATED_SCOPES.join(' '));
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');

	return { authorizeUrl: url.toString(), state };
}

// ─── /start ──────────────────────────────────────────────────────────────────────────────────

async function handleStart(req: any, res: any): Promise<void> {
	// Desktop hand-off: the desktop shell opens this in the system browser with `?client=desktop`.
	// Read it FIRST so even the pre-auth refusals below hand back to the app via `matterchat://`
	// instead of stranding the desktop user on an HTTPS error page in the system browser.
	const desktop = isDesktopAuthorizeRequest(req.url);

	if (!isTeamsConfigured()) {
		return fail(res, 'not_configured', {}, desktop);
	}

	const userId = await resolveUserId(req);
	if (!userId) {
		return fail(res, 'not_authenticated', {}, desktop);
	}

	const { authorizeUrl, state } = await buildTeamsAuthorizeUrl(userId, desktop);

	// One-time HttpOnly state cookie set in the same redirect: the callback must present a state
	// matching BOTH this cookie and the parked token (CSRF defence — mirrors the spec's "bind to
	// userId + a one-time cookie"). Lax + 10-min Max-Age survives the Microsoft consent round-trip.
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
	const config = getTeamsConfig();
	try {
		const url = new URL(req.url, 'http://localhost');
		const error = url.searchParams.get('error');
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');

		// Read the one-time state cookie (cleared on every exit via done()/fail()).
		const cookieState = readCookie(req, STATE_COOKIE);

		// Peek the parked state doc up-front (read-only; consumed later) to recover the TAMPER-PROOF
		// desktop flag — it lives only here, never in a query param — so even the early error exits hand
		// back to the desktop app via the `matterchat://` scheme rather than dead-ending on HTTPS.
		const peekDoc = state ? await CredentialTokens.findOneNotExpiredById(stateKey(state)) : null;
		const desktop = isDesktopState(peekDoc?.userInfo?.profile?.desktop);

		// Microsoft returned an error (e.g. the user/admin declined consent).
		if (error) {
			// Resolve the owner (from the still-valid parked token) so we can record consent_required.
			const ownerId = peekDoc?.userInfo?.profile?.userId;
			if (state) {
				await CredentialTokens.removeById(stateKey(state));
			}
			// "consent_required" / "interaction_required" → admin hasn't granted the read scopes.
			if ((error === 'consent_required' || error === 'interaction_required' || error === 'access_denied') && ownerId) {
				return fail(res, 'consent_required', { admin_consent_url: adminConsentUrl(config) }, desktop);
			}
			return fail(res, `oauth_${error}`, {}, desktop);
		}

		if (!code || !state) {
			return fail(res, 'missing_code_or_state', {}, desktop);
		}

		// Verify state. The cookie-based `/start` flow sets a one-time state cookie, so when a cookie
		// IS present it MUST match the returned state (CSRF defence for that flow). The method-based
		// `connectors:getAuthorizeUrl` flow can't set a cookie (no HTTP response to write it on), so a
		// MISSING cookie is allowed: the binding falls back to the parked token below, which is itself
		// keyed by a server-minted random state and bound to a specific userId with a short TTL. A
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
		const tokenRes = await fetch(tokenEndpoint(config), {
			ignoreSsrfValidation: true, // Microsoft login host (admin-configured authority), not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				code_verifier: codeVerifier,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: redirectUri(),
				scope: TEAMS_DELEGATED_SCOPES.join(' '),
			}).toString(),
		});

		const tokens: any = await tokenRes.json().catch(() => ({}));
		if (!tokenRes.ok || !tokens?.access_token) {
			// Admin-consent-needed surfaces as an AADSTS error in the token response too.
			const aad = String(tokens?.error || '');
			if (aad === 'consent_required' || aad === 'interaction_required') {
				await persistConnection(userId, '', 'Microsoft Teams', 'consent_required', [], undefined);
				return fail(res, 'consent_required', { admin_consent_url: adminConsentUrl(config) }, desktop);
			}
			return fail(res, `token_exchange_${tokenRes.status}`, {}, desktop);
		}

		// Read the external tenant (`tid`) + subject (`sub`) from the id_token (present via `openid`).
		const claims = typeof tokens.id_token === 'string' ? decodeJwtClaims(tokens.id_token) : {};
		const tid = claims.tid || tokens.tid || '';
		const externalOrgName =
			claims.tenant_display_name || claims.tid_name || (claims.upn ? `Teams (${String(claims.upn).split('@')[1] || tid})` : 'Microsoft Teams');
		const grantedScopes = typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : TEAMS_DELEGATED_SCOPES;

		if (!tid) {
			return fail(res, 'no_tenant_id', {}, desktop);
		}

		// Encrypt the tokens and persist the per-user connection (status 'connected').
		const credentials = encryptCredentials({
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : undefined,
			homeAccountId: claims.oid ? `${claims.oid}.${tid}` : undefined,
			externalAadUserId: claims.oid || claims.sub,
		});

		const { _id } = await ExternalWorkspaceConnections.upsertUserConnection(userId, 'teams', tid, {
			externalOrgName,
			status: 'connected',
			scopes: grantedScopes,
			credentials,
			lastSyncAt: new Date(),
		});

		SystemLogger.info({ msg: 'Teams connection established', userId, connectionId: _id, tid });
		return done(res, { teams_connected: '1', connectionId: _id }, desktop);
	} catch (err) {
		SystemLogger.error({ msg: 'Teams OAuth callback error', err: String(err) });
		return fail(res, 'callback_exception');
	}
}

/** Persist a connection without credentials (used for the consent_required degraded state). */
async function persistConnection(
	userId: string,
	tid: string,
	name: string,
	status: 'connected' | 'consent_required' | 'error' | 'disconnected',
	scopes: string[],
	credentials: ReturnType<typeof encryptCredentials> | undefined,
): Promise<void> {
	// tid may be empty in the consent-required case; key the doc on a stable placeholder so re-tries
	// update the same row instead of piling up.
	await ExternalWorkspaceConnections.upsertUserConnection(userId, 'teams', tid || 'pending', {
		externalOrgName: name,
		status,
		scopes,
		...(credentials ? { credentials } : {}),
	});
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
		SystemLogger.error({ msg: 'Teams OAuth route error', err: String(err) });
		return fail(res, 'route_exception');
	}
});
