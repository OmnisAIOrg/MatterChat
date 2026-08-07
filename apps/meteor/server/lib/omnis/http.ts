import { serverFetch } from '@rocket.chat/server-fetch';

import type { OmnisProductConfig } from './config';

/**
 * The ONE place an Omnis product integration touches the wire.
 *
 * Two traps live here, both of which fail in ways whose error text points
 * somewhere unhelpful:
 *
 * 1. **`serverFetch` JSON-stringifies any non-Buffer object body.**
 *    `packages/server-fetch/src/parsers.ts`:
 *      `if (typeof options.body === 'object' && !Buffer.isBuffer(options.body)) { options.body = JSON.stringify(options.body); }`
 *    The default parser is the JSON parser (no Content-Type ⇒ JSON), so handing
 *    it a real `FormData` sends the literal string `{}` and the upload fails as
 *    though the REMOTE service were broken. Buffers pass through untouched, so
 *    multipart must be assembled into a Buffer here — see {@link buildMultipartBody}.
 *    (`getUploadFormData` in `server/api/lib/getUploadFormData.ts` is for INBOUND
 *    uploads into a REST route; it does not help with outbound.)
 *
 * 2. **`serverFetch` options are a discriminated union.** Every call must carry
 *    either `ignoreSsrfValidation: true` or `{ ignoreSsrfValidation: false, allowList }`.
 *    We always take the allow-list branch, pinned to the configured host, so a
 *    mistyped base URL cannot be turned into an internal-network probe.
 */

export type OmnisRequestInit = {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	/** JSON body. Mutually exclusive with `raw`. */
	json?: unknown;
	/** Pre-built body (multipart Buffer). Mutually exclusive with `json`. */
	raw?: { body: Buffer; contentType: string };
	query?: Record<string, string | number | boolean | undefined>;
	headers?: Record<string, string>;
	timeoutMs?: number;
};

export class OmnisHttpError extends Error {
	constructor(
		readonly status: number,
		readonly body: string,
		message?: string,
	) {
		super(message ?? `Upstream responded ${status}`);
		this.name = 'OmnisHttpError';
	}
}

/** Host of the configured base URL — the only host any call to this product may reach. */
export function allowListFor(cfg: OmnisProductConfig): string[] {
	try {
		return [new URL(cfg.baseUrl).host];
	} catch {
		return [];
	}
}

/** Auth header for the configured mode. `internal-key` is a service key; `bearer` is a token. */
export function authHeaders(cfg: OmnisProductConfig): Record<string, string> {
	if (!cfg.apiKey) {
		return {};
	}
	return cfg.authMode === 'bearer' ? { Authorization: `Bearer ${cfg.apiKey}` } : { 'X-Internal-Key': cfg.apiKey };
}

function withQuery(url: string, query?: OmnisRequestInit['query']): string {
	if (!query) {
		return url;
	}
	const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== '');
	if (entries.length === 0) {
		return url;
	}
	const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
	return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

/**
 * Authenticated request against a product's configured base URL.
 * Throws {@link OmnisHttpError} on a non-2xx — callers decide whether that
 * degrades (reads) or propagates (writes).
 */
/**
 * `serverFetch` returns node-fetch's Response, which is NOT structurally the
 * DOM `Response` (it lacks `bytes`/`formData`). Deriving the type from the
 * function keeps us honest instead of asserting a lie.
 */
type ServerFetchResponse = Awaited<ReturnType<typeof serverFetch>>;

export async function omnisFetch(cfg: OmnisProductConfig, path: string, init: OmnisRequestInit = {}): Promise<ServerFetchResponse> {
	const base = cfg.baseUrl.replace(/\/+$/, '');
	const url = withQuery(`${base}/${path.replace(/^\/+/, '')}`, init.query);

	const headers: Record<string, string> = {
		Accept: 'application/json',
		...authHeaders(cfg),
		...(cfg.orgId ? { 'X-Org-Id': cfg.orgId } : {}),
		...init.headers,
	};

	let body: Buffer | string | undefined;
	if (init.raw) {
		body = init.raw.body;
		headers['Content-Type'] = init.raw.contentType;
	} else if (init.json !== undefined) {
		body = JSON.stringify(init.json);
		headers['Content-Type'] = 'application/json';
	}

	const response = await serverFetch(url, {
		method: init.method ?? 'GET',
		headers,
		...(body !== undefined ? { body } : {}),
		...(init.timeoutMs ? { timeout: init.timeoutMs } : {}),
		// Host-pinned: a mistyped base URL cannot become an internal-network probe.
		ignoreSsrfValidation: false,
		allowList: allowListFor(cfg),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new OmnisHttpError(response.status, text);
	}
	return response;
}

/** {@link omnisFetch} + JSON decode. */
export async function omnisFetchJson<T>(cfg: OmnisProductConfig, path: string, init: OmnisRequestInit = {}): Promise<T> {
	const response = await omnisFetch(cfg, path, init);
	return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Multipart
// ---------------------------------------------------------------------------

export type MultipartField = { name: string; value: string };

export type MultipartFile = {
	name: string;
	filename: string;
	contentType: string;
	content: Buffer;
};

export type MultipartBody = { body: Buffer; contentType: string };

/** RFC 2388 quoting: escape the two characters that would break a quoted-string. */
function quote(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Assemble a multipart/form-data body into a Buffer.
 *
 * A Buffer is the whole point — see the note at the top of this file. Passing a
 * `FormData` to `serverFetch` silently sends `{}`.
 *
 * The boundary is derived from a random token and is checked against the
 * payload: a boundary that occurs inside file content would truncate the part,
 * so we regenerate until it does not (in practice, never more than once).
 */
export function buildMultipartBody(fields: MultipartField[], files: MultipartFile[] = []): MultipartBody {
	const boundary = pickBoundary(files);
	const chunks: Buffer[] = [];

	for (const field of fields) {
		chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(field.name)}"\r\n\r\n${field.value}\r\n`, 'utf8'));
	}

	for (const file of files) {
		chunks.push(
			Buffer.from(
				`--${boundary}\r\n` +
					`Content-Disposition: form-data; name="${quote(file.name)}"; filename="${quote(file.filename)}"\r\n` +
					`Content-Type: ${file.contentType}\r\n\r\n`,
				'utf8',
			),
			file.content,
			Buffer.from('\r\n', 'utf8'),
		);
	}

	chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

	return {
		body: Buffer.concat(chunks),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

function pickBoundary(files: MultipartFile[]): string {
	for (let attempt = 0; attempt < 8; attempt++) {
		const candidate = `----OmnisFormBoundary${randomToken()}`;
		const marker = Buffer.from(candidate, 'utf8');
		if (!files.some((file) => file.content.includes(marker))) {
			return candidate;
		}
	}
	// Astronomically unreachable; a distinct suffix keeps the failure debuggable.
	return `----OmnisFormBoundary${randomToken()}${randomToken()}`;
}

function randomToken(): string {
	return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}
