/**
 * MATTERCHAT: the pluggable embedding client behind Chi "Ask Anything" (F9).
 *
 * ONE wire format — the OpenAI-compatible `POST {base}/embeddings` — because every provider
 * worth supporting speaks it (OpenAI, Together, Voyage's compat layer, Ollama, LM Studio,
 * llama.cpp, any gateway). Base URL + key + model are settings, so a workspace can point at
 * a model running on its own machine and never send a client's messages to a third party.
 *
 * ## Unset = off, and off must not mean broken
 *
 * There is no default endpoint and no default key. With nothing configured every function
 * here returns `null`, and the caller falls back to keyword retrieval. Nothing throws, ever
 * — a workspace that never opens the Chi settings page must see a feature that quietly does
 * less, not a feature that errors. That is the house rule in this codebase and it is the
 * reason `embedTexts` returns `number[][] | null` rather than rejecting.
 *
 * Transport mirrors server/lib/chi/admin/llm.ts: lazy `serverFetch` behind an injectable
 * fetcher (so unit tests never touch the network), and neither the texts nor the vectors are
 * ever logged.
 */
import { settings } from '../../../settings';

export type EmbeddingConfig = {
	/** No trailing slash. */
	baseUrl: string;
	/** Empty for a local provider that wants no auth. */
	apiKey: string;
	model: string;
	/** 0 = whatever the model returns natively. */
	dimensions: number;
};

export type EmbeddingFetch = (
	url: string,
	options: { method: string; headers: Record<string, string>; body: string; timeout: number },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type EmbedOptions = {
	fetcher?: EmbeddingFetch;
	timeoutMs?: number;
	config?: EmbeddingConfig | null;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/** Providers cap request size; batching also keeps one bad chunk from failing a whole backfill. */
export const EMBED_BATCH_SIZE = 64;

/** Nothing useful comes back from embedding a novel, and providers reject it outright. */
export const MAX_EMBED_CHARS = 8000;

/**
 * Same interop dance as llm.ts. Under Meteor's module interop a dynamic
 * `import('@rocket.chat/server-fetch')` does NOT reliably expose the named `serverFetch`
 * export, so resolve it across every shape rather than trusting one.
 */
const defaultFetch: EmbeddingFetch = async (url, options) => {
	const mod = (await import('@rocket.chat/server-fetch')) as Record<string, unknown> & { default?: Record<string, unknown> };
	const serverFetch = (mod.serverFetch || mod.default?.serverFetch || mod.default) as
		| ((u: string, o: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>)
		| undefined;
	if (typeof serverFetch !== 'function') {
		throw new Error('server-fetch transport unavailable (interop)');
	}
	// Operator-configured endpoint (often localhost, deliberately) — same SSRF stance as llm.ts.
	return serverFetch(url, { ...options, ignoreSsrfValidation: true });
};

const str = (id: string): string => {
	try {
		const value = settings.get<string>(id);
		return typeof value === 'string' ? value.trim() : '';
	} catch {
		return '';
	}
};

/**
 * Resolve the configured provider, or `null` when the feature is off.
 *
 * "Off" is any of: the switch is off, no base URL, no model. The API key is optional on
 * purpose — a local Ollama/LM Studio endpoint needs none, and demanding one there would push
 * workspaces towards a hosted provider for no reason.
 */
export function getEmbeddingConfig(): EmbeddingConfig | null {
	let enabled: boolean;
	try {
		enabled = settings.get<boolean>('Chi_Search_Embeddings_Enabled') === true;
	} catch {
		// Settings not booted (or the setting was never registered) — the feature is simply off.
		return null;
	}
	if (!enabled) {
		return null;
	}
	const baseUrl = str('Chi_Search_Embeddings_Base_URL').replace(/\/+$/, '');
	const model = str('Chi_Search_Embeddings_Model');
	if (!baseUrl || !model) {
		return null;
	}
	let dimensions = 0;
	try {
		const raw = settings.get<number>('Chi_Search_Embeddings_Dimensions');
		if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
			dimensions = Math.floor(raw);
		}
	} catch {
		// Leave it at 0 — the provider's native size.
	}
	return { baseUrl, apiKey: str('Chi_Search_Embeddings_API_Key'), model, dimensions };
}

/** True when Ask Anything can do semantic retrieval at all. */
export function isEmbeddingConfigured(): boolean {
	return getEmbeddingConfig() !== null;
}

/** Parse one `/embeddings` response body. Exported for tests. */
export function parseEmbeddingResponse(body: unknown, expected: number): number[][] | null {
	const data = (body as { data?: unknown })?.data;
	if (!Array.isArray(data) || data.length !== expected) {
		return null;
	}
	const vectors: number[][] = [];
	for (const row of data) {
		// `index` is authoritative: providers are allowed to return the batch out of order.
		const entry = row as { embedding?: unknown; index?: unknown };
		const vector = entry?.embedding;
		if (!Array.isArray(vector) || !vector.length || !vector.every((n) => typeof n === 'number' && Number.isFinite(n))) {
			return null;
		}
		const at = typeof entry.index === 'number' && entry.index >= 0 && entry.index < expected ? entry.index : vectors.length;
		vectors[at] = vector as number[];
	}
	return vectors.length === expected && vectors.every(Array.isArray) ? vectors : null;
}

async function embedBatch(config: EmbeddingConfig, texts: string[], options: EmbedOptions): Promise<number[][] | null> {
	const fetcher = options.fetcher || defaultFetch;
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (config.apiKey) {
		headers.Authorization = `Bearer ${config.apiKey}`;
	}
	const body = JSON.stringify({
		model: config.model,
		input: texts,
		...(config.dimensions > 0 ? { dimensions: config.dimensions } : {}),
	});

	try {
		const res = await fetcher(`${config.baseUrl}/embeddings`, {
			method: 'POST',
			headers,
			body,
			timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		});
		if (!res.ok) {
			return null;
		}
		return parseEmbeddingResponse(await res.json(), texts.length);
	} catch {
		// Unreachable endpoint, DNS failure, timeout — all "no vectors", never an exception.
		return null;
	}
}

/**
 * Embed a list of texts, preserving order.
 *
 * `null` means "could not embed" — unconfigured, unreachable, rejected, or a malformed
 * response. It is deliberately all-or-nothing per call: a half-embedded batch would silently
 * index some passages and skip others, and the missing ones would look like messages that
 * were never said.
 */
export async function embedTexts(texts: readonly string[], options: EmbedOptions = {}): Promise<number[][] | null> {
	const config = options.config === undefined ? getEmbeddingConfig() : options.config;
	if (!config) {
		return null;
	}
	const prepared = (texts || []).map((text) => (text || '').slice(0, MAX_EMBED_CHARS));
	// Refuse blanks up front rather than dropping them: a shorter result array than the input
	// array is a positional mismatch waiting to attach the wrong vector to the wrong passage.
	if (!prepared.length || prepared.some((text) => !text.trim())) {
		return null;
	}

	const out: number[][] = [];
	for (let i = 0; i < prepared.length; i += EMBED_BATCH_SIZE) {
		const batch = await embedBatch(config, prepared.slice(i, i + EMBED_BATCH_SIZE), options);
		if (!batch) {
			return null;
		}
		out.push(...batch);
	}
	return out.length === prepared.length ? out : null;
}

/** Embed one string. `null` when embeddings are unavailable — the caller falls back to keywords. */
export async function embedOne(text: string, options: EmbedOptions = {}): Promise<number[] | null> {
	const vectors = await embedTexts([text], options);
	return vectors?.[0] ?? null;
}
