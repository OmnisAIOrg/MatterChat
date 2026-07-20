/**
 * Slack Web API client for the Slack connector.
 *
 * A thin wrapper over `serverFetch` (mirrors providers/teams/graphClient.ts +
 * providers/google/googleApi.ts) that:
 *  - sends the user's delegated bearer token,
 *  - SURFACES Slack's `ok:false` envelope as an Error (NEVER swallowed) — Slack returns HTTP 200
 *    with `{ ok:false, error:'...' }` for logical errors, so a happy HTTP status is not success,
 *  - on 429, honors `Retry-After` with an exponential-backoff + jitter fallback, then retries,
 *  - pages `response_metadata.next_cursor` for cursor-paged list endpoints (conversations.list,
 *    users.list, conversations.history).
 *
 * It speaks ONLY the Slack Web API — never Mongo. Slack user tokens (without token rotation enabled
 * on the app) do not expire, so there is no refresh-token grant here; an `invalid_auth`/`token_*`
 * `ok:false` error surfaces unswallowed and the caller marks the connection `error`/needs-reconnect.
 *
 * Slack errors are thrown UNswallowed as `slack_error:<error>` with `.slackError` stamped on the
 * Error (e.g. `slack_error:missing_scope`, `slack_error:invalid_auth`).
 *
 * Clean-room: written from the Slack Web API docs; nothing under apps/meteor/ee/ was read or copied.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { SLACK_API_BASE } from './config';

const MAX_RETRIES = 4;
const DEFAULT_BACKOFF_MS = 1000;

/** Token bundle the client reads for one request chain. Slack user tokens don't expire (no rotation). */
export type SlackTokens = {
	accessToken: string;
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/** Parse Retry-After (seconds) into ms, else fall back to exponential backoff+jitter. */
function backoffMs(res: { headers: { get(name: string): string | null } }, attempt: number): number {
	const header = res.headers.get('retry-after');
	if (header) {
		const asSeconds = Number(header);
		if (!Number.isNaN(asSeconds)) {
			return Math.max(0, asSeconds * 1000);
		}
	}
	const base = DEFAULT_BACKOFF_MS * 2 ** attempt;
	return base + Math.floor(Math.random() * 250);
}

/** The shape every Slack Web API response carries. */
export type SlackResponse = {
	ok: boolean;
	error?: string;
	warning?: string;
	response_metadata?: { next_cursor?: string; warnings?: string[] };
	[key: string]: unknown;
};

export type SlackFetchOptions = {
	/** HTTP method — Slack accepts GET or POST; we use POST for writes, GET for reads. */
	method?: 'GET' | 'POST';
	/** Form params (Slack Web API is application/x-www-form-urlencoded, NOT JSON, for most methods). */
	params?: Record<string, string | number | boolean | undefined>;
	/** JSON body for the handful of methods that take JSON (none used here, but kept for parity). */
	json?: unknown;
};

/**
 * Build the Slack request: method name appended to the API base, params form-encoded. The bearer
 * token authenticates as the signed-in user.
 */
function buildRequest(method: string, tokens: SlackTokens, options: SlackFetchOptions): { url: string; init: Record<string, unknown> } {
	const url = `${SLACK_API_BASE}/${method}`;
	const httpMethod = options.method || 'GET';

	if (options.json !== undefined) {
		return {
			url,
			init: {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${tokens.accessToken}`,
					'Content-Type': 'application/json; charset=utf-8',
					'Accept': 'application/json',
				},
				body: JSON.stringify(options.json),
			},
		};
	}

	const form = new URLSearchParams();
	for (const [key, value] of Object.entries(options.params || {})) {
		if (value !== undefined && value !== null) {
			form.set(key, String(value));
		}
	}

	if (httpMethod === 'GET') {
		const qs = form.toString();
		return {
			url: qs ? `${url}?${qs}` : url,
			init: {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${tokens.accessToken}`,
					Accept: 'application/json',
				},
			},
		};
	}

	return {
		url,
		init: {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${tokens.accessToken}`,
				'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
				'Accept': 'application/json',
			},
			body: form.toString(),
		},
	};
}

/**
 * Single Slack Web API call with 429 backoff and `ok:false` surfacing. Returns the parsed response
 * (which always carries `ok:true` on success — `ok:false` throws). `tokens` is read-only here (Slack
 * user tokens don't expire without rotation), kept for signature parity with the Teams/Google clients.
 *
 * Slack returns HTTP 200 with `{ ok:false, error:'...' }` for logical failures (missing scope, bad
 * channel, rate-limit overflow, invalid_auth). We THROW those as `slack_error:<error>` so callers
 * never silently treat a logical failure as an empty success.
 */
export async function slackFetch<T extends Partial<SlackResponse> = SlackResponse>(
	method: string,
	tokens: SlackTokens,
	options: SlackFetchOptions = {},
): Promise<T & SlackResponse> {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const { url, init } = buildRequest(method, tokens, options);
		const res = await fetch(url, {
			ignoreSsrfValidation: true, // slack.com/api — a fixed Slack host, not user input
			...(init as any),
		});

		// 429 → honor Retry-After or back off, then retry (up to MAX_RETRIES).
		if (res.status === 429 && attempt < MAX_RETRIES) {
			await sleep(backoffMs(res, attempt));
			continue;
		}

		const text = await res.text();
		let json: T & SlackResponse;
		try {
			json = (text ? JSON.parse(text) : {}) as T & SlackResponse;
		} catch {
			throw new Error(`slack_error:invalid_json:http_${res.status}`);
		}

		// HTTP-level failure (rare for the Web API, which prefers 200 + ok:false).
		if (!res.ok && !json?.ok) {
			const error = new Error(`slack_error:http_${res.status}:${json?.error || res.statusText}`);
			(error as any).slackError = json?.error || `http_${res.status}`;
			throw error;
		}

		// Slack's `ok:false` envelope — a logical error reported with HTTP 200. Surface, never swallow.
		if (!json?.ok) {
			// `ratelimited` can come back in the envelope too; retry within budget before failing.
			if (json?.error === 'ratelimited' && attempt < MAX_RETRIES) {
				await sleep(backoffMs(res, attempt));
				continue;
			}
			const err = new Error(`slack_error:${json?.error || 'unknown'}`);
			(err as any).slackError = json?.error || 'unknown';
			throw err;
		}

		return json;
	}

	throw new Error('slack_error:max_retries_exceeded');
}

/**
 * Cursor-page a Slack list endpoint, concatenating the named array field across pages by following
 * `response_metadata.next_cursor`. Paging is capped to avoid an unbounded loop on a misbehaving
 * endpoint. The first page's `params` are reused on every page; only `cursor` advances.
 *
 * Used for: conversations.list (`channels`), users.list (`members`).
 */
export async function slackGetAll<T = any>(
	method: string,
	field: string,
	tokens: SlackTokens,
	params: Record<string, string | number | boolean | undefined> = {},
	maxPages = 50,
): Promise<T[]> {
	const out: T[] = [];
	let cursor: string | undefined;
	let pages = 0;

	while (pages < maxPages) {
		const page = await slackFetch(method, tokens, {
			method: 'GET',
			params: { ...params, ...(cursor ? { cursor } : {}) },
		});
		const items = (page as Record<string, unknown>)[field];
		if (Array.isArray(items)) {
			out.push(...(items as T[]));
		}
		cursor = page.response_metadata?.next_cursor;
		pages++;
		if (!cursor) {
			break;
		}
	}
	return out;
}
