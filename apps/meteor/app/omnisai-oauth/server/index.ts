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
import { WebApp } from 'meteor/webapp';
import { Meteor } from 'meteor/meteor';
import { RoutePolicy } from 'meteor/routepolicy';

import { settings } from '../../settings/server';
import { SystemLogger } from '../../../server/lib/logger/system';

import './loginHandler';

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
const userinfoEndpoint = (c: OmnisAIConfig): string => `${c.issuer}/api/auth/mcp/get-session`;
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

		// 2. Fetch identity from the userinfo (get-session) endpoint.
		const infoRes = await fetch(userinfoEndpoint(config), {
			ignoreSsrfValidation: true, // issuer is an admin-configured trusted host, not user input
			headers: { Authorization: `Bearer ${tokens.access_token}` },
		});
		if (!infoRes.ok) {
			return fail(res, `userinfo_${infoRes.status}`);
		}
		const session = await infoRes.json();
		const u = session?.user;
		if (!u?.id) {
			return fail(res, 'no_subject');
		}

		// 3. Stash the identity under a one-time credentialToken for the client login handler.
		const credentialToken = Random.id();
		await CredentialTokens.create(credentialToken, {
			profile: {
				sub: u.id,
				email: u.email,
				name: u.name,
				username: u.preferred_username,
				orgId: u['casepro:org_id'],
				role: u['casepro:role'],
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
