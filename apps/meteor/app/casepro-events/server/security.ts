/**
 * Pure security + parsing helpers for the CasePro case-update webhook. NO Meteor imports — this
 * module is unit-tested directly (apps/meteor/tests/unit/app/casepro-events/security.spec.ts),
 * mirroring the teams connector split (webhookSecurity.ts pure / webhook.ts glue).
 *
 * SIGNATURE SCHEME (the CasePro sender must match this exactly):
 *   X-CasePro-Signature: sha256=<hex>
 *   where <hex> = HMAC-SHA256(secret, RAW request body bytes), lowercase or uppercase hex.
 * Verification is constant-time (crypto.timingSafeEqual over equal-length digest buffers, with an
 * explicit length guard first) and FAIL-CLOSED: no secret / missing header / malformed header /
 * any mismatch → false. The caller answers 202 and drops — errors are never leaked to the sender.
 *
 * TIMESTAMP SKEW: the signed JSON body carries a `timestamp` (ISO 8601). Events outside a
 * ±5-minute window of server time are dropped (replay bound; the signature covers the timestamp,
 * so an attacker cannot refresh it without the secret).
 */
import crypto from 'crypto';

/** Upper bound for any single string field we parse out of the untrusted payload. */
const MAX_FIELD_LENGTH = 2048;

/** Upper bound on the number of changed-field names we carry through. */
const MAX_CHANGED_FIELDS = 100;

/** Maximum allowed |now - payload.timestamp| (ms). */
export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

/** `sha256=` + exactly 64 hex chars — anything else is rejected before any crypto runs. */
const SIGNATURE_HEADER_RE = /^sha256=([0-9a-fA-F]{64})$/;

/**
 * Verify the CasePro webhook signature against the RAW body. FAIL-CLOSED: returns false when the
 * secret is missing/empty, the header is absent/non-string/malformed, lengths mismatch, or the
 * digests differ. Constant-time comparison via crypto.timingSafeEqual.
 */
export function verifySignature(secret: string, header: unknown, rawBody: Buffer): boolean {
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
		// Guard length mismatch BEFORE timingSafeEqual (it throws on unequal lengths).
		if (presented.length !== expected.length) {
			return false;
		}
		return crypto.timingSafeEqual(presented, expected);
	} catch {
		return false;
	}
}

/** True when `iso` parses AND |nowMs - t| ≤ maxSkewMs. Unparseable timestamps are stale (drop). */
export function isTimestampFresh(iso: string, nowMs: number, maxSkewMs: number = MAX_TIMESTAMP_SKEW_MS): boolean {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) {
		return false;
	}
	return Math.abs(nowMs - t) <= maxSkewMs;
}

/** One verified CasePro case-update event, reduced to the fields the receiver consumes. */
export type CaseProEvent = {
	/** May be empty — the caller falls back to a hash of the raw body for idempotency. */
	eventId: string;
	entityType: string;
	entityId: string;
	matterId: string | null;
	changeType: 'created' | 'updated' | 'deleted';
	/** Field NAMES only — CasePro never sends values. */
	changedFields: string[];
	organizationId: string;
	/** ISO 8601 — covered by the signature; freshness-checked by the caller. */
	timestamp: string;
};

const CHANGE_TYPES = new Set(['created', 'updated', 'deleted']);

const boundedString = (v: unknown): string | null =>
	typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD_LENGTH ? v : null;

/**
 * Parse + shape-validate an untrusted (but signature-verified) webhook body. Returns null for
 * anything malformed — the caller 202-drops. Field names follow the CasePro contract
 * (snake_case on the wire → camelCase here); unknown change_types are dropped, changed_fields
 * entries that aren't bounded strings are filtered out, matter_id may be null.
 */
export function parseCaseProEvent(raw: Buffer | string): CaseProEvent | null {
	let body: unknown;
	try {
		body = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
	} catch {
		return null;
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return null;
	}
	const {
		event_id: eventId,
		entity_type: entityType,
		entity_id: entityId,
		matter_id: matterId,
		change_type: changeType,
		changed_fields: changedFields,
		organization_id: organizationId,
		timestamp,
	} = body as Record<string, unknown>;

	const entityTypeStr = boundedString(entityType);
	const changeTypeStr = boundedString(changeType);
	const timestampStr = boundedString(timestamp);
	if (!entityTypeStr || !changeTypeStr || !timestampStr || !CHANGE_TYPES.has(changeTypeStr)) {
		return null;
	}
	if (matterId !== null && matterId !== undefined && !boundedString(matterId)) {
		return null;
	}
	const fields = Array.isArray(changedFields)
		? changedFields.filter((f): f is string => typeof f === 'string' && f.length > 0 && f.length <= MAX_FIELD_LENGTH).slice(0, MAX_CHANGED_FIELDS)
		: [];

	return {
		eventId: boundedString(eventId) ?? '',
		entityType: entityTypeStr,
		entityId: boundedString(entityId) ?? '',
		matterId: boundedString(matterId) ?? null,
		changeType: changeTypeStr as CaseProEvent['changeType'],
		changedFields: fields,
		organizationId: boundedString(organizationId) ?? '',
		timestamp: timestampStr,
	};
}
