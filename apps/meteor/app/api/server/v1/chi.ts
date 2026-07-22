import { Users } from '@rocket.chat/models';

import { API } from '../api';
import { runChiOrbTurn } from '../../../../server/lib/chi/admin/service';
import type { ChiOrbHistory, ChiOrbContext } from '../../../../server/lib/chi/admin/service';
import { settings } from '../../../settings/server';

const REALTIME_INSTRUCTIONS =
	'You are Chi, the MatterChat workspace assistant, talking with a member by voice. Be warm, concise, ' +
	'and conversational — this is spoken, so keep answers short and natural. You can talk them through their ' +
	'account, notifications, connectors (Slack/Teams/Google), and how to use MatterChat. For actions that ' +
	'change things, tell them to type the request to you (the text Chi) so it runs with the right permissions.';

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
