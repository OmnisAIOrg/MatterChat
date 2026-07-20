/**
 * Chi Admin Assistant — BYO-LLM chat-with-tools adapter.
 *
 * Two providers behind ONE normalized shape (settings-driven, admin pastes a key):
 *  - `anthropic` (default): POST {base}/v1/messages   (x-api-key, tool_use blocks)
 *  - `openai`:              POST {base}/chat/completions (Bearer, function tool_calls) —
 *                            also covers OpenRouter/any OpenAI-compatible gateway via Base URL.
 *
 * The transcript is kept in a tiny provider-neutral form and mapped per call, so the tool loop
 * in service.ts is provider-blind. Transport mirrors lib/chi/client.ts: lazy serverFetch behind
 * an injectable fetcher (unit tests never touch the network), NEVER throws — every failure maps
 * to { ok:false, note } — and neither prompts nor replies are ever logged.
 */

export type ToolDef = {
	name: string;
	description: string;
	/** JSON Schema for the tool input (Anthropic `input_schema` / OpenAI `parameters`). */
	inputSchema: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

/** One provider-neutral transcript turn. Exactly one of the shapes is populated. */
export type ChiTurn =
	| { kind: 'user'; text: string }
	| { kind: 'assistant'; text?: string; toolCalls?: ToolCall[] }
	| { kind: 'toolResults'; results: { id: string; name: string; content: string; isError?: boolean }[] };

export type LlmConfig = {
	provider: 'anthropic' | 'openai';
	apiKey: string;
	model: string;
	/** Optional override; empty string = provider default. */
	baseUrl?: string;
};

export type LlmStep = { ok: true; text: string; toolCalls: ToolCall[] } | { ok: false; note: string };

export type LlmFetch = (
	url: string,
	options: { method: string; headers: Record<string, string>; body: string; timeout: number },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 2048;

/** Lazy default transport — keeps unit tests free of the @rocket.chat/server-fetch import. */
const defaultFetch: LlmFetch = async (url, options) => {
	const { serverFetch } = await import('@rocket.chat/server-fetch');
	// Operator-configured LLM endpoint (our own key/gateway) — same SSRF stance as lib/chi/client.ts.
	return serverFetch(url, { ...options, ignoreSsrfValidation: true } as Parameters<typeof serverFetch>[1]);
};

const trimBase = (url: string | undefined, fallback: string): string => (url || '').trim().replace(/\/+$/, '') || fallback;

/* ── Anthropic mapping ─────────────────────────────────────────────────────────────── */

function toAnthropicMessages(turns: ChiTurn[]): unknown[] {
	const messages: unknown[] = [];
	for (const t of turns) {
		if (t.kind === 'user') {
			messages.push({ role: 'user', content: t.text });
		} else if (t.kind === 'assistant') {
			const content: unknown[] = [];
			if (t.text) {
				content.push({ type: 'text', text: t.text });
			}
			for (const c of t.toolCalls || []) {
				content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
			}
			messages.push({ role: 'assistant', content });
		} else {
			messages.push({
				role: 'user',
				content: t.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError || undefined })),
			});
		}
	}
	return messages;
}

/** Parse one Anthropic /v1/messages response body into a normalized step (exported for tests). */
export function parseAnthropicResponse(body: unknown): { text: string; toolCalls: ToolCall[] } | undefined {
	const content = (body as { content?: unknown })?.content;
	if (!Array.isArray(content)) {
		return undefined;
	}
	let text = '';
	const toolCalls: ToolCall[] = [];
	for (const block of content) {
		const b = block as { type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
		if (b.type === 'text' && typeof b.text === 'string') {
			text += b.text;
		} else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
			toolCalls.push({ id: b.id, name: b.name, input: (b.input as Record<string, unknown>) || {} });
		}
	}
	return { text: text.trim(), toolCalls };
}

/* ── OpenAI-compatible mapping ─────────────────────────────────────────────────────── */

function toOpenAiMessages(system: string, turns: ChiTurn[]): unknown[] {
	const messages: unknown[] = [{ role: 'system', content: system }];
	for (const t of turns) {
		if (t.kind === 'user') {
			messages.push({ role: 'user', content: t.text });
		} else if (t.kind === 'assistant') {
			messages.push({
				role: 'assistant',
				content: t.text || null,
				...(t.toolCalls?.length
					? {
							tool_calls: t.toolCalls.map((c) => ({
								id: c.id,
								type: 'function',
								function: { name: c.name, arguments: JSON.stringify(c.input) },
							})),
						}
					: {}),
			});
		} else {
			for (const r of t.results) {
				messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
			}
		}
	}
	return messages;
}

/** Parse one chat/completions response body into a normalized step (exported for tests). */
export function parseOpenAiResponse(body: unknown): { text: string; toolCalls: ToolCall[] } | undefined {
	const msg = (body as { choices?: { message?: unknown }[] })?.choices?.[0]?.message as
		| { content?: unknown; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }
		| undefined;
	if (!msg) {
		return undefined;
	}
	const toolCalls: ToolCall[] = [];
	for (const c of msg.tool_calls || []) {
		if (!c?.id || !c.function?.name) {
			continue;
		}
		let input: Record<string, unknown> = {};
		try {
			input = JSON.parse(c.function.arguments || '{}');
		} catch {
			// malformed arguments → surface an empty input; the tool will report the miss
		}
		toolCalls.push({ id: c.id, name: c.function.name, input });
	}
	return { text: typeof msg.content === 'string' ? msg.content.trim() : '', toolCalls };
}

/* ── The one call the loop makes ───────────────────────────────────────────────────── */

/**
 * One model step: system + transcript + tools in, normalized { text, toolCalls } out.
 * NEVER throws; failures come back as { ok:false, note } (status class only — no content).
 */
export async function llmStep(
	config: LlmConfig,
	system: string,
	turns: ChiTurn[],
	tools: ToolDef[],
	opts: { fetcher?: LlmFetch; timeoutMs?: number } = {},
): Promise<LlmStep> {
	const fetcher = opts.fetcher || defaultFetch;
	const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	let url: string;
	let headers: Record<string, string>;
	let body: string;

	if (config.provider === 'openai') {
		url = `${trimBase(config.baseUrl, 'https://api.openai.com/v1')}/chat/completions`;
		headers = { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' };
		body = JSON.stringify({
			model: config.model,
			max_tokens: MAX_OUTPUT_TOKENS,
			messages: toOpenAiMessages(system, turns),
			...(tools.length
				? {
						tools: tools.map((t) => ({
							type: 'function',
							function: { name: t.name, description: t.description, parameters: t.inputSchema },
						})),
					}
				: {}),
		});
	} else {
		url = `${trimBase(config.baseUrl, 'https://api.anthropic.com')}/v1/messages`;
		headers = { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
		body = JSON.stringify({
			model: config.model,
			max_tokens: MAX_OUTPUT_TOKENS,
			system,
			messages: toAnthropicMessages(turns),
			...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {}),
		});
	}

	try {
		const res = await fetcher(url, { method: 'POST', headers, body, timeout });
		if (!res.ok) {
			return { ok: false, note: `The model endpoint answered HTTP ${res.status}. Check the Chi Assistant key/model in admin settings.` };
		}
		const parsed = config.provider === 'openai' ? parseOpenAiResponse(await res.json()) : parseAnthropicResponse(await res.json());
		if (!parsed) {
			return { ok: false, note: 'The model endpoint returned an unexpected shape.' };
		}
		return { ok: true, ...parsed };
	} catch {
		return { ok: false, note: 'Could not reach the model endpoint (network/timeout).' };
	}
}
