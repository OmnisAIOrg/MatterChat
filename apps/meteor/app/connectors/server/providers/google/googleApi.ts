/**
 * Google Chat REST client for the Google Chat connector.
 *
 * A thin wrapper over `serverFetch` (mirrors providers/teams/graphClient.ts) that:
 *  - sends the user's delegated bearer token,
 *  - on 401, refreshes the access token ONCE (via the OAuth refresh-token grant) and retries,
 *  - on 429 (and 503), honors `Retry-After` with an exponential-backoff + jitter fallback,
 *  - pages `nextPageToken` for list endpoints.
 *
 * It speaks ONLY the Google Chat API + the Google token endpoint — never Mongo. Persistence of a
 * refreshed token is delegated back to the caller via `onTokensRefreshed`, so the provider can
 * re-encrypt and store the new tokens on the connection document.
 *
 * Google API errors come back as `{ error: { code, message, status } }` and are surfaced UNswallowed
 * as `google_error:<status|code>:<message>` with `.status`/`.googleStatus` stamped on the Error.
 *
 * Clean-room: written from the Google Chat API docs; nothing under apps/meteor/ee/ was read or copied.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { getGoogleConfig, GOOGLE_TOKEN_ENDPOINT } from './config';
import { SystemLogger } from '../../../../../server/lib/logger/system';

const MAX_RETRIES = 4;
const DEFAULT_BACKOFF_MS = 1000;

/** Mutable token bundle the client reads/refreshes for one request chain. */
export type GoogleTokens = {
	accessToken: string;
	refreshToken?: string;
	/** Epoch ms when the access token expires (best-effort; we still react to live 401s). */
	expiresAt?: number;
};

/** Result of a token refresh, ready to be re-encrypted + persisted by the caller. */
export type RefreshedTokens = {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * Exchange a refresh token for a fresh access token. Throws on failure so the caller can mark the
 * connection `error` / `needs-reconnect` (e.g. on `invalid_grant`, which means the refresh token
 * died — user revoked access / password change / app un-approved).
 *
 * NOTE: Google does NOT rotate the refresh token on this grant, so the response omits it; we keep
 * the existing one.
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshedTokens> {
	const config = getGoogleConfig();
	if (!config.clientId || !config.clientSecret) {
		throw new Error('google_not_configured');
	}

	const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
		ignoreSsrfValidation: true, // Google token host — a fixed Google endpoint, not user input
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
		const reason = body?.error || `http_${res.status}`;
		throw new Error(`google_token_refresh_failed:${reason}`);
	}

	return {
		accessToken: body.access_token,
		// Google does not issue a rotated refresh token on this grant — keep the one we have.
		refreshToken: body.refresh_token || refreshToken,
		expiresAt: body.expires_in ? Date.now() + Number(body.expires_in) * 1000 : undefined,
	};
}

/** Parse Retry-After (seconds or HTTP-date) into ms, else fall back to exponential backoff+jitter. */
function backoffMs(res: { headers: { get(name: string): string | null } }, attempt: number): number {
	const header = res.headers.get('retry-after');
	if (header) {
		const asSeconds = Number(header);
		if (!Number.isNaN(asSeconds)) {
			return Math.max(0, asSeconds * 1000);
		}
		const asDate = Date.parse(header);
		if (!Number.isNaN(asDate)) {
			return Math.max(0, asDate - Date.now());
		}
	}
	const base = DEFAULT_BACKOFF_MS * 2 ** attempt;
	return base + Math.floor(Math.random() * 250);
}

export type GoogleFetchOptions = {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
};

/**
 * Single Google Chat call with 401-refresh-once + 429/503 backoff. `tokens` is mutated in place when
 * a refresh happens; `onTokensRefreshed` (if provided) is awaited so the caller can persist them.
 * Returns the parsed JSON body (or `{}` for empty 2xx responses).
 *
 * Google errors (`{ error: { code, message, status } }`) are thrown UNswallowed as
 * `google_error:<status|code>:<message>` with `.status` + `.googleStatus` stamped on the Error.
 */
export async function googleFetch<T = any>(
	url: string,
	tokens: GoogleTokens,
	options: GoogleFetchOptions = {},
	onTokensRefreshed?: (t: RefreshedTokens) => void | Promise<void>,
): Promise<T> {
	const method = options.method || 'GET';
	let refreshedOnce = false;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const res = await fetch(url, {
			ignoreSsrfValidation: true, // chat.googleapis.com — a fixed Google host, not user input
			method,
			headers: {
				Authorization: `Bearer ${tokens.accessToken}`,
				Accept: 'application/json',
				...(options.body ? { 'Content-Type': 'application/json' } : {}),
				...(options.headers || {}),
			},
			...(options.body ? { body: JSON.stringify(options.body) } : {}),
		});

		// 401 → refresh the access token once, then retry the same request.
		if (res.status === 401 && !refreshedOnce && tokens.refreshToken) {
			refreshedOnce = true;
			try {
				const refreshed = await refreshAccessToken(tokens.refreshToken);
				tokens.accessToken = refreshed.accessToken;
				tokens.refreshToken = refreshed.refreshToken;
				tokens.expiresAt = refreshed.expiresAt;
				await onTokensRefreshed?.(refreshed);
				continue;
			} catch (err) {
				SystemLogger.warn({ msg: 'Google Chat googleFetch token refresh failed', err: String(err) });
				throw err;
			}
		}

		// 429 / 503 → honor Retry-After or back off, then retry (up to MAX_RETRIES).
		if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
			await sleep(backoffMs(res, attempt));
			continue;
		}

		const text = await res.text();
		const json = text ? JSON.parse(text) : {};
		if (!res.ok) {
			// Google REST error envelope: { error: { code, message, status } }.
			const gerr = json?.error || {};
			const status = gerr.status || gerr.code || `http_${res.status}`;
			const message = gerr.message || res.statusText;
			const error = new Error(`google_error:${status}:${message}`);
			(error as any).status = res.status;
			(error as any).googleStatus = gerr.status || String(gerr.code || res.status);
			throw error;
		}
		return json as T;
	}

	throw new Error('google_error:max_retries_exceeded');
}

/**
 * GET a Google Chat collection, following `nextPageToken` until exhausted, returning the
 * concatenated arrays of the named field (`spaces` or `messages`). Paging is capped to avoid an
 * unbounded loop. `pageSize` is appended to the first URL when provided.
 */
export async function googleGetAll<T = any>(
	firstUrl: string,
	field: string,
	tokens: GoogleTokens,
	onTokensRefreshed?: (t: RefreshedTokens) => void | Promise<void>,
	maxPages = 50,
): Promise<T[]> {
	const out: T[] = [];
	let pageToken: string | undefined;
	let pages = 0;

	while (pages < maxPages) {
		const url = new URL(firstUrl);
		if (pageToken) {
			url.searchParams.set('pageToken', pageToken);
		}
		const page = await googleFetch<Record<string, any>>(url.toString(), tokens, {}, onTokensRefreshed);
		const items = page[field];
		if (Array.isArray(items)) {
			out.push(...(items as T[]));
		}
		pageToken = page.nextPageToken;
		pages++;
		if (!pageToken) {
			break;
		}
	}
	return out;
}
