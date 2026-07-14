/**
 * Pure security + envelope-parsing helpers for the Slack Events API endpoint (`/_slack/events`).
 * NO Meteor imports — this module is unit-tested directly
 * (apps/meteor/tests/unit/app/connectors/slackEventsSecurity.spec.ts). The Slack sibling of
 * providers/teams/webhookSecurity.ts.
 *
 * SIGNATURE SCHEME (Slack "Verifying requests from Slack", v0): every Events API POST carries
 *   X-Slack-Request-Timestamp: <unix seconds>
 *   X-Slack-Signature:         v0=<hex hmac-sha256(signingSecret, "v0:<timestamp>:<rawBody>")>
 * We recompute the HMAC over the RAW body bytes and compare constant-time. Two fail-closed gates:
 *  1. NO SECRET → nothing verifies → nothing is processed (inbound stays off until the admin sets
 *     `Slack_Signing_Secret` / `SLACK_SIGNING_SECRET`);
 *  2. STALE TIMESTAMP (>5 min skew either way) → rejected, which blocks replaying a captured
 *     request after the fact even with a valid signature.
 *
 * ENVELOPE PARSING: the endpoint receives exactly two POST shapes we care about —
 *   { type: 'url_verification', challenge }              → the one-time endpoint handshake;
 *   { type: 'event_callback', team_id, event_id, event } → a delivered event.
 * Everything else (unknown types, malformed bodies) parses to null and is dropped, never guessed
 * at — the payload arrives on a public endpoint, so nothing is trusted until the signature
 * verifies and the shapes are validated field-by-field with bounded lengths.
 *
 * Clean-room: written from the Slack Events API / request-verification docs; nothing under
 * apps/meteor/ee/ was read or copied.
 */
import crypto from 'crypto';

/** Upper bound for any single id/header field we parse (Slack ids are far shorter). */
const MAX_FIELD_LENGTH = 2048;

/** Reject requests whose timestamp is further than this from now (replay guard — Slack's own guidance). */
export const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

/** The signature version prefix Slack currently emits. */
export const SLACK_SIGNATURE_VERSION = 'v0';

/** Compute the expected `X-Slack-Signature` value for a raw request body. */
export function computeSlackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
	if (!signingSecret) {
		throw new Error('slack_signing_secret_missing');
	}
	const base = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
	return `${SLACK_SIGNATURE_VERSION}=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;
}

/**
 * Verify one request end-to-end: secret present, timestamp fresh (±5 min), signature well-formed,
 * HMAC matches (constant-time). FAIL-CLOSED: any missing/oversized/malformed input → false.
 *
 * `nowMs` is injectable for tests; defaults to Date.now().
 */
export function verifySlackSignature(
	signingSecret: string,
	timestampHeader: unknown,
	signatureHeader: unknown,
	rawBody: string,
	nowMs: number = Date.now(),
): boolean {
	if (!signingSecret) {
		return false;
	}
	if (typeof timestampHeader !== 'string' || !timestampHeader || timestampHeader.length > MAX_FIELD_LENGTH) {
		return false;
	}
	if (typeof signatureHeader !== 'string' || !signatureHeader || signatureHeader.length > MAX_FIELD_LENGTH) {
		return false;
	}

	// Replay guard: reject timestamps more than 5 minutes from now (either direction).
	const tsSeconds = Number(timestampHeader);
	if (!Number.isFinite(tsSeconds)) {
		return false;
	}
	if (Math.abs(nowMs / 1000 - tsSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
		return false;
	}

	try {
		const expected = computeSlackSignature(signingSecret, timestampHeader, rawBody);
		const a = Buffer.from(signatureHeader, 'utf8');
		const b = Buffer.from(expected, 'utf8');
		if (a.length !== b.length) {
			return false;
		}
		return crypto.timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

/** The two envelope shapes the endpoint answers (anything else is dropped). */
export type SlackEventEnvelope =
	| { kind: 'url_verification'; challenge: string }
	| { kind: 'event_callback'; teamId: string; eventId: string; event: Record<string, unknown> };

/**
 * Parse an untrusted (but signature-verified) POST body into one of the two envelopes we answer.
 * Returns null for anything that isn't exactly a `url_verification` or a well-formed
 * `event_callback` (fail-closed: unknown shapes are dropped, never guessed at).
 */
export function parseEventEnvelope(body: unknown): SlackEventEnvelope | null {
	if (!body || typeof body !== 'object') {
		return null;
	}
	const { type, challenge, team_id: teamId, event_id: eventId, event } = body as Record<string, unknown>;

	if (type === 'url_verification') {
		if (typeof challenge !== 'string' || !challenge || challenge.length > MAX_FIELD_LENGTH) {
			return null;
		}
		return { kind: 'url_verification', challenge };
	}

	if (type === 'event_callback') {
		if (typeof teamId !== 'string' || !teamId || teamId.length > MAX_FIELD_LENGTH) {
			return null;
		}
		if (typeof eventId !== 'string' || !eventId || eventId.length > MAX_FIELD_LENGTH) {
			return null;
		}
		if (!event || typeof event !== 'object' || Array.isArray(event)) {
			return null;
		}
		return { kind: 'event_callback', teamId, eventId, event: event as Record<string, unknown> };
	}

	return null;
}
