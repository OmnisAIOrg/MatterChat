import type { SettingValue } from '@rocket.chat/core-typings';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { settings } from '../../../settings';

/**
 * Boards AI provider seam (M8 — §B "AI", closes the M7 `ai.generate` stub).
 *
 * One {@link IAiProvider} interface, three concrete backings selected by the
 * `Boards_AI_Provider` setting:
 *  - {@link ClaudeProvider}   — calls the Anthropic Messages API directly (matter/lead
 *                               SUMMARIES + free-form custom prompts). Model + key come
 *                               from `Boards_AI_Model` / `Boards_AI_Api_Key`.
 *  - {@link LitDraftProvider} — POSTs the firm's LitDraft service (`Boards_AI_LitDraft_Url`)
 *                               for STOWERS DEMAND drafting (LitDraft owns the demand
 *                               template + exhibit logic; we hand it the matter context).
 *  - {@link DisabledProvider} — provider 'none': everything degrades to a "not configured" note.
 *
 * HARD RULE: NOTHING here throws. Every transport/config failure is caught and returned as a
 * `{ generated:false, note }` result so the caller (the automation action or the REST
 * endpoint) records a clean "AI not configured / unavailable" outcome instead of failing a
 * run. The fork carries no `@anthropic-ai/sdk` dependency, so the Claude call is raw HTTP via
 * the same `@rocket.chat/server-fetch` transport the CasePro RestTransport uses (mirrors
 * lib/boards/casepro/transport.ts) — POST /v1/messages with adaptive thinking on Opus 4.8.
 */

/** What the caller wants generated. `demand` routes to LitDraft; `summary`/`custom` to the LLM. */
export type AiTask = 'summary' | 'demand' | 'custom';

/**
 * Context handed to the provider. `kind` lets a provider tailor the system prompt
 * (matter vs lead); `subjectId` is the CasePro matter id / lead id for the provider's
 * own records; `text` is the pre-rendered, human-readable context block (snapshot fields,
 * medicals, liability — assembled by {@link buildMatterContext}/{@link buildLeadContext}
 * in ./index so the provider stays transport-only and never re-reads CasePro).
 */
export interface AiContext {
	kind: 'matter' | 'lead' | 'card';
	subjectId?: string;
	/** Human-readable, already-interpolated context the model reasons over. */
	text: string;
	/** Optional structured extras a provider may forward verbatim (LitDraft demand payload). */
	fields?: Record<string, unknown>;
}

export interface AiGenerateInput {
	task: AiTask;
	context: AiContext;
	/** Optional caller prompt; overrides/augments the task's default instruction. */
	prompt?: string;
}

export interface AiGenerateOutput {
	/** Whether a real provider produced `text` (false = degraded / not configured / failed). */
	generated: boolean;
	/** The generated text (empty when not generated). */
	text: string;
	/** Which backing produced (or declined) this — for the run-log / audit row. */
	provider: 'claude' | 'litdraft' | 'none';
	/** A short human note when degraded (e.g. "AI not configured", "provider error"). */
	note?: string;
}

/** The pluggable AI backend. Implementations MUST NOT throw — degrade and return instead. */
export interface IAiProvider {
	readonly id: 'claude' | 'litdraft' | 'none';
	generate(input: AiGenerateInput): Promise<AiGenerateOutput>;
}

// ---------------------------------------------------------------------------
// Settings helpers (best-effort; settings.get can throw before registration)
// ---------------------------------------------------------------------------

function getSetting<T extends SettingValue = string>(id: string): T | undefined {
	try {
		return settings.get<T>(id);
	} catch {
		return undefined;
	}
}

function providerChoice(): string {
	return (getSetting<string>('Boards_AI_Provider') || 'claude').toLowerCase();
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Default system instruction per task. Kept terse and grounded so a summary stays
 * factual (no fabricated specials) and a custom prompt has a sane legal-PI persona.
 * The firm voice ("The Nguyen Law Firm") matches the interpolate.ts firmName default.
 */
function systemPromptFor(task: AiTask, kind: AiContext['kind']): string {
	const subject = kind === 'lead' ? 'a prospective personal-injury client (intake lead)' : 'a personal-injury matter';
	switch (task) {
		case 'summary':
			return [
				`You are a legal assistant at a personal-injury law firm summarizing ${subject} for the case team.`,
				'Write a concise, factual status summary (4-8 sentences): who the client is, the incident, treatment/medical posture, liability, and the current settlement/negotiation status.',
				'Use ONLY the facts provided. Do not invent damages, dates, or amounts. If a fact is missing, omit it rather than guessing.',
			].join(' ');
		case 'custom':
			return `You are a legal assistant at a personal-injury law firm working on ${subject}. Answer using only the facts provided; do not fabricate details.`;
		case 'demand':
			// demand is normally routed to LitDraft; this is the LLM fallback persona.
			return [
				'You are a personal-injury attorney drafting a Stowers settlement demand letter.',
				'Use only the facts provided (liability, medical specials, injuries, policy limits). Do not fabricate medical bills, providers, or amounts.',
				'Produce a professional demand letter body suitable for an attorney to review and finalize.',
			].join(' ');
		default:
			return 'You are a helpful legal assistant. Use only the facts provided.';
	}
}

/** Compose the user message: the rendered context block plus any caller prompt. */
function userMessageFor(input: AiGenerateInput): string {
	const parts: string[] = [];
	if (input.prompt) {
		parts.push(input.prompt.trim());
	}
	if (input.context.text) {
		parts.push(`Context:\n${input.context.text.trim()}`);
	}
	if (!parts.length) {
		parts.push('No context was supplied.');
	}
	return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Claude provider — Anthropic Messages API (raw HTTP, no SDK in this fork)
// ---------------------------------------------------------------------------

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 4096;

/** Shape of the Anthropic Messages response we read (content is a block array). */
type AnthropicMessageResponse = {
	content?: { type?: string; text?: string }[];
	stop_reason?: string;
	error?: { type?: string; message?: string };
};

class ClaudeProvider implements IAiProvider {
	readonly id = 'claude' as const;

	async generate(input: AiGenerateInput): Promise<AiGenerateOutput> {
		const apiKey = getSetting<string>('Boards_AI_Api_Key');
		if (!apiKey) {
			// Graceful degrade — no key configured. NEVER throw.
			return { generated: false, text: '', provider: 'claude', note: 'AI not configured (no API key)' };
		}
		const model = getSetting<string>('Boards_AI_Model') || DEFAULT_MODEL;

		try {
			const res = await fetch(ANTHROPIC_MESSAGES_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': ANTHROPIC_VERSION,
				},
				body: JSON.stringify({
					model,
					max_tokens: MAX_TOKENS,
					// Adaptive thinking is the recommended mode on Opus 4.8 (skill: claude-api).
					thinking: { type: 'adaptive' },
					system: systemPromptFor(input.task, input.context.kind),
					messages: [{ role: 'user', content: userMessageFor(input) }],
				}),
				// CasePro transport precedent: allow the outbound call (no per-org allow-list yet).
				ignoreSsrfValidation: true,
			});

			if (!res.ok) {
				const status = res.status;
				return { generated: false, text: '', provider: 'claude', note: `Claude request failed (${status})` };
			}

			const json = (await res.json()) as AnthropicMessageResponse;
			if (json.error) {
				return { generated: false, text: '', provider: 'claude', note: `Claude error: ${json.error.type ?? 'unknown'}` };
			}
			// A safety refusal returns 200 with stop_reason 'refusal' — treat as a clean degrade.
			if (json.stop_reason === 'refusal') {
				return { generated: false, text: '', provider: 'claude', note: 'Claude declined the request' };
			}

			// Concatenate the text blocks (adaptive thinking yields thinking + text blocks;
			// we only surface the visible text, never the reasoning).
			const text = (json.content ?? [])
				.filter((b) => b.type === 'text' && typeof b.text === 'string')
				.map((b) => b.text as string)
				.join('')
				.trim();

			if (!text) {
				return { generated: false, text: '', provider: 'claude', note: 'Claude returned no text' };
			}
			return { generated: true, text, provider: 'claude' };
		} catch (err) {
			// Transport blew up (network/DNS/timeout) — degrade, never throw.
			const message = err instanceof Error ? err.message : String(err);
			return { generated: false, text: '', provider: 'claude', note: `Claude unavailable: ${message}` };
		}
	}
}

// ---------------------------------------------------------------------------
// LitDraft provider — POST the firm's LitDraft service for demand drafting
// ---------------------------------------------------------------------------

/** Shape of the LitDraft draft response we read (lenient — LitDraft owns the contract). */
type LitDraftResponse = {
	text?: string;
	draft?: string;
	content?: string;
	error?: string;
};

class LitDraftProvider implements IAiProvider {
	readonly id = 'litdraft' as const;

	async generate(input: AiGenerateInput): Promise<AiGenerateOutput> {
		const base = (getSetting<string>('Boards_AI_LitDraft_Url') || '').replace(/\/+$/, '');
		if (!base) {
			return { generated: false, text: '', provider: 'litdraft', note: 'AI not configured (no LitDraft URL)' };
		}

		// LitDraft is the demand engine; summaries/custom prompts aren't its job — degrade.
		if (input.task !== 'demand') {
			return {
				generated: false,
				text: '',
				provider: 'litdraft',
				note: `LitDraft provider only handles demand drafting (got "${input.task}")`,
			};
		}

		const apiKey = getSetting<string>('Boards_AI_Api_Key');
		try {
			const res = await fetch(`${base}/api/v1/demand/draft`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
				},
				body: JSON.stringify({
					task: 'demand',
					...(input.context.subjectId ? { matterId: input.context.subjectId } : {}),
					context: input.context.text,
					...(input.context.fields ? { fields: input.context.fields } : {}),
					...(input.prompt ? { prompt: input.prompt } : {}),
				}),
				ignoreSsrfValidation: true,
			});

			if (!res.ok) {
				return { generated: false, text: '', provider: 'litdraft', note: `LitDraft request failed (${res.status})` };
			}
			const json = (await res.json()) as LitDraftResponse;
			if (json.error) {
				return { generated: false, text: '', provider: 'litdraft', note: `LitDraft error: ${json.error}` };
			}
			const text = (json.text ?? json.draft ?? json.content ?? '').trim();
			if (!text) {
				return { generated: false, text: '', provider: 'litdraft', note: 'LitDraft returned no draft' };
			}
			return { generated: true, text, provider: 'litdraft' };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { generated: false, text: '', provider: 'litdraft', note: `LitDraft unavailable: ${message}` };
		}
	}
}

// ---------------------------------------------------------------------------
// Disabled provider — provider 'none'
// ---------------------------------------------------------------------------

class DisabledProvider implements IAiProvider {
	readonly id = 'none' as const;

	async generate(): Promise<AiGenerateOutput> {
		return { generated: false, text: '', provider: 'none', note: 'AI disabled (Boards_AI_Provider = none)' };
	}
}

// ---------------------------------------------------------------------------
// Selection — by setting, with a test/runtime override hook
// ---------------------------------------------------------------------------

const claudeProvider = new ClaudeProvider();
const litdraftProvider = new LitDraftProvider();
const disabledProvider = new DisabledProvider();

let providerOverride: IAiProvider | undefined;

/** Override the active provider (tests / runtime swap); pass undefined to revert to config. */
export function setAiProviderOverride(provider?: IAiProvider): void {
	providerOverride = provider;
}

/**
 * Resolve the provider for a given task.
 *
 * Routing rule: a `demand` task always prefers LitDraft when configured (it owns the
 * Stowers template + exhibits); if LitDraft isn't selected/configured we still try the
 * configured provider so a Claude-only firm can produce a fallback demand body. Everything
 * else uses the configured provider. `none` short-circuits to the disabled provider.
 */
export function resolveAiProvider(task: AiTask): IAiProvider {
	if (providerOverride) {
		return providerOverride;
	}
	const choice = providerChoice();
	if (choice === 'none') {
		return disabledProvider;
	}
	if (task === 'demand') {
		// Prefer LitDraft for demands when it's the selected provider OR a URL is set.
		if (choice === 'litdraft' || getSetting<string>('Boards_AI_LitDraft_Url')) {
			return litdraftProvider;
		}
		return claudeProvider;
	}
	if (choice === 'litdraft') {
		// LitDraft selected but a summary/custom was asked — Claude is the LLM backing.
		return claudeProvider;
	}
	return claudeProvider;
}
