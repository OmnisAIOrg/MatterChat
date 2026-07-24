import { Users } from '@rocket.chat/models';
import { serverFetch } from '@rocket.chat/server-fetch';
import { Accounts } from 'meteor/accounts-base';

import { API } from '../api';
import { getUploadFormData } from '../lib/getUploadFormData';
import { resolveOmnisaiUser } from '../../../omnisai-oauth/server/loginHandler';
import { SystemLogger } from '../../../../server/lib/logger/system';
import { postAuditEntry } from '../../../../server/lib/chi/admin/audit';
import { registerLocalServers, resolveLocalCall } from '../../../../server/lib/chi/admin/localtools';
import { runChiOrbTurn } from '../../../../server/lib/chi/admin/service';
import type { ChiOrbHistory, ChiOrbContext } from '../../../../server/lib/chi/admin/service';
import {
	EXCHANGE_TOKEN_LIFETIME_MS,
	identityFromIssuerSession,
	isLocallyVerifiableAlg,
	loginTokenWhenForExpiry,
	parseAllowedClientIds,
	parseJwt,
	pickJwk,
	validateExchangeClaims,
	verifyJwsSignature,
} from '../../../../server/lib/chi/sessionExchange';
import type { Jwk, VerifiedIdentity } from '../../../../server/lib/chi/sessionExchange';
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

/**
 * Chi local-tools bridge (see server/lib/chi/admin/localtools.ts): the member's desktop session
 * registers the MCP tool manifests of the Omnis apps running on THEIR Mac (EvidenceHunt,
 * Omnis CC), re-posting every ~60s as a heartbeat; registration expires after 2 minutes, so
 * closing the desktop simply removes the tools from Chi's toolbox. Only the member's own
 * authenticated session can register for them or answer their relayed calls.
 */
// ── CentralizedAuth → MatterChat session exchange (the standalone-Chi auth bridge) ─────────
// Verification core + the WHY of every check: server/lib/chi/sessionExchange.ts. This route
// only wires it to settings, the shared omnisai identity mapping, the login-token mint and audit.

const EXCHANGE_JWKS_TTL_MS = 60 * 60 * 1000; // 1h — same cadence verifyIdToken uses
let exchangeJwksCache: { issuer: string; keys: Jwk[]; fetchedAt: number } | undefined;

async function fetchIssuerJwks(issuer: string, forceRefresh = false): Promise<Jwk[]> {
	const now = Date.now();
	if (!forceRefresh && exchangeJwksCache && exchangeJwksCache.issuer === issuer && now - exchangeJwksCache.fetchedAt < EXCHANGE_JWKS_TTL_MS) {
		return exchangeJwksCache.keys;
	}
	// issuer is an admin-configured trusted host (same trust decision as verifyIdToken.ts).
	// Both JWKS mounts are live on CentralizedAuth (verified 2026-07-24 on sso-app.omnisai.io):
	// the better-auth JWT-plugin path and the discovery document's jwks_uri. Try both so a
	// future issuer upgrade that drops one mount doesn't break the bridge.
	let lastStatus = 0;
	for (const path of ['/api/auth/jwks', '/api/auth/mcp/jwks']) {
		const res = await serverFetch(`${issuer}${path}`, { method: 'GET', ignoreSsrfValidation: true });
		if (res.ok) {
			const data = (await res.json()) as { keys?: Jwk[] };
			const keys = data?.keys ?? [];
			exchangeJwksCache = { issuer, keys, fetchedAt: now };
			return keys;
		}
		lastStatus = res.status;
	}
	throw new Error(`exchange_jwks_fetch_${lastStatus}`);
}

/** JWS lane: signature against the issuer JWKS, then hard claim checks. Every failure throws. */
async function verifyExchangeJwt(token: string, issuer: string): Promise<VerifiedIdentity | undefined> {
	const parsed = parseJwt(token);
	if (!parsed) {
		return undefined; // not JWT-shaped → introspection lane
	}
	if (!isLocallyVerifiableAlg(parsed.header.alg)) {
		return undefined; // HS*-signed (issuer-secret HMAC we must not hold) → introspection lane
	}
	let keys = await fetchIssuerJwks(issuer);
	let jwk = pickJwk(keys, parsed.header.kid);
	if (!jwk) {
		keys = await fetchIssuerJwks(issuer, true); // one refresh on kid miss (rotation)
		jwk = pickJwk(keys, parsed.header.kid);
	}
	if (!jwk) {
		throw new Error('exchange_token_kid_not_found');
	}
	if (!verifyJwsSignature(jwk, String(parsed.header.alg), parsed.signingInput, parsed.signature)) {
		throw new Error('exchange_token_bad_signature');
	}
	return validateExchangeClaims(parsed.claims, {
		issuer,
		allowedClientIds: parseAllowedClientIds(String(settings.get('Chi_Session_Exchange_Client_Ids') || '')),
		nowSeconds: Math.floor(Date.now() / 1000),
	});
}

/** Introspection lane: the issuer itself vouches for the live token over back-channel TLS.
 * get-session is the endpoint CentralizedAuth actually serves (verified live 2026-07-24:
 * an INVALID bearer gets `200 null`, which identityFromIssuerSession maps to a rejection —
 * fail-closed); the discovery document's userinfo_endpoint 404s on the current deployment
 * but is kept as the fallback for future issuer versions. */
async function introspectExchangeToken(token: string, issuer: string): Promise<VerifiedIdentity> {
	let lastStatus = 0;
	for (const path of ['/api/auth/mcp/get-session', '/api/auth/mcp/userinfo']) {
		const res = await serverFetch(`${issuer}${path}`, {
			method: 'GET',
			headers: { Authorization: `Bearer ${token}` },
			ignoreSsrfValidation: true,
		});
		if (res.ok) {
			const identity = identityFromIssuerSession(await res.json().catch(() => undefined));
			if (!identity) {
				throw new Error('exchange_introspection_no_user');
			}
			return identity;
		}
		lastStatus = res.status;
		if (res.status !== 404 && res.status !== 405) {
			break; // a real rejection (401/403/5xx) — don't shop for a friendlier endpoint
		}
	}
	throw new Error(`exchange_introspection_rejected_${lastStatus}`);
}

/**
 * POST /v1/chi.session-exchange — trade a verified CentralizedAuth token for a MatterChat
 * login token (~30 days, revocable like any session via logout / Manage Logged In Devices).
 * Unauthenticated by nature (the caller has no RC session yet), so: default-OFF setting
 * gate, tight rate limit, hard fail-closed verification, and an audit line on every mint.
 */
API.v1.addRoute(
	'chi.session-exchange',
	{ authRequired: false, rateLimiterOptions: { numRequestsAllowed: 10, intervalTimeInMS: 60000 } },
	{
		async post() {
			if (settings.get('Chi_Session_Exchange_Enabled') !== true) {
				return API.v1.failure('Chi session exchange is not enabled on this workspace (Admin → Settings → Chi Assistant).');
			}
			// Issuer precedence: the DEDICATED bridge setting → the web-SSO issuer → env → the org's
			// public production issuer. The dedicated setting exists because the two can legitimately
			// differ: staging MatterChat's web SSO points at the VPC-INTERNAL staging auth, while a
			// standalone Chi on someone's laptop can only ever reach the PUBLIC issuer
			// (sso-app.omnisai.io — the host the whole org's OAuth uses; auth-app.* is in-VPC only).
			const issuer = String(
				settings.get('Chi_Session_Exchange_Issuer') ||
					settings.get('OmnisAI_OIDC_Issuer') ||
					process.env.OMNISAI_OIDC_ISSUER ||
					'https://sso-app.omnisai.io',
			)
				.trim()
				.replace(/\/+$/, '');
			if (!issuer) {
				return API.v1.failure('OmnisAI OIDC issuer is not configured.');
			}
			// Route not declared in rest-typings, so `this` types as Operations<never> (same as chi.ask).
			const { request } = this as unknown as { request: { headers: { get(name: string): string | null } } };
			const authHeader = request.headers.get('authorization') || '';
			const bearer = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim();
			if (!bearer) {
				return API.v1.unauthorized();
			}

			let identity: VerifiedIdentity;
			try {
				identity = (await verifyExchangeJwt(bearer, issuer)) ?? (await introspectExchangeToken(bearer, issuer));
			} catch (err) {
				// Reason codes are deliberately log-only — the caller learns pass/fail, never which check tripped.
				SystemLogger.warn({ msg: 'chi.session-exchange: token rejected', reason: err instanceof Error ? err.message : String(err) });
				return API.v1.unauthorized();
			}

			try {
				const userId = await resolveOmnisaiUser(identity);
				const user = await Users.findOneById(userId);
				if (!user || user.active === false) {
					return API.v1.unauthorized();
				}

				// Mint a REAL hashed resume token (the users.createToken internals — REST auth only
				// matches hashedToken), backdated so the standard expiry sweep retires it in ~30 days.
				const stamped = Accounts._generateStampedLoginToken();
				const lifetimeMs = (Accounts as unknown as { _getTokenLifetimeMs?: () => number })._getTokenLifetimeMs?.() ?? 90 * 24 * 60 * 60 * 1000;
				stamped.when = loginTokenWhenForExpiry(Date.now(), lifetimeMs);
				await Accounts._insertLoginToken(userId, stamped);

				await postAuditEntry(
					user,
					`🔑 Session exchange: minted a standalone-Chi login (~30d) for @${user.username} via CentralizedAuth (${new URL(issuer).host}).`,
				);
				SystemLogger.info({ msg: 'chi.session-exchange: session minted', userId, sub: identity.sub });
				return API.v1.success({
					userId,
					authToken: stamped.token,
					expiresInMs: Math.min(EXCHANGE_TOKEN_LIFETIME_MS, lifetimeMs),
				});
			} catch (err) {
				SystemLogger.error({ msg: 'chi.session-exchange: mint failed', err });
				return API.v1.failure('Session exchange failed.');
			}
		},
	},
);

API.v1.addRoute(
	'chi.local-tools.register',
	{ authRequired: true, rateLimiterOptions: { numRequestsAllowed: 30, intervalTimeInMS: 60000 } },
	{
		async post() {
			// Route not declared in rest-typings, so `this` types as Operations<never> (same as chi.ask).
			const { userId, bodyParams } = this as unknown as { userId: string; bodyParams: { servers?: unknown } };
			return API.v1.success(registerLocalServers(userId, bodyParams?.servers));
		},
	},
);

API.v1.addRoute(
	'chi.local-tools.result',
	{ authRequired: true, rateLimiterOptions: { numRequestsAllowed: 120, intervalTimeInMS: 60000 } },
	{
		async post() {
			// Route not declared in rest-typings, so `this` types as Operations<never> (same as chi.ask).
			const { userId, bodyParams } = this as unknown as {
				userId: string;
				bodyParams: { callId?: unknown; ok?: unknown; content?: unknown };
			};
			const callId = typeof bodyParams?.callId === 'string' ? bodyParams.callId : '';
			if (!callId) {
				return API.v1.failure('callId is required');
			}
			const accepted = resolveLocalCall(userId, callId, bodyParams?.ok !== false, typeof bodyParams?.content === 'string' ? bodyParams.content : '');
			return API.v1.success({ accepted });
		},
	},
);
