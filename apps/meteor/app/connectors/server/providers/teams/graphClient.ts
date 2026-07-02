/**
 * Microsoft Graph client for the Teams connector.
 *
 * A thin wrapper over `serverFetch` that:
 *  - sends the user's delegated bearer token,
 *  - on 401, refreshes the access token ONCE (via the OAuth refresh-token grant) and retries,
 *  - on 429 (and 503), honors `Retry-After` with an exponential-backoff + jitter fallback for the
 *    Teams message endpoints that omit the header (spec §3.7),
 *  - pages `@odata.nextLink` for list endpoints.
 *
 * It speaks ONLY Microsoft Graph + the Entra token endpoint — never Mongo. Persistence of a
 * refreshed token is delegated back to the caller via `onTokensRefreshed`, so the provider can
 * re-encrypt and store the new tokens on the connection document.
 *
 * Clean-room: written from Microsoft Graph docs; nothing under apps/meteor/ee/ was read or copied.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { SystemLogger } from '../../../../../server/lib/logger/system';
import { getTeamsConfig, tokenEndpoint, TEAMS_DELEGATED_SCOPES } from './config';

const MAX_RETRIES = 4;
const DEFAULT_BACKOFF_MS = 1000;

/** Mutable token bundle the client reads/refreshes for one request chain. */
export type GraphTokens = {
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
 * Exchange a refresh token for a fresh access (and rotated refresh) token. Throws on failure so
 * the caller can mark the connection `error` / `needs-reconnect` (e.g. on `invalid_grant`, which
 * means the refresh token died — Conditional Access / admin revoke / password change, spec §3.7).
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshedTokens> {
	const config = getTeamsConfig();
	if (!config.clientId || !config.clientSecret) {
		throw new Error('teams_not_configured');
	}

	const res = await fetch(tokenEndpoint(config), {
		ignoreSsrfValidation: true, // Microsoft login host, admin-configured authority — not user input
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: config.clientId,
			client_secret: config.clientSecret,
			scope: TEAMS_DELEGATED_SCOPES.join(' '),
		}).toString(),
	});

	const body: any = await res.json().catch(() => ({}));
	if (!res.ok || !body?.access_token) {
		const reason = body?.error || `http_${res.status}`;
		throw new Error(`teams_token_refresh_failed:${reason}`);
	}

	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token || refreshToken, // some responses omit a rotated token
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
	// Exponential backoff with jitter (some Teams message endpoints omit Retry-After).
	const base = DEFAULT_BACKOFF_MS * 2 ** attempt;
	return base + Math.floor(Math.random() * 250);
}

export type GraphFetchOptions = {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
};

/** Refresh this long before `expiresAt` (clock-skew margin). We still react to live 401s. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Single Graph call with proactive refresh-before-expiry + 401-refresh-once + 429/503 backoff.
 * `tokens` is mutated in place when a refresh happens; `onTokensRefreshed` (if provided) is awaited
 * so the caller can persist them. Returns the parsed JSON body (or `{}` for empty 2xx responses).
 */
export async function graphFetch<T = any>(
	url: string,
	tokens: GraphTokens,
	options: GraphFetchOptions = {},
	onTokensRefreshed?: (t: RefreshedTokens) => void | Promise<void>,
): Promise<T> {
	const method = options.method || 'GET';
	let refreshedOnce = false;

	// PROACTIVE refresh (spec §3.7 "refresh before expiry"): when the access token is at/near expiry
	// and we hold a refresh token, refresh BEFORE burning a doomed request + 401 round-trip. Failure
	// here is the same refresh-token-death signal as the 401 path — it throws (invalid_grant etc.) so
	// the caller can mark the connection for reconnect. A stale/absent `expiresAt` still falls back to
	// the live-401 handling below.
	if (tokens.expiresAt && tokens.refreshToken && Date.now() >= tokens.expiresAt - EXPIRY_SKEW_MS) {
		refreshedOnce = true;
		const refreshed = await refreshAccessToken(tokens.refreshToken);
		tokens.accessToken = refreshed.accessToken;
		tokens.refreshToken = refreshed.refreshToken;
		tokens.expiresAt = refreshed.expiresAt;
		await onTokensRefreshed?.(refreshed);
	}

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const res = await fetch(url, {
			ignoreSsrfValidation: true, // graph.microsoft.com — a fixed Microsoft host, not user input
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
				SystemLogger.warn({ msg: 'Teams graphFetch token refresh failed', err: String(err) });
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
			const code = json?.error?.code || `http_${res.status}`;
			const message = json?.error?.message || res.statusText;
			const error = new Error(`graph_error:${code}:${message}`);
			(error as any).status = res.status;
			(error as any).graphCode = code;
			throw error;
		}
		return json as T;
	}

	throw new Error('graph_error:max_retries_exceeded');
}

/**
 * GET a Graph collection, following `@odata.nextLink` until exhausted, returning the concatenated
 * `value` arrays. Paging is capped to avoid an unbounded loop on a misbehaving endpoint.
 */
export async function graphGetAll<T = any>(
	firstUrl: string,
	tokens: GraphTokens,
	onTokensRefreshed?: (t: RefreshedTokens) => void | Promise<void>,
	maxPages = 50,
): Promise<T[]> {
	const out: T[] = [];
	let next: string | undefined = firstUrl;
	let pages = 0;

	while (next && pages < maxPages) {
		// Explicit annotation (not just the generic) — breaks the `page` -> `next` -> `page`
		// inference cycle tsc reports as TS7022.
		const page: { value?: T[]; '@odata.nextLink'?: string } = await graphFetch(next, tokens, {}, onTokensRefreshed);
		if (Array.isArray(page.value)) {
			out.push(...page.value);
		}
		next = page['@odata.nextLink'];
		pages++;
	}
	return out;
}
