/**
 * "Sign in with OmnisAI" — CentralizedAuth OIDC login for MatterChat.
 *
 * Isolated provider (mirrors the SAML pattern) because Rocket.Chat's generic Custom OAuth
 * does NOT support PKCE, and CentralizedAuth's better-auth OIDC server MANDATES PKCE (S256).
 * This module owns the whole redirect dance server-side:
 *
 *   GET /_omnisai/authorize  -> mint PKCE state+verifier, redirect to CentralizedAuth /authorize
 *   GET /_omnisai/callback    -> verify state, exchange code+verifier for tokens, fetch userinfo,
 *                                stash the profile under a one-time credentialToken, bounce to the
 *                                client route /omnisai/:token which finalizes the Meteor session.
 *
 * The OIDC `sub` claim IS the CentralizedAuth user UUID == CasePro `users.id`; we persist it as
 * `services.omnisai.id` so a MatterChat user is durably linked to its CasePro identity.
 *
 * Config is env-driven for now (the real CentralizedAuth host is not reachable from dev; a local
 * mock OIDC server stands in). Endpoints follow better-auth's mcp plugin layout.
 */
import crypto from 'crypto';

import { CredentialTokens } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';
import { Meteor } from 'meteor/meteor';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { verifyOmnisaiIdToken } from './verifyIdToken';
import {
	finishDesktopLoginCallback,
	finishDesktopLoginError,
	isDesktopAuthorizeRequest,
	isDesktopState,
} from '../../connectors/server/desktopOAuth';
import { SystemLogger } from '../../../server/lib/logger/system';
import { settings } from '../../../server/settings';

import './loginHandler';
import './litboxProxy';
import './crossFirmProxy';
import './setupWizard';

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const STATE_COOKIE = 'omnisai_oidc_state';

function readCookie(req: any, name: string): string | undefined {
	const raw = req.headers?.cookie;
	if (typeof raw !== 'string') {
		return undefined;
	}
	for (const part of raw.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === name) {
			return decodeURIComponent(rest.join('='));
		}
	}
	return undefined;
}

type OmnisAIConfig = {
	enabled: boolean;
	issuer: string;
	clientId: string;
	clientSecret: string;
	scope: string;
};

function getConfig(): OmnisAIConfig {
	// Resolve issuer/clientId from the persisted Mongo setting FIRST, then fall back to process.env.
	// Why: the settings are seeded via OVERWRITE_SETTING_* and live in Mongo, so they survive a pod whose
	// container env didn't carry the OMNISAI_OIDC_* vars (e.g. env dropped from the live Deployment by a
	// kubectl apply 3-way merge) — which otherwise dead-ends the login at `not_configured` even though the
	// button (driven by the persisted OmnisAI_OIDC_Enabled setting) still renders. See settings/omnisai.ts.
	const settingStr = (id: string): string => {
		const v = settings.get(id);
		return typeof v === 'string' ? v.trim() : '';
	};
	return {
		enabled: Boolean(settings.get('OmnisAI_OIDC_Enabled')) || process.env.OMNISAI_OIDC_ENABLED === 'true',
		issuer: (settingStr('OmnisAI_OIDC_Issuer') || process.env.OMNISAI_OIDC_ISSUER || '').replace(/\/$/, ''),
		clientId: settingStr('OmnisAI_OIDC_Client_Id') || process.env.OMNISAI_OIDC_CLIENT_ID || '',
		// Shared app secret for strict HS256 id_token signature verification. Empty by default → the
		// verifier stays fail-soft (current live behavior). See verifyIdToken.ts / DECISIONS.md 2026-06-25.
		clientSecret: settingStr('OmnisAI_OIDC_Client_Secret') || process.env.OMNISAI_OIDC_CLIENT_SECRET || '',
		scope: process.env.OMNISAI_OIDC_SCOPE || 'openid profile email offline_access casepro:read',
	};
}

const authorizeEndpoint = (c: OmnisAIConfig): string => `${c.issuer}/api/auth/mcp/authorize`;
const tokenEndpoint = (c: OmnisAIConfig): string => `${c.issuer}/api/auth/mcp/token`;
const userinfoEndpoint = (c: OmnisAIConfig): string => `${c.issuer}/api/auth/mcp/userinfo`;
const redirectUri = (): string => Meteor.absoluteUrl('_omnisai/callback');
const stateKey = (state: string): string => `omnisai:state:${state}`;

function redirect(res: any, location: string, extraHeaders: Record<string, string> = {}): void {
	res.writeHead(302, { Location: location, ...extraHeaders });
	res.end();
}

function fail(res: any, reason: string, extraHeaders: Record<string, string> = {}, desktop = false): void {
	SystemLogger.warn({ msg: 'OmnisAI OIDC login failed', reason });
	// DESKTOP: hand the error back to the app via `matterchat://login?status=error&reason=...` (no
	// token) with the interstitial fallback, instead of dead-ending on an HTTPS page the app window
	// never sees (spec §A.5). ADDITIVE: web flows keep the home?omnisai_error= landing unchanged.
	if (desktop) {
		return finishDesktopLoginError(res, reason, extraHeaders);
	}
	redirect(res, Meteor.absoluteUrl(`home?omnisai_error=${encodeURIComponent(reason)}`), extraHeaders);
}

const clearStateCookie = (): string => `${STATE_COOKIE}=; HttpOnly; Path=/_omnisai; Max-Age=0; SameSite=Lax`;

async function handleAuthorize(req: any, res: any): Promise<void> {
	// Desktop hand-off: the desktop shell opens this in the system browser with `?client=desktop`.
	// The flag is carried TAMPER-PROOF inside the parked state doc (below) — never echoed as a query
	// param — and read back at callback time to choose the `matterchat://login` return (spec §A.5).
	const desktop = isDesktopAuthorizeRequest(req?.url);

	const config = getConfig();
	if (!config.enabled || !config.issuer || !config.clientId) {
		// Reveal WHICH field is missing (in the redirect URL) so a misconfig is diagnosable without pod access.
		let missing = 'client_id';
		if (!config.enabled) {
			missing = 'enabled';
		} else if (!config.issuer) {
			missing = 'issuer';
		}
		return fail(res, `not_configured_${missing}`, {}, desktop);
	}

	const state = Random.id();
	const nonce = Random.id();
	const codeVerifier = base64url(crypto.randomBytes(32));
	const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

	// Park the verifier + nonce (+ the desktop flag) server-side, keyed by state, for the callback
	// (TTL via CredentialTokens). Storing `desktop` here is what makes it tamper-proof.
	await CredentialTokens.create(stateKey(state), { profile: { codeVerifier, nonce, desktop } });

	const url = new URL(authorizeEndpoint(config));
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('scope', config.scope);
	url.searchParams.set('state', state);
	url.searchParams.set('nonce', nonce);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');

	// Bind the flow to THIS browser: the callback must echo the same `state` in a cookie only the
	// initiator was given (defeats login-CSRF — an attacker can't set this cookie in a victim's browser).
	const secure = redirectUri().startsWith('https') ? '; Secure' : '';
	redirect(res, url.toString(), {
		'Set-Cookie': `${STATE_COOKIE}=${state}; HttpOnly; Path=/_omnisai; Max-Age=600; SameSite=Lax${secure}`,
	});
}

async function handleCallback(req: any, res: any): Promise<void> {
	const config = getConfig();
	try {
		const url = new URL(req.url, 'http://localhost');
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');
		if (!code || !state) {
			return fail(res, 'missing_code_or_state');
		}

		// Peek the parked state doc up-front (read-only; consumed below) to recover the TAMPER-PROOF
		// desktop flag — it lives only here, never in a query param — so every exit (incl. errors) hands
		// back to the desktop app via the `matterchat://login` scheme rather than dead-ending on HTTPS.
		const peekDoc = await CredentialTokens.findOneNotExpiredById(stateKey(state));
		const desktop = isDesktopState(peekDoc?.userInfo?.profile?.desktop);

		// Login-CSRF guard: reject only when a state cookie is PRESENT but doesn't match (real CSRF).
		// A MISSING cookie is tolerated — some browsers don't send the freshly-set SameSite=Lax cookie
		// on the first cross-site callback, which would otherwise wrongly fail a valid first login.
		const cookieState = readCookie(req, STATE_COOKIE);
		if (cookieState && cookieState !== state) {
			return fail(res, 'state_mismatch', { 'Set-Cookie': clearStateCookie() }, desktop);
		}

		const stateDoc = await CredentialTokens.findOneNotExpiredById(stateKey(state));
		await CredentialTokens.removeById(stateKey(state));
		const codeVerifier = stateDoc?.userInfo?.profile?.codeVerifier;
		const nonce = stateDoc?.userInfo?.profile?.nonce;
		if (!codeVerifier) {
			return fail(res, 'invalid_state', { 'Set-Cookie': clearStateCookie() }, desktop);
		}

		// 1. Exchange the code (+ PKCE verifier) for tokens.
		const tokenRes = await fetch(tokenEndpoint(config), {
			ignoreSsrfValidation: true, // issuer is an admin-configured trusted host, not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				code_verifier: codeVerifier,
				client_id: config.clientId,
				redirect_uri: redirectUri(),
			}).toString(),
		});
		if (!tokenRes.ok) {
			return fail(res, `token_exchange_${tokenRes.status}`, {}, desktop);
		}
		const tokens = await tokenRes.json();
		if (!tokens?.access_token) {
			return fail(res, 'no_access_token', {}, desktop);
		}

		// 2. Resolve identity. Prefer the id_token claims (standard OIDC, present with the `openid`
		// scope) — the live server's userinfo endpoint shape/path varies. Fall back to userinfo
		// (flat `{ sub }` or the mock's `{ user: { id } }`) only when there's no id_token.
		let u: Record<string, any> = {};
		if (typeof tokens.id_token === 'string' && tokens.id_token.includes('.')) {
			// Cryptographically verify the id_token: signature via the issuer JWKS, plus iss / aud /
			// exp and the nonce we issued. Fail the login closed on any mismatch.
			try {
				u = await verifyOmnisaiIdToken(tokens.id_token, {
					issuer: config.issuer,
					clientId: config.clientId,
					clientSecret: config.clientSecret,
					nonce,
				});
			} catch (err: any) {
				return fail(res, err?.message || 'id_token_invalid', { 'Set-Cookie': clearStateCookie() }, desktop);
			}
		} else {
			const infoRes = await fetch(userinfoEndpoint(config), {
				ignoreSsrfValidation: true, // issuer is an admin-configured trusted host, not user input
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			});
			if (!infoRes.ok) {
				return fail(res, `userinfo_${infoRes.status}`, {}, desktop);
			}
			const info = await infoRes.json();
			u = (info?.user ?? info ?? {}) as Record<string, any>;
		}
		const sub = u.sub ?? u.id;
		if (!sub) {
			return fail(res, 'no_subject', {}, desktop);
		}

		// 3. Stash the identity under a one-time credentialToken for the client login handler.
		const credentialToken = Random.id();
		await CredentialTokens.create(credentialToken, {
			profile: {
				sub,
				email: u.email,
				name: u.name,
				username: u.preferred_username,
				orgId: u['casepro:org_id'],
				// MATTERCHAT: names the mirrored firm when CentralAuth supplies it.
				// Optional — ensureFirmForOrg falls back to a renameable placeholder.
				orgName: u['casepro:org_name'] ?? u.organization_name,
				role: u['casepro:role'],
				// LitBox credential captured at login → persisted server-side (loginHandler) →
				// read by the /api/litbox proxy. CredentialTokens is one-time + server-only; the
				// raw tokens never reach the browser. (LitBox accepts a CentralizedAuth session
				// token as the bearer; access_token is that value in this OIDC setup.)
				litboxSessionToken: tokens.access_token,
				litboxRefreshToken: tokens.refresh_token,
				litboxExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
			},
		});

		// DESKTOP (spec §A.5): redirect to `matterchat://login?token=<credentialToken>` so the desktop
		// shell can finish login inside the app window (it loads `/omnisai/<token>` there). The token is
		// RC's single-use, short-lived OAuth credential token — redeemed immediately — so carrying it on
		// the scheme back into our OWN app is safe (no long-lived secret crosses the wire). The
		// interstitial "Return to MatterChat" page is the fallback when the OS doesn't auto-hand-off.
		// WEB/PWA path is unchanged: bounce to the in-app `omnisai/<token>` route.
		if (desktop) {
			return finishDesktopLoginCallback(res, credentialToken, { 'Set-Cookie': clearStateCookie() });
		}
		redirect(res, Meteor.absoluteUrl(`omnisai/${credentialToken}`), { 'Set-Cookie': clearStateCookie() });
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI OIDC callback error', err });
		fail(res, 'callback_exception');
	}
}

RoutePolicy.declare('/_omnisai/', 'network');

// String mount (connect strips the '/_omnisai' prefix, so req.url here is '/authorize' | '/callback').
WebApp.connectHandlers.use('/_omnisai', async (req: any, res: any, next: () => void) => {
	try {
		const path = new URL(req.url, 'http://localhost').pathname;
		if (path.endsWith('/authorize')) {
			return await handleAuthorize(req, res);
		}
		if (path.endsWith('/callback')) {
			return await handleCallback(req, res);
		}
		return next();
	} catch (err) {
		SystemLogger.error({ msg: 'OmnisAI OIDC route error', err });
		fail(res, 'route_exception');
	}
});
