/**
 * Pure security + parsing helpers for the Boards email-to-task webhook. NO Meteor imports — unit-
 * tested directly (mirrors the CasePro webhook security.ts split: pure here / glue in the receiver).
 *
 * SIGNATURE SCHEME (the mail provider / forwarder must match exactly):
 *   X-Boards-Email-Signature: sha256=<hex HMAC-SHA256(secret, RAW request body bytes)>
 * Verification is constant-time and FAIL-CLOSED: no secret / missing header / malformed header / any
 * mismatch → false. The receiver answers 202 and drops — errors are never leaked to the sender.
 */
import crypto from 'crypto';

/** `sha256=` + exactly 64 hex chars — anything else is rejected before any crypto runs. */
const SIGNATURE_HEADER_RE = /^sha256=([0-9a-fA-F]{64})$/;

const MAX_FIELD_LENGTH = 16384;

/**
 * Verify the email webhook signature against the RAW body. FAIL-CLOSED: false when the secret is
 * missing/empty, the header is absent/non-string/malformed, lengths mismatch, or digests differ.
 */
export function verifyEmailSignature(secret: string, header: unknown, rawBody: Buffer): boolean {
	if (!secret || typeof header !== 'string' || !header || header.length > 512) {
		return false;
	}
	const match = SIGNATURE_HEADER_RE.exec(header.trim());
	if (!match) {
		return false;
	}
	try {
		const presented = Buffer.from(match[1], 'hex');
		const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
		if (presented.length !== expected.length) {
			return false;
		}
		return crypto.timingSafeEqual(presented, expected);
	} catch {
		return false;
	}
}

/** A parsed inbound email payload, reduced to the fields the receiver consumes. */
export type ParsedInboundEmail = {
	subject?: string;
	text?: string;
	from?: string;
	to?: string;
};

const boundedString = (v: unknown): string | undefined =>
	typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD_LENGTH ? v : undefined;

/**
 * Parse a signature-verified webhook body into the email fields. Accepts the common provider shapes:
 * flat `{ subject, text, from, to }` OR a nested `{ mail: {...} }` / `{ envelope: {...} }`. Returns
 * null for anything unusable (the receiver 202-drops).
 */
export function parseInboundEmailBody(raw: Buffer | string): ParsedInboundEmail | null {
	let body: any;
	try {
		body = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
	} catch {
		return null;
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return null;
	}
	const src = body.mail && typeof body.mail === 'object' ? body.mail : body;
	const to = boundedString(src.to) || boundedString(body.envelope?.to) || boundedString(Array.isArray(src.to) ? src.to[0] : undefined);
	const parsed: ParsedInboundEmail = {
		subject: boundedString(src.subject),
		text: boundedString(src.text) || boundedString(src.body) || boundedString(src['body-plain']),
		from: boundedString(src.from) || boundedString(body.envelope?.from),
		to,
	};
	// Need at least a `to` to route it somewhere.
	if (!parsed.to) {
		return null;
	}
	return parsed;
}

/**
 * Extract the intake token from a plus-addressed recipient: `boards+<token>@host` → `<token>`.
 * Returns null when the address doesn't carry a token. PURE — the caller resolves the token to a
 * board. Handles a raw address or a `"Name" <addr>` form.
 */
export function extractIntakeToken(toAddress: string | undefined): string | null {
	if (!toAddress) {
		return null;
	}
	const angle = /<([^>]+)>/.exec(toAddress);
	const addr = (angle ? angle[1] : toAddress).trim().toLowerCase();
	const m = /\+([a-z0-9_-]{16,64})@/.exec(addr);
	return m ? m[1] : null;
}
