/**
 * Slack Events API endpoint for the Slack live message bridge — the Slack sibling of
 * providers/teams/webhook.ts, to the same security model.
 *
 * Mounted OUTSIDE /api (RC's REST/Apps router owns `/api/*` and 404s custom connect-handlers —
 * mirrors the `/_slack/oauth` / `/_connectors/teams` mounting precedent):
 *
 *   POST /_slack/events → url_verification handshake + event_callback deliveries
 *
 * SECURITY MODEL (the endpoint is public + unauthenticated by Slack's requirement):
 *  1. FAIL-CLOSED SIGNING SECRET — every request (INCLUDING url_verification: Slack signs it too)
 *     must carry a valid `X-Slack-Signature` = v0 HMAC-SHA256 of `v0:{timestamp}:{rawBody}` keyed
 *     by the app's signing secret (`Slack_Signing_Secret` admin setting, `SLACK_SIGNING_SECRET`
 *     env fallback). No secret configured → nothing verifies → nothing is processed (inbound
 *     stays off; outbound + the reconcile poll keep working).
 *  2. REPLAY GUARD — `X-Slack-Request-Timestamp` older/newer than 5 minutes is rejected, so a
 *     captured request can't be replayed after the fact.
 *  3. RAW-BODY AWARE, BOUNDED — the handler reads the raw request stream itself (1 MB cap; the
 *     HMAC is computed over the exact raw bytes), JSON.parse in a try, and never trusts field
 *     shapes (parseEventEnvelope/extractMessageEvent drop malformed payloads item-by-item).
 *  4. ACK FAST (<3s), PROCESS ASYNC — Slack retries slow/non-2xx deliveries then disables the
 *     subscription after enough failures; we respond 200 immediately and process on setImmediate.
 *     Invalid/unverifiable requests are answered 200 with nothing processed, so a probe can't turn
 *     the endpoint into a retry amplifier (same posture as the Teams webhook).
 *  5. RETRY DEDUP — Slack re-delivers (`X-Slack-Retry-Num`); a short-TTL (teamId, event_id) set
 *     drops duplicates at the door, and the deterministic RC message _id makes ingest idempotent
 *     even across restarts.
 *
 * SLACK APP CONFIG this endpoint expects (see MATTERCHAT-EXTERNAL-WORKSPACE-CONNECTORS.md §2.1a):
 *   Event Subscriptions → Request URL: https://<site>/_slack/events
 *   Subscribe to bot events: message.channels, message.groups
 *   Basic Information → Signing Secret → paste into Admin → Slack → Signing Secret
 *
 * Clean-room: written from the Slack Events API / request-verification docs; nothing under
 * apps/meteor/ee/ was read or copied.
 */
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { SLACK_EVENTS_ROUTE_PREFIX, slackSigningSecret } from './config';
import { extractMessageEvent } from './eventMessageMapping';
import { acceptSlackEvent, processSlackMessageEvent } from './eventProcessing';
import { parseEventEnvelope, verifySlackSignature } from './eventsSecurity';
import { SystemLogger } from '../../../../../server/lib/logger/system';

/** Bound the raw request body (Slack event payloads are a few KB; 1 MB is generous). */
const MAX_BODY_BYTES = 1024 * 1024;

/** Read the raw request stream, bounded. Resolves null when the cap is exceeded. */
function readRawBody(req: any): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let total = 0;
		let overflowed = false;
		req.on('data', (chunk: Buffer) => {
			total += chunk.length;
			if (total > MAX_BODY_BYTES) {
				overflowed = true;
				chunks.length = 0;
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(overflowed ? null : Buffer.concat(chunks)));
		req.on('error', () => resolve(null));
	});
}

/** Ack fast (Slack wants a 2xx within 3s; retries then disables the subscription otherwise). */
function ok(res: any): void {
	res.writeHead(200);
	res.end();
}

/** 200 + the challenge as text/plain — the Slack endpoint-verification handshake. */
function answerChallenge(res: any, challenge: string): void {
	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end(challenge);
}

async function handleEventPost(req: any, res: any): Promise<void> {
	// FAIL-CLOSED: without the signing secret nothing can verify, so nothing is processed (and the
	// Slack-side URL verification deliberately fails — set the secret FIRST, then the events URL).
	const secret = slackSigningSecret();
	if (!secret) {
		SystemLogger.debug({ msg: 'Slack events: delivery ignored — signing secret not configured (inbound off)' });
		return ok(res);
	}

	const raw = await readRawBody(req);
	if (!raw?.length) {
		return ok(res);
	}
	const rawBody = raw.toString('utf8');

	// 1+2. Signature + replay verification over the RAW bytes — url_verification is signed too, so
	// nothing (not even the handshake) is answered unverified.
	if (!verifySlackSignature(secret, req.headers?.['x-slack-request-timestamp'], req.headers?.['x-slack-signature'], rawBody)) {
		SystemLogger.warn({ msg: 'Slack events: signature verification failed — dropping delivery' });
		return ok(res);
	}

	let body: unknown;
	try {
		body = JSON.parse(rawBody);
	} catch {
		return ok(res);
	}

	const envelope = parseEventEnvelope(body);
	if (!envelope) {
		return ok(res);
	}

	// One-time endpoint handshake: echo the challenge, text/plain, 200 — and nothing else.
	if (envelope.kind === 'url_verification') {
		SystemLogger.info({ msg: 'Slack events: URL verification handshake answered' });
		return answerChallenge(res, envelope.challenge);
	}

	// Retry dedup: Slack re-delivers on slow/failed acks (X-Slack-Retry-Num); first sight wins.
	if (!acceptSlackEvent(envelope.teamId, envelope.eventId)) {
		return ok(res);
	}

	const action = extractMessageEvent(envelope.event);

	// 4. Ack FIRST (200 within 3s), process async — Slack disables the subscription on repeated
	// slow/failed deliveries.
	ok(res);

	if (!action) {
		return; // Not a bridgeable message event (bot/system/DM/other event type) — acked + dropped.
	}

	setImmediate(() => {
		void processSlackMessageEvent(envelope.teamId, action);
	});
}

// ─── mount ───────────────────────────────────────────────────────────────────────────────────

RoutePolicy.declare(`${SLACK_EVENTS_ROUTE_PREFIX}/`, 'network');

WebApp.connectHandlers.use(SLACK_EVENTS_ROUTE_PREFIX, async (req: any, res: any, next: () => void) => {
	try {
		if (req.method !== 'POST') {
			return next();
		}
		return await handleEventPost(req, res);
	} catch (err) {
		SystemLogger.error({ msg: 'Slack events route error', err: String(err) });
		// Slack only needs a 2xx; internal failures are logged, never leaked.
		if (!res.headersSent) {
			res.writeHead(200);
		}
		res.end();
	}
});
