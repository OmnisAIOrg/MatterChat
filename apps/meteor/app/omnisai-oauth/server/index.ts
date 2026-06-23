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

import { SystemLogger } from '../../../server/lib/logger/system';
import { settings } from '../../settings/server';

import './loginHandler';
import './litboxProxy';

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Decode a JWT's claims payload (no signature verification — the token comes straight from the
// trusted token endpoint over TLS, not relayed by the user).
function decodeJwtClaims(jwt: string): Record<string, any> {
	try {
		const payload = jwt.split('.')[1];
		const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
		return JSON.parse(json) as Record<string, any>;
	} catch {
		return {};
	}
}

type OmnisAIConfig = {
	enabled: boolean;
	issuer: string;
	clientId: string;
	scope: string;
};

function getConfig(): OmnisAIConfig {
	return {
		enabled: Boolean(settings.get('OmnisAI_OIDC_Enabled')) || process.env.OMNISAI_OIDC_ENABLED === 'true',
		issuer: (process.env.OMNISAI_OIDC_ISSUER || '').replace(/\/$/, ''),
		clientId: process.env.OMNISAI_OIDC_CLIENT_ID || '',
		scope: process.env.OMNISAI_OIDC_SCOPE || 'openid profile email offline_access casepro:read',
	};
}

const authorizeEndpoint = (c: OmnisAIConfig): string => `${c.issuer}/api/auth/mcp/authorize`;
const tokenEndpoint = (c: OmnisAIConfig): string => `${c.issuer}/api/auth/mcp/token`;
const userinfoEndpoint = (c: OmnisAIConfig): string => `${c.issuer}/api/auth/mcp/userinfo`;
const redirectUri = (): string => Meteor.absoluteUrl('_omnisai/callback');
const stateKey = (state: string): string => `omnisai:state:${state}`;

function redirect(res: any, location: string): void {
	res.writeHead(302, { Location: location });
	res.end();
}

function fail(res: any, reason: string): void {
	SystemLogger.warn({ msg: 'OmnisAI OIDC login failed', reason });
	redirect(res, Meteor.absoluteUrl(`home?omnisai_error=${encodeURIComponent(reason)}`));
}

async function handleAuthorize(res: any): Promise<void> {
	const config = getConfig();
	if (!config.enabled || !config.issuer || !config.clientId) {
		return fail(res, 'not_configured');
	}

	const state = Random.id();
	const codeVerifier = base64url(crypto.randomBytes(32));
	const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

	// Park the verifier server-side, keyed by state, for the callback (60s TTL via CredentialTokens).
	await CredentialTokens.create(stateKey(state), { profile: { codeVerifier } });

	const url = new URL(authorizeEndpoint(config));
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('scope', config.scope);
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');

	redirect(res, url.toString());
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

		const stateDoc = await CredentialTokens.findOneNotExpiredById(stateKey(state));
		await CredentialTokens.removeById(stateKey(state));
		const codeVerifier = stateDoc?.userInfo?.profile?.codeVerifier;
		if (!codeVerifier) {
			return fail(res, 'invalid_state');
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
			return fail(res, `token_exchange_${tokenRes.status}`);
		}
		const tokens = await tokenRes.json();
		if (!tokens?.access_token) {
			return fail(res, 'no_access_token');
		}

		// 2. Resolve identity. Prefer the id_token claims (standard OIDC, present with the `openid`
		// scope) — the live server's userinfo endpoint shape/path varies. Fall back to userinfo
		// (flat `{ sub }` or the mock's `{ user: { id } }`) only when there's no id_token.
		let u: Record<string, any> = {};
		if (typeof tokens.id_token === 'string' && tokens.id_token.includes('.')) {
			u = decodeJwtClaims(tokens.id_token);
		} else {
			const infoRes = await fetch(userinfoEndpoint(config), {
				ignoreSsrfValidation: true, // issuer is an admin-configured trusted host, not user input
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			});
			if (!infoRes.ok) {
				return fail(res, `userinfo_${infoRes.status}`);
			}
			const info = await infoRes.json();
			u = (info?.user ?? info ?? {}) as Record<string, any>;
		}
		const sub = u.sub ?? u.id;
		if (!sub) {
			return fail(res, 'no_subject');
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

		redirect(res, Meteor.absoluteUrl(`omnisai/${credentialToken}`));
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
			return await handleAuthorize(res);
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
