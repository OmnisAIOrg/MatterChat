/**
 * Boards calendar OAuth routes — the per-user "Connect calendar" redirect dance for Google Calendar
 * and Outlook/Graph Calendar. Clean-room clone of the proven connector PKCE pattern
 * (apps/meteor/app/connectors/server/providers/{google,teams}/routes.ts): server-owned redirect,
 * PKCE S256, state parked in CredentialTokens, serverFetch for the token exchange, one-time HttpOnly
 * state cookie. Nothing under apps/meteor/ee/ was read.
 *
 * Mounted (NOT under /api — RC's REST router shadows /api/*):
 *   GET /_boards_calendar/:provider/oauth/start     → mint PKCE + state, redirect to the provider
 *   GET /_boards_calendar/:provider/oauth/callback  → exchange code, resolve calendar id, persist a
 *                                                      per-user IBoardCalendarConnection (encrypted)
 *
 * STANDALONE-SAFE: when calendar sync is disabled or the provider is unconfigured, `/start` refuses
 * and never reaches the provider.
 */
import crypto from 'crypto';

import { hashLoginToken } from '@rocket.chat/account-utils';
import type { CalendarProvider } from '@rocket.chat/core-typings';
import { BoardCalendarConnections, CredentialTokens, Users } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';
import { Meteor } from 'meteor/meteor';
import { Cookies } from 'meteor/ostrio:cookies';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import {
	getGoogleCalendarConfig,
	getOutlookCalendarConfig,
	GOOGLE_AUTHORIZE_ENDPOINT,
	GOOGLE_CALENDAR_SCOPES,
	GOOGLE_TOKEN_ENDPOINT,
	googleRedirectUri,
	isGoogleCalendarConfigured,
	isOutlookCalendarConfigured,
	outlookAuthorizeEndpoint,
	outlookRedirectUri,
	OUTLOOK_CALENDAR_SCOPES,
	outlookTokenEndpoint,
} from './config';
import { ensurePushSubscription } from './pushSubscriptions';
import { getCalendarProvider } from './registry';
import { encryptCredentials } from '../../../../app/connectors/server/tokenCrypto';
import { SystemLogger } from '../../logger/system';

const ROUTE_PREFIX = '/_boards_calendar';

const cookieReader = new Cookies();
const readCookie = (req: any, name: string): string | undefined => cookieReader.get(name, req.headers?.cookie);
const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const stateKey = (provider: string, state: string): string => `boards_calendar:${provider}:state:${state}`;
const stateCookieName = (provider: string): string => `boards_calendar_${provider}_state`;

function decodeJwtClaims(jwt: string): Record<string, any> {
	try {
		const payload = jwt.split('.')[1];
		return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
	} catch {
		return {};
	}
}

function done(res: any, provider: string, params: Record<string, string>): void {
	const qs = new URLSearchParams(params).toString();
	res.writeHead(302, {
		'Location': Meteor.absoluteUrl(`home?${qs}`),
		'Set-Cookie': `${stateCookieName(provider)}=; Path=${ROUTE_PREFIX}; Max-Age=0; SameSite=Lax; HttpOnly`,
	});
	res.end();
}

function fail(res: any, provider: string, reason: string, extra: Record<string, string> = {}): void {
	SystemLogger.warn({ msg: 'Boards calendar OAuth failed', provider, reason });
	done(res, provider, { boards_calendar_error: reason, ...extra });
}

async function resolveUserId(req: any): Promise<string | null> {
	const uid = readCookie(req, 'rc_uid');
	const token = readCookie(req, 'rc_token');
	if (!uid || !token) {
		return null;
	}
	const user = await Users.findOneByIdAndLoginToken(uid, hashLoginToken(token), { projection: { _id: 1 } });
	return user?._id ?? null;
}

function providerReady(provider: CalendarProvider): boolean {
	return provider === 'google' ? isGoogleCalendarConfigured() : isOutlookCalendarConfigured();
}

/** Build the provider authorize URL + parked state (userId-bound). Throws when not configured. */
export async function buildAuthorizeUrl(provider: CalendarProvider, userId: string): Promise<{ authorizeUrl: string; state: string }> {
	if (!providerReady(provider)) {
		throw new Error('calendar-provider-not-configured');
	}
	if (!userId) {
		throw new Error('not_authenticated');
	}
	const state = Random.id();
	const codeVerifier = base64url(crypto.randomBytes(32));
	const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
	await CredentialTokens.create(stateKey(provider, state), { profile: { codeVerifier, userId } });

	if (provider === 'google') {
		const config = getGoogleCalendarConfig();
		const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('client_id', config.clientId);
		url.searchParams.set('redirect_uri', googleRedirectUri());
		url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '));
		url.searchParams.set('state', state);
		url.searchParams.set('code_challenge', codeChallenge);
		url.searchParams.set('code_challenge_method', 'S256');
		url.searchParams.set('access_type', 'offline');
		url.searchParams.set('prompt', 'consent');
		return { authorizeUrl: url.toString(), state };
	}

	const config = getOutlookCalendarConfig();
	const url = new URL(outlookAuthorizeEndpoint());
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', outlookRedirectUri());
	url.searchParams.set('response_mode', 'query');
	url.searchParams.set('scope', OUTLOOK_CALENDAR_SCOPES.join(' '));
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	return { authorizeUrl: url.toString(), state };
}

async function handleStart(provider: CalendarProvider, req: any, res: any): Promise<void> {
	if (!providerReady(provider)) {
		return fail(res, provider, 'not_configured');
	}
	const userId = await resolveUserId(req);
	if (!userId) {
		return fail(res, provider, 'not_authenticated');
	}
	const { authorizeUrl, state } = await buildAuthorizeUrl(provider, userId);
	const secure = Meteor.absoluteUrl().startsWith('https://');
	const setCookie = `${stateCookieName(provider)}=${state}; Path=${ROUTE_PREFIX}; Max-Age=600; SameSite=Lax; HttpOnly${secure ? '; Secure' : ''}`;
	res.writeHead(302, { 'Location': authorizeUrl, 'Set-Cookie': setCookie });
	res.end();
}

async function exchangeCode(provider: CalendarProvider, code: string, codeVerifier: string): Promise<any> {
	if (provider === 'google') {
		const config = getGoogleCalendarConfig();
		const r = await fetch(GOOGLE_TOKEN_ENDPOINT, {
			ignoreSsrfValidation: true, // Google token host, not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				code_verifier: codeVerifier,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: googleRedirectUri(),
			}).toString(),
		});
		return { res: r, body: await r.json().catch(() => ({})) };
	}
	const config = getOutlookCalendarConfig();
	const r = await fetch(outlookTokenEndpoint(), {
		ignoreSsrfValidation: true, // Microsoft login host (admin-configured authority), not user input
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			code_verifier: codeVerifier,
			client_id: config.clientId,
			client_secret: config.clientSecret,
			redirect_uri: outlookRedirectUri(),
			scope: OUTLOOK_CALENDAR_SCOPES.join(' '),
		}).toString(),
	});
	return { res: r, body: await r.json().catch(() => ({})) };
}

async function handleCallback(provider: CalendarProvider, req: any, res: any): Promise<void> {
	try {
		const url = new URL(req.url, 'http://localhost');
		const error = url.searchParams.get('error');
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');
		const cookieState = readCookie(req, stateCookieName(provider));

		if (error) {
			if (state) {
				await CredentialTokens.removeById(stateKey(provider, state));
			}
			return fail(res, provider, `oauth_${error}`);
		}
		if (!code || !state) {
			return fail(res, provider, 'missing_code_or_state');
		}
		if (cookieState && cookieState !== state) {
			return fail(res, provider, 'state_cookie_mismatch');
		}
		const stateDoc = await CredentialTokens.findOneNotExpiredById(stateKey(provider, state));
		await CredentialTokens.removeById(stateKey(provider, state));
		const codeVerifier = stateDoc?.userInfo?.profile?.codeVerifier;
		const userId = stateDoc?.userInfo?.profile?.userId;
		if (!codeVerifier || !userId) {
			return fail(res, provider, 'invalid_state');
		}

		const { res: tokenRes, body: tokens } = await exchangeCode(provider, code, codeVerifier);
		if (!tokenRes.ok || !tokens?.access_token) {
			return fail(res, provider, `token_exchange_${tokenRes.status}`);
		}

		const claims = typeof tokens.id_token === 'string' ? decodeJwtClaims(tokens.id_token) : {};
		const accountEmail = String(claims.email || claims.preferred_username || '') || undefined;
		const defaultScopes = provider === 'google' ? GOOGLE_CALENDAR_SCOPES : OUTLOOK_CALENDAR_SCOPES;
		const grantedScopes = typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : defaultScopes;

		const credentials = encryptCredentials({
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : undefined,
		});

		// Resolve the default target calendar id with the fresh access token (best-effort; default fallbacks).
		let targetCalendarId = 'primary';
		try {
			targetCalendarId = await getCalendarProvider(provider).resolveDefaultCalendarId(tokens.access_token);
		} catch {
			// keep the fallback
		}

		const { _id } = await BoardCalendarConnections.upsertUserConnection(userId, provider, {
			...(accountEmail ? { accountEmail } : {}),
			status: 'connected',
			scopes: grantedScopes,
			credentials,
			targetCalendarId,
			lastPushAt: undefined,
		});

		SystemLogger.info({ msg: 'Boards calendar connection established', provider, userId, connectionId: _id });

		// Best-effort: create a real-time PUSH (webhook) subscription so inbound changes reconcile
		// instantly instead of waiting for the 15-min poll. A failure (or push being unconfigured)
		// leaves the connection poll-only — connect NEVER fails on this. STANDALONE path only.
		try {
			const conn = await BoardCalendarConnections.findOneByIdAndUserId(_id, userId);
			if (conn) {
				await ensurePushSubscription(conn);
			}
		} catch (err) {
			SystemLogger.warn({ msg: 'Boards calendar push subscription on connect failed (poll fallback)', connectionId: _id, err: String(err) });
		}

		return done(res, provider, { boards_calendar_connected: '1', provider, connectionId: _id });
	} catch (err) {
		SystemLogger.error({ msg: 'Boards calendar OAuth callback error', provider, err: String(err) });
		return fail(res, provider, 'callback_exception');
	}
}

RoutePolicy.declare(`${ROUTE_PREFIX}/`, 'network');

WebApp.connectHandlers.use(ROUTE_PREFIX, async (req: any, res: any, next: () => void) => {
	try {
		// connect strips the mount prefix → req.url is '/:provider/oauth/start' | '/:provider/oauth/callback'.
		const path = new URL(req.url, 'http://localhost').pathname;
		const m = /^\/(google|outlook)\/oauth\/(start|callback)$/.exec(path);
		if (!m) {
			return next();
		}
		const provider = m[1] as CalendarProvider;
		if (m[2] === 'start') {
			return await handleStart(provider, req, res);
		}
		return await handleCallback(provider, req, res);
	} catch (err) {
		SystemLogger.error({ msg: 'Boards calendar OAuth route error', err: String(err) });
		res.writeHead(302, { Location: Meteor.absoluteUrl('home?boards_calendar_error=route_exception') });
		res.end();
	}
});
