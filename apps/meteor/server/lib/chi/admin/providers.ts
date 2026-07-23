/**
 * Chi Admin Assistant — provider presets.
 *
 * The admin picks a provider by NAME (Anthropic / OpenAI / Cerebras / Groq / OpenRouter /
 * custom); this maps it to the wire `family` llm.ts speaks (Anthropic messages vs
 * OpenAI-compatible chat/completions), the correct base URL, and a sensible default model —
 * so nobody hand-types an endpoint. Base URL / Model fields, when set, override the preset
 * (needed for OpenRouter/custom and for pinning a specific model). Pure + unit-tested.
 */
import type { LlmConfig } from './llm';

export type ProviderPreset = {
	/** Wire format llm.ts implements. */
	family: LlmConfig['provider'];
	/** Default endpoint base (no trailing slash); '' means "the admin must supply a Base URL". */
	baseUrl: string;
	/** Default model id for this provider (tool-use capable where the provider supports it). */
	defaultModel: string;
	/** Runs on the workspace's own machine (Ollama/LM Studio/llama.cpp) — no API key required. */
	local?: boolean;
};

/**
 * Cerebras/Groq/OpenRouter are all OpenAI-compatible (Bearer + /chat/completions + function
 * tools), so they share the 'openai' family and differ only by base URL + model. Endpoints
 * verified 2026-07: Cerebras https://api.cerebras.ai/v1, Groq https://api.groq.com/openai/v1,
 * OpenRouter https://openrouter.ai/api/v1.
 */
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
	anthropic: { family: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-5' },
	openai: { family: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
	cerebras: { family: 'openai', baseUrl: 'https://api.cerebras.ai/v1', defaultModel: 'llama-3.3-70b' },
	groq: { family: 'openai', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
	openrouter: { family: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-5' },
	// xAI + DeepSeek + Gemini all speak OpenAI-compatible chat/completions too. Endpoints
	// verified 2026-07: xAI https://api.x.ai/v1, DeepSeek https://api.deepseek.com/v1,
	// Gemini's OpenAI-compat layer https://generativelanguage.googleapis.com/v1beta/openai.
	xai: { family: 'openai', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4' },
	deepseek: { family: 'openai', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
	gemini: { family: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-pro' },
	// LOCAL, $0, private — an OpenAI-compatible server running on the WORKSPACE HOST (these
	// localhost URLs resolve on the Meteor server, not the member's browser). No API key needed;
	// llmConfig substitutes a placeholder bearer. Mirrors the Chi orb's "On this computer" list.
	ollama: { family: 'openai', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1:8b', local: true },
	lmstudio: { family: 'openai', baseUrl: 'http://localhost:1234/v1', defaultModel: '', local: true },
	llamacpp: { family: 'openai', baseUrl: 'http://localhost:8080/v1', defaultModel: '', local: true },
	// Any other OpenAI-compatible endpoint — the admin supplies the Base URL and Model.
	custom: { family: 'openai', baseUrl: '', defaultModel: '' },
};

/** True when the chosen provider runs locally on the workspace host (no API key required). */
export function isLocalProvider(providerId: string | undefined): boolean {
	return Boolean(PROVIDER_PRESETS[(providerId || '').trim()]?.local);
}

export const PROVIDER_IDS = Object.keys(PROVIDER_PRESETS);

/**
 * Resolve a chosen provider + optional overrides into the concrete { family, baseUrl, model }
 * llm.ts needs. Unknown provider ids fall back to Anthropic. A blank base URL for the openai
 * family defaults to OpenAI's own endpoint (so a bare "custom" still points somewhere valid).
 */
export function resolveProvider(
	providerId: string | undefined,
	overrideBaseUrl?: string,
	overrideModel?: string,
): { family: LlmConfig['provider']; baseUrl: string | undefined; model: string } {
	const preset = PROVIDER_PRESETS[(providerId || '').trim()] || PROVIDER_PRESETS.anthropic;
	const baseUrl = (overrideBaseUrl || '').trim() || preset.baseUrl;
	const model = (overrideModel || '').trim() || preset.defaultModel || (preset.family === 'openai' ? 'gpt-4o' : 'claude-sonnet-5');
	return { family: preset.family, baseUrl: baseUrl || undefined, model };
}
