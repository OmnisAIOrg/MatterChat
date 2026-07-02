import { getChiConfig } from './config';
import { buildChiMessage, parseChiReply, type ChiQuestionContext } from './context';

/**
 * CHI assistant — invoke adapter (transport only; never throws).
 *
 * ── CONTRACT (documented best guess — VERIFY before staging go-live) ────────────────
 * Source: omnis-os `ai-agents` skill, api.md ("Chat & testing"):
 *
 *   POST {CHI_API_URL}/api/v1/chat/agents/{CHI_AGENT_ID}/chat
 *
 * is the AI-Agents backend's text-chat invoke for a single agent (there is also
 * `POST .../chat/start` for explicit sessions; we send a single self-contained message
 * per question, so no session bootstrap here).
 *
 * Auth (per api.md "Auth model"): user endpoints accept `Authorization: Bearer <token>`
 * validated against CentralizedAuth `/auth/session`; the S2S surface uses `X-API-Key`
 * (`chi_api_keys` table, currently documented only for `/casepro/*`). Because the chat
 * group's exact server-side auth for S2S callers is NOT pinned in the docs, we send the
 * one configured credential under BOTH headers — whichever the deployment honors wins.
 *
 * EXACT VERIFICATION STEP (deploy-time): with a live AI-Agents staging token, run
 *   curl -s -X POST "$CHI_API_URL/api/v1/chat/agents/$CHI_AGENT_ID/chat" \
 *     -H "Authorization: Bearer $CHI_API_KEY" -H "X-API-Key: $CHI_API_KEY" \
 *     -H 'Content-Type: application/json' -d '{"message":"ping"}'
 * and confirm (a) which header authenticates, (b) the request field name (`message`),
 * (c) the response answer field — then pin them here and drop the dual-header send.
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * PRIVACY: this module never logs the question or the answer. Failures surface as a
 * short `note` (status/class only) for the in-channel friendly error.
 */

export type ChiAnswer =
	| { ok: true; text: string }
	| { ok: false; note: string; reason: 'not_configured' | 'http' | 'empty' | 'unavailable' };

/** Minimal fetch shape so tests inject a fake and no network/module load is needed. */
export type ChiFetch = (
	url: string,
	options: { method: string; headers: Record<string, string>; body: string; timeout: number },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type AskChiOptions = {
	fetcher?: ChiFetch;
	env?: NodeJS.ProcessEnv;
	/** Agent calls can take a while — default 45s (serverFetch's own default is 20s). */
	timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 45_000;

/** Lazy default transport — keeps unit tests free of the @rocket.chat/server-fetch import. */
const defaultFetch: ChiFetch = async (url, options) => {
	const { serverFetch } = await import('@rocket.chat/server-fetch');
	// Mirrors lib/boards/ai/provider.ts (CasePro transport precedent): outbound service
	// call to our own platform, so SSRF validation of the operator-configured URL is skipped.
	return serverFetch(url, { ...options, ignoreSsrfValidation: true } as Parameters<typeof serverFetch>[1]);
};

/**
 * Ask the CHI agent one question, with room context. NEVER throws — every failure mode
 * returns `{ ok: false, note }` so the caller can post a friendly in-channel message.
 */
export async function askChi(ctx: ChiQuestionContext, opts: AskChiOptions = {}): Promise<ChiAnswer> {
	const config = getChiConfig(opts.env);
	if (!config) {
		return { ok: false, reason: 'not_configured', note: 'CHI is not configured on this workspace.' };
	}

	const url = `${config.apiUrl}/api/v1/chat/agents/${encodeURIComponent(config.agentId)}/chat`;
	const fetcher = opts.fetcher ?? defaultFetch;

	try {
		const res = await fetcher(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				// Dual-header send — see CONTRACT note above.
				'Authorization': `Bearer ${config.apiKey}`,
				'X-API-Key': config.apiKey,
			},
			body: JSON.stringify({ message: buildChiMessage(ctx) }),
			timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		});

		if (!res.ok) {
			return { ok: false, reason: 'http', note: `CHI request failed (${res.status})` };
		}

		const text = parseChiReply(await res.json());
		if (!text) {
			return { ok: false, reason: 'empty', note: 'CHI returned no answer' };
		}
		return { ok: true, text };
	} catch (err) {
		// Timeout / DNS / network — degrade quietly; never include message content.
		const message = err instanceof Error ? err.name || 'Error' : 'Error';
		return { ok: false, reason: 'unavailable', note: `CHI is unavailable (${message})` };
	}
}
