/**
 * Slack Web API client for the Slack connector.
 *
 * A thin wrapper over `serverFetch` that:
 *  - sends the user's USER bearer token,
 *  - ALWAYS checks Slack's `{ ok: false, error }` envelope (Slack returns HTTP 200 with ok:false on
 *    logical failure — a non-ok body is an error, NOT a success), and surfaces the error rather than
 *    swallowing it (spec WS-5),
 *  - on 429, honors `Retry-After` (Slack's documented rate-limit header) with a backoff fallback,
 *  - pages `response_metadata.next_cursor` for cursor-paginated list endpoints (conversations.list).
 *
 * It speaks ONLY the Slack Web API — never Mongo. Slack USER tokens do NOT expire by default, so —
 * unlike the Teams graphClient — there is no refresh-on-401 path.
 *
 * Clean-room: written from the Slack Web API docs; nothing under apps/meteor/ee/ was read or copied.
 * Mirrors the structure of providers/teams/graphClient.ts.
 */
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { SLACK_API_BASE } from './config';

const MAX_RETRIES = 4;
const DEFAULT_BACKOFF_MS = 1000;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/** Parse Retry-After (seconds) into ms, else fall back to exponential backoff + jitter. */
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

export type SlackFetchOptions = {
	/** Query params appended to the URL (GET) — Slack list endpoints take query params. */
	query?: Record<string, string | number | boolean | undefined>;
};

/** A Slack Web API response always carries `ok`; on failure it carries `error` (a stable code). */
type SlackEnvelope = {
	ok: boolean;
	error?: string;
	response_metadata?: { next_cursor?: string };
	[key: string]: unknown;
};

function buildUrl(method: string, query?: SlackFetchOptions['query']): string {
	const url = new URL(`${SLACK_API_BASE}/${method}`);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined) {
				url.searchParams.set(key, String(value));
			}
		}
	}
	return url.toString();
}

/**
 * Throw a typed error for a Slack `{ ok:false, error }` body. Stamps `slackError` + a best-effort
 * HTTP-ish status so the caller (connectionService) can surface it like a Graph error.
 */
function slackErrorFor(code: string, status?: number): Error {
	const error = new Error(`slack_error:${code}`);
	(error as any).slackError = code;
	if (typeof status === 'number') {
		(error as any).status = status;
	}
	return error;
}

/**
 * Single Slack Web API call with 429 backoff + the mandatory `ok` check. `token` is the user's USER
 * token (Authorization: Bearer …). Returns the parsed JSON body on success; THROWS on `ok:false`
 * (surfacing `response.error`) so failures are never swallowed.
 */
export async function slackFetch<T extends SlackEnvelope = SlackEnvelope>(token: string, method: string, options: SlackFetchOptions = {}): Promise<T> {
	if (!token) {
		throw slackErrorFor('missing_token', 401);
	}
	const url = buildUrl(method, options.query);

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const res = await fetch(url, {
			ignoreSsrfValidation: true, // slack.com/api — a fixed Slack host, not user input
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
			},
		});

		// 429 → honor Retry-After (Slack's documented rate-limit header) or back off, then retry.
		if (res.status === 429 && attempt < MAX_RETRIES) {
			await sleep(backoffMs(res, attempt));
			continue;
		}

		const text = await res.text();
		const json = (text ? JSON.parse(text) : {}) as T;

		if (!res.ok) {
			// A non-2xx from Slack (rare for the Web API, but possible for 5xx/4xx infra errors).
			throw slackErrorFor(json?.error || `http_${res.status}`, res.status);
		}
		// Slack's logical-failure envelope: HTTP 200 but ok:false. NOT a success — surface error.
		if (!json.ok) {
			throw slackErrorFor(json.error || 'unknown_error', res.status);
		}
		return json;
	}

	throw slackErrorFor('max_retries_exceeded');
}

/**
 * GET a cursor-paginated Slack collection (e.g. conversations.list), following
 * `response_metadata.next_cursor` until exhausted, returning the concatenated values under `key`.
 * Paging is capped to avoid an unbounded loop on a misbehaving endpoint.
 */
export async function slackFetchAll<T = any>(
	token: string,
	method: string,
	key: string,
	baseQuery: SlackFetchOptions['query'] = {},
	maxPages = 50,
): Promise<T[]> {
	const out: T[] = [];
	let cursor: string | undefined;
	let pages = 0;

	do {
		const page = await slackFetch(token, method, { query: { ...baseQuery, ...(cursor ? { cursor } : {}) } });
		const value = page[key];
		if (Array.isArray(value)) {
			out.push(...(value as T[]));
		}
		cursor = page.response_metadata?.next_cursor || undefined;
		pages++;
	} while (cursor && pages < maxPages);

	return out;
}
