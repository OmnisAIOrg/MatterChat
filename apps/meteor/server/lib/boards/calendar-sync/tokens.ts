/**
 * OAuth token handling for Boards calendar connections. REUSES the connector's AES-256-GCM token
 * crypto (encryptCredentials / decryptCredentials, env key EXTERNAL_TOKEN_ENC_KEY) — no new crypto is
 * introduced — and mirrors the Teams/Google graphClient refresh pattern (proactive refresh before
 * expiry + 401-refresh-once), persisting rotated tokens back onto the connection document.
 *
 * SSRF posture matches the connectors: token endpoints are FIXED Google/Microsoft hosts (not user
 * input), so `serverFetch` is called with `ignoreSsrfValidation: true` and an inline justification.
 * Tokens are NEVER logged.
 */
import type { CalendarProvider, IBoardCalendarConnection } from '@rocket.chat/core-typings';
import { BoardCalendarConnections } from '@rocket.chat/models';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import {
	getGoogleCalendarConfig,
	getOutlookCalendarConfig,
	GOOGLE_TOKEN_ENDPOINT,
	OUTLOOK_CALENDAR_SCOPES,
	outlookTokenEndpoint,
} from './config';
import { decryptCredentials, encryptCredentials } from '../../../../app/connectors/server/tokenCrypto';
import { SystemLogger } from '../../logger/system';

/** The decrypted credential bundle stored (encrypted) on a calendar connection. */
export type CalendarCredentials = {
	accessToken: string;
	refreshToken?: string;
	/** Epoch ms when the access token expires (best-effort; we still react to live 401s). */
	expiresAt?: number;
};

/** Refresh this long before `expiresAt` (clock-skew margin). */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Decrypt a connection's stored credentials. Returns undefined when the blob can't be decrypted
 * (missing/wrong key) so the caller fails closed and forces a reconnect.
 */
export function readCredentials(conn: IBoardCalendarConnection): CalendarCredentials | undefined {
	return decryptCredentials<CalendarCredentials>(conn.credentials);
}

/** Re-encrypt a credentials bundle for storage on a connection doc. */
export function sealCredentials(creds: CalendarCredentials) {
	return encryptCredentials(creds as unknown as Record<string, unknown>);
}

/**
 * Exchange a refresh token for a fresh access token. Throws on failure so the caller can mark the
 * connection `error` (e.g. on `invalid_grant` — the refresh token died). Google does NOT rotate the
 * refresh token on this grant, so we keep the existing one; Microsoft may rotate it.
 */
export async function refreshAccessToken(provider: CalendarProvider, refreshToken: string): Promise<CalendarCredentials> {
	if (provider === 'google') {
		const config = getGoogleCalendarConfig();
		if (!config.clientId || !config.clientSecret) {
			throw new Error('google_calendar_not_configured');
		}
		const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
			ignoreSsrfValidation: true, // Google token host — fixed endpoint, not user input
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: config.clientId,
				client_secret: config.clientSecret,
			}).toString(),
		});
		const body: any = await res.json().catch(() => ({}));
		if (!res.ok || !body?.access_token) {
			throw new Error(`google_calendar_token_refresh_failed:${body?.error || `http_${res.status}`}`);
		}
		return {
			accessToken: body.access_token,
			refreshToken: body.refresh_token || refreshToken,
			expiresAt: body.expires_in ? Date.now() + Number(body.expires_in) * 1000 : undefined,
		};
	}

	// outlook / Graph
	const config = getOutlookCalendarConfig();
	if (!config.clientId || !config.clientSecret) {
		throw new Error('outlook_calendar_not_configured');
	}
	const res = await fetch(outlookTokenEndpoint(), {
		ignoreSsrfValidation: true, // Microsoft login host (admin-configured authority), not user input
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: config.clientId,
			client_secret: config.clientSecret,
			scope: OUTLOOK_CALENDAR_SCOPES.join(' '),
		}).toString(),
	});
	const body: any = await res.json().catch(() => ({}));
	if (!res.ok || !body?.access_token) {
		throw new Error(`outlook_calendar_token_refresh_failed:${body?.error || `http_${res.status}`}`);
	}
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token || refreshToken, // Microsoft may rotate; keep existing if absent
		expiresAt: body.expires_in ? Date.now() + Number(body.expires_in) * 1000 : undefined,
	};
}

/**
 * Return a VALID access token for a connection, proactively refreshing (and persisting the rotated
 * bundle) when the stored one is at/near expiry. Throws on undecryptable creds or a dead refresh
 * token; the sync job catches and marks the connection `error`. NEVER logs the token.
 *
 * Exposed scopes list is only used to keep the refresh request well-formed per provider; the granted
 * scopes on the connection are the source of truth for what the connection can do.
 */
export async function getValidAccessToken(conn: IBoardCalendarConnection): Promise<string> {
	const creds = readCredentials(conn);
	if (!creds?.accessToken) {
		throw new Error('credentials_unavailable');
	}

	const nearExpiry = typeof creds.expiresAt === 'number' && Date.now() >= creds.expiresAt - EXPIRY_SKEW_MS;
	if (nearExpiry && creds.refreshToken) {
		const refreshed = await refreshAccessToken(conn.provider, creds.refreshToken);
		await BoardCalendarConnections.updateCredentialsById(conn._id, sealCredentials(refreshed));
		return refreshed.accessToken;
	}
	return creds.accessToken;
}

/**
 * Run `fn` with a valid access token; on a thrown 401 (auth error) refresh ONCE and retry. On a dead
 * refresh token (`invalid_grant`) flips the connection to `error` and rethrows so callers stop. This
 * is the shared retry envelope the provider calls go through. `_scopes` is accepted for symmetry with
 * the connector graphClient; unused here.
 */
export async function withFreshToken<T>(conn: IBoardCalendarConnection, fn: (accessToken: string) => Promise<T>): Promise<T> {
	let token: string;
	try {
		token = await getValidAccessToken(conn);
	} catch (err) {
		await markAuthDeathIfNeeded(conn, err);
		throw err;
	}

	try {
		return await fn(token);
	} catch (err) {
		if (isUnauthorized(err)) {
			const creds = readCredentials(conn);
			if (creds?.refreshToken) {
				try {
					const refreshed = await refreshAccessToken(conn.provider, creds.refreshToken);
					await BoardCalendarConnections.updateCredentialsById(conn._id, sealCredentials(refreshed));
					return await fn(refreshed.accessToken);
				} catch (refreshErr) {
					await markAuthDeathIfNeeded(conn, refreshErr);
					throw refreshErr;
				}
			}
		}
		await markAuthDeathIfNeeded(conn, err);
		throw err;
	}
}

/** A thrown error carrying an HTTP 401 (our provider fetch stamps `.status`). */
function isUnauthorized(err: unknown): boolean {
	return typeof (err as { status?: unknown })?.status === 'number' && (err as { status: number }).status === 401;
}

/** On refresh-token death, flip the connection to `error` (best-effort) so the UI shows "reconnect". */
async function markAuthDeathIfNeeded(conn: IBoardCalendarConnection, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	if (message.includes('invalid_grant') || message.includes('credentials_unavailable')) {
		try {
			await BoardCalendarConnections.setStatusById(conn._id, 'error');
			SystemLogger.warn({ msg: 'Boards calendar connection auth dead — marked error (reconnect required)', connectionId: conn._id });
		} catch {
			// status write failed — the original error below still tells the story
		}
	}
}
