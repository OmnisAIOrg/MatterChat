import { Users } from '@rocket.chat/models';

import { API } from '../api';
import { getUploadFormData } from '../lib/getUploadFormData';
import { runChiOrbTurn } from '../../../../server/lib/chi/admin/service';
import type { ChiOrbHistory, ChiOrbContext } from '../../../../server/lib/chi/admin/service';
import { settings } from '../../../settings/server';

// Turn discipline is half the fix — ported from EvidenceHunt's realtime prompt, which learned these the
// hard way ("actions initiated before the user is done / having to wait / it froze / it claimed it did
// something it didn't"): speak-first-then-act, wait for the finished thought, never claim un-done work,
// and require an explicit spoken confirm for anything destructive.
const REALTIME_INSTRUCTIONS =
	'You are Chi, the MatterChat workspace assistant, talking with a member by voice. Speak naturally and keep ' +
	'every reply SHORT — one to three sentences, never read lists aloud — so you hand the turn back quickly. ' +
	'Let the member FINISH their thought before you act; do not act on a half-sentence. ' +
	'You can DO things, not just talk. Whenever they ask you to navigate (open a channel, DM, or view), ' +
	'summarize, look something up, create or manage users, change an allowed setting, or take ANY action, use ' +
	'the do_it function with their request in plain natural language — it runs with THE MEMBER’S OWN permissions. ' +
	'NEVER tell them to type it themselves; you have the same reach they do. ' +
	'SPEAK FIRST, THEN ACT: the instant you decide to do something, say a 3–6 word acknowledgment FIRST ' +
	'("Opening that now", "One sec — checking") — THEN call do_it — THEN give a one-line confirmation of what ' +
	'happened. Dead air while a tool runs reads as a freeze. ' +
	'Be honest: NEVER say something was posted, created, changed, or opened unless do_it actually returned ' +
	'success. If you did not call do_it, it did not happen — report failures plainly. ' +
	'For anything destructive or outward-facing (deleting, creating a user, posting to a channel), do_it will ' +
	'report that confirmation is required: tell the member EXACTLY what you’re about to do, then wait for an ' +
	'explicit "yes" before calling do_it again with "yes" (or "no" to cancel). Never assume approval. ' +
	'If the member corrects anything, immediately call do_it again with the correction. ' +
	'After you act or answer, when there are obvious next steps, call suggest_actions to give them tappable ' +
	'buttons. Only answer directly (no tool) for pure questions or small talk.';

// GA flat function schema (type/name/description/parameters at top level — NO nested "function" wrapper).
// do_it is a single meta-tool: it forwards the member's natural-language request to the SAME chi.ask turn
// the typed orb uses, so navigation, summaries, user management, settings and the confirm/park flow are all
// reused with the member's own permissions — no separate realtime tool registry to keep in sync.
const REALTIME_TOOLS = [
	{
		type: 'function',
		name: 'do_it',
		description:
			'Do something for the member in MatterChat: navigate the UI (open a channel/DM/view), summarize a ' +
			'channel or their day, look someone up, create or manage users, change an allowed setting, or any ' +
			'other workspace action. Runs with the MEMBER’S OWN permissions and returns what happened. Use ' +
			'this for ANY actionable request instead of telling them to type it. Pass the request verbatim in ' +
			'natural language (e.g. "take me to the general channel", "summarize the deals channel", "create a ' +
			'user named Sam Rivera"). If the result says confirmation is needed, relay that and, when the member ' +
			'says yes, call do_it again with "yes".',
		parameters: {
			type: 'object',
			properties: { request: { type: 'string', description: 'The member’s request, verbatim, in natural language.' } },
			required: ['request'],
		},
	},
	{
		type: 'function',
		name: 'suggest_actions',
		description:
			'Offer up to 3 quick action buttons the member can tap to run next — use whenever there are obvious ' +
			'next steps. Each action has a short button label and the full natural-language command to run when tapped.',
		parameters: {
			type: 'object',
			properties: {
				actions: {
					type: 'array',
					items: {
						type: 'object',
						properties: { label: { type: 'string' }, command: { type: 'string' } },
						required: ['label', 'command'],
					},
				},
			},
			required: ['actions'],
		},
	},
];

/**
 * Chi copilot endpoint for the floating orb. Runs ONE Chi turn AS the authenticated user (same
 * caller-scoped tools, confirm/park and audit as the @chi.bot DM) and returns the reply plus any
 * client UI actions (e.g. navigate) the orb should perform. Distinct from the DM path so orb-only
 * structured actions never leak into a chat message.
 */
API.v1.addRoute(
	'chi.ask',
	{ authRequired: true, rateLimiterOptions: { numRequestsAllowed: 30, intervalTimeInMS: 60000 } },
	{
		async post() {
			// This route is not declared in rest-typings, so `this` types as Operations<never>.
			const { userId, bodyParams } = this as unknown as {
				userId: string;
				bodyParams: { text?: unknown; history?: unknown; context?: unknown };
			};
			const text = typeof bodyParams?.text === 'string' ? bodyParams.text : '';
			if (!text.trim()) {
				return API.v1.failure('text is required');
			}
			const history: ChiOrbHistory[] = Array.isArray(bodyParams?.history)
				? (bodyParams.history as unknown[])
						.filter((h): h is { who: unknown; text: unknown } => Boolean(h) && typeof h === 'object')
						.map((h) => ({ who: h.who === 'chi' ? 'chi' : 'me', text: typeof h.text === 'string' ? h.text : '' }))
						.filter((h) => h.text)
				: [];
			// What the user is currently viewing (a room name), so "summarize this" / "here" resolve.
			const ctxRaw = bodyParams?.context;
			const context: ChiOrbContext | undefined =
				ctxRaw && typeof ctxRaw === 'object'
					? {
							roomName: typeof (ctxRaw as { roomName?: unknown }).roomName === 'string' ? (ctxRaw as { roomName: string }).roomName : undefined,
							focusedMessageId:
								typeof (ctxRaw as { focusedMessageId?: unknown }).focusedMessageId === 'string'
									? (ctxRaw as { focusedMessageId: string }).focusedMessageId
									: undefined,
					  }
					: undefined;
			const sender = await Users.findOneById(userId);
			if (!sender) {
				return API.v1.failure('user not found');
			}
			const result = await runChiOrbTurn(sender, text, history, context);
			return API.v1.success({ reply: result.reply, actions: result.actions, needsConfirm: result.needsConfirm });
		},
	},
);

/**
 * Mint a SHORT-LIVED ephemeral OpenAI Realtime session token for the voice orb. The real API key
 * stays on the server; the browser only ever gets the ~1-minute client_secret it uses to open the
 * WebRTC connection directly to OpenAI. Gated on Chi_Realtime_Voice_Enabled + a key being present.
 */
API.v1.addRoute(
	'chi.realtime-session',
	{ authRequired: true, rateLimiterOptions: { numRequestsAllowed: 20, intervalTimeInMS: 60000 } },
	{
		async post() {
			if (settings.get('Chi_Realtime_Voice_Enabled') !== true) {
				return API.v1.failure('Realtime voice is not enabled for this workspace.');
			}
			// Dedicated realtime key, or fall back to the main Chi key when that provider is OpenAI.
			const key =
				String(settings.get('Chi_Realtime_API_Key') || '').trim() ||
				(String(settings.get('Chi_Assistant_Provider') || '') === 'openai' ? String(settings.get('Chi_Assistant_API_Key') || '').trim() : '');
			if (!key) {
				return API.v1.failure('Realtime voice has no OpenAI API key configured (Admin → Settings → Chi Assistant).');
			}
			// OpenAI REMOVED the beta mint endpoint (POST /v1/realtime/sessions now 404s) — this is the GA
			// flow: mint an ephemeral ek_ secret via /v1/realtime/client_secrets ({session:{...}} body,
			// token at top-level `value`), which the browser uses against /v1/realtime/calls. Mirrors our
			// proven-working EvidenceHunt implementation. The old beta model ids are retired with it, and
			// prior installs have `gpt-4o-realtime-preview` PERSISTED in the settings DB — map those forward.
			const configuredModel = String(settings.get('Chi_Realtime_Model') || '').trim();
			const model = !configuredModel || configuredModel.startsWith('gpt-4o-realtime') ? 'gpt-realtime' : configuredModel;
			const voice = String(settings.get('Chi_Realtime_Voice') || 'alloy').trim();
			try {
				const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
					method: 'POST',
					headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						session: {
							type: 'realtime',
							model,
							instructions: REALTIME_INSTRUCTIONS,
							tools: REALTIME_TOOLS,
							audio: {
								// gpt-4o-mini-transcribe over whisper-1: whisper hallucinates phantom utterances on
								// ambient noise. semantic_vad waits for the sentence to finish instead of a fixed
								// silence window that cuts the speaker off mid-thought.
								input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto' } },
								output: { voice },
							},
						},
					}),
					signal: AbortSignal.timeout(15000),
				});
				const data = (await res.json()) as { value?: string; expires_at?: number; error?: { message?: string } };
				if (!res.ok || !data?.value) {
					return API.v1.failure(data?.error?.message || 'Could not start a realtime voice session.');
				}
				return API.v1.success({ token: data.value, expiresAt: data.expires_at, model, voice });
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Realtime voice session failed.');
			}
		},
	},
);

/**
 * Server-managed transcription config for the Chi orb's Flow dictation. Members see WHETHER a
 * workspace speech provider exists — never the key. Keys live only in admin settings.
 */
API.v1.addRoute(
	'chi.transcription-config',
	{ authRequired: true },
	{
		async get() {
			const provider = String(settings.get('Chi_STT_Provider') || 'none');
			const hasKey = Boolean(String(settings.get('Chi_STT_API_Key') || '').trim());
			const hasUrl = Boolean(String(settings.get('Chi_STT_Base_URL') || '').trim());
			const configured = provider === 'openai' || provider === 'groq' ? hasKey : provider === 'custom' ? hasUrl : false;
			return API.v1.success({ configured, provider: configured ? provider : 'none' });
		},
	},
);

const STT_PRESETS: Record<string, { url: string; model: string }> = {
	openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-4o-mini-transcribe' },
	groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
};

/**
 * Flow's SECURE transcription lane: the browser uploads the clip HERE and the server relays it to
 * the configured provider with the WORKSPACE key — the key never reaches a client, per-user keys
 * never need to exist. Rate-limited; 15 MB / ~5 min clip cap; audio is relayed, never stored.
 */
API.v1.addRoute(
	'chi.transcribe',
	{ authRequired: true, rateLimiterOptions: { numRequestsAllowed: 20, intervalTimeInMS: 60000 } },
	{
		async post() {
			const provider = String(settings.get('Chi_STT_Provider') || 'none');
			const key = String(settings.get('Chi_STT_API_Key') || '').trim();
			const baseUrl = String(settings.get('Chi_STT_Base_URL') || '').trim().replace(/\/+$/, '');
			const preset = STT_PRESETS[provider];
			const url = provider === 'custom' ? (baseUrl ? `${baseUrl}/v1/audio/transcriptions` : '') : preset?.url || '';
			if (!url || (provider !== 'custom' && !key)) {
				return API.v1.failure('Workspace transcription is not configured (Admin → Settings → Chi Assistant).');
			}
			const model = String(settings.get('Chi_STT_Model') || '').trim() || preset?.model || 'whisper-1';
			const { fileBuffer, filename, fields } = await getUploadFormData({ request: this.request }, { field: 'file', sizeLimit: 15 * 1024 * 1024 });
			const fd = new FormData();
			fd.append('file', new Blob([fileBuffer]), filename || 'flow.webm');
			fd.append('model', model);
			const vocab = typeof (fields as { prompt?: string })?.prompt === 'string' ? (fields as { prompt: string }).prompt.slice(0, 600) : '';
			if (vocab) {
				fd.append('prompt', vocab);
			}
			try {
				const res = await fetch(url, {
					method: 'POST',
					headers: key ? { Authorization: `Bearer ${key}` } : {},
					body: fd,
					signal: AbortSignal.timeout(60_000),
				});
				const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
				if (!res.ok) {
					return API.v1.failure(data?.error?.message || `Transcription provider returned HTTP ${res.status}.`);
				}
				return API.v1.success({ text: String(data.text || '').trim() });
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : 'Transcription failed.');
			}
		},
	},
);

type ChiPrefs = { model?: string; connectors?: Record<string, boolean> };

/** Per-user Chi preferences, stored SERVER-side (survive devices, drive server behavior):
 *  `model` — per-user model override within the workspace provider; `connectors` — per-user
 *  on/off for registered MCP product connectors. */
API.v1.addRoute(
	'chi.prefs',
	{ authRequired: true, rateLimiterOptions: { numRequestsAllowed: 30, intervalTimeInMS: 60000 } },
	{
		async get() {
			const user = await Users.findOneById<{ _id: string; settings?: { chi?: ChiPrefs } }>(this.userId, { projection: { 'settings.chi': 1 } });
			return API.v1.success({ prefs: user?.settings?.chi || {} });
		},
		async post() {
			const body = (this.bodyParams || {}) as ChiPrefs;
			const prefs: ChiPrefs = {};
			if (typeof body.model === 'string') {
				prefs.model = body.model.trim().slice(0, 60);
			}
			if (body.connectors && typeof body.connectors === 'object') {
				prefs.connectors = {};
				for (const [k, v] of Object.entries(body.connectors).slice(0, 40)) {
					if (/^[a-z0-9-]{1,32}$/.test(k)) {
						prefs.connectors[k] = v !== false;
					}
				}
			}
			await Users.updateOne({ _id: this.userId }, { $set: { 'settings.chi': prefs } });
			return API.v1.success({ prefs });
		},
	},
);
