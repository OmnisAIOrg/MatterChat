/**
 * Pure security + extraction helpers for the Boards calendar PUSH (webhook) receiver. NO Meteor
 * imports — unit-tested directly (mirrors the Teams webhookSecurity.ts split: pure here / glue in the
 * receiver, and the CasePro/email webhook security precedent).
 *
 * CHANNEL-TOKEN / clientState scheme (the same shape for both providers):
 *   secret HMAC-SHA256(secret, `${connectionId}:${subscriptionId}`), base64url
 * DERIVED per subscription from the deploy-level `BOARDS_CALENDAR_PUSH_SECRET`, keyed by the connection
 * + the provider subscription id. That makes verification STATELESS (no per-subscription secret in
 * Mongo) and FAIL-CLOSED: with no secret configured nothing verifies, so no notification is processed —
 * and subscription CREATION is gated on the same secret, so push mode simply stays off (poll fallback)
 * until the deploy provides it.
 *
 * - Google `events.watch`: we set this token as the channel's `token`; Google echoes it back verbatim
 *   in the `X-Goog-Channel-Token` header alongside `X-Goog-Channel-ID` (our subscriptionId) and
 *   `X-Goog-Resource-State`.
 * - Microsoft Graph `/subscriptions`: we set this token as `clientState`; Graph echoes it in each
 *   notification item's `clientState`.
 *
 * The payload arrives on an UNAUTHENTICATED public endpoint, so nothing from it is trusted until the
 * token verifies against OUR OWN stored subscription record.
 *
 * Clean-room: written from the public Google Calendar push + Microsoft Graph change-notification docs;
 * nothing under apps/meteor/ee/ was read or copied.
 */
import crypto from 'crypto';

/** Upper bound for any single field we parse (ids/tokens are far shorter). */
const MAX_FIELD_LENGTH = 2048;

/** Derive the per-subscription channel token: HMAC-SHA256(secret, connectionId:subscriptionId), base64url. */
export function derivePushToken(secret: string, connectionId: string, subscriptionId: string): string {
	if (!secret) {
		throw new Error('boards_calendar_push_secret_missing');
	}
	return crypto.createHmac('sha256', secret).update(`${connectionId}:${subscriptionId}`).digest('base64url');
}

/**
 * Verify a presented channel token / clientState against the derived one. FAIL-CLOSED: returns false
 * when the secret is missing/empty, when the presented value is absent or oversized, or on any
 * mismatch. Constant-time comparison (timingSafeEqual over equal-length buffers).
 */
export function verifyPushToken(secret: string, presented: unknown, connectionId: string, subscriptionId: string): boolean {
	if (!secret || typeof presented !== 'string' || !presented || presented.length > MAX_FIELD_LENGTH) {
		return false;
	}
	try {
		const expected = derivePushToken(secret, connectionId, subscriptionId);
		const a = Buffer.from(presented, 'utf8');
		const b = Buffer.from(expected, 'utf8');
		if (a.length !== b.length) {
			return false;
		}
		return crypto.timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

/**
 * A Google Calendar push notification, reduced to what the receiver consumes. Google delivers these as
 * HEADERS on a bodiless POST (there is no JSON body): the channel id, its echoed token, the resource
 * state (`sync` = the initial handshake ping we ignore; `exists`/`not_exists` = a real change), and the
 * opaque resource id.
 */
export type GooglerPushNotification = {
	subscriptionId: string;
	channelToken?: string;
	resourceState?: string;
	resourceId?: string;
};

const headerValue = (headers: Record<string, unknown>, name: string): string | undefined => {
	const v = headers?.[name];
	const s = Array.isArray(v) ? v[0] : v;
	return typeof s === 'string' && s.length > 0 && s.length <= MAX_FIELD_LENGTH ? s : undefined;
};

/**
 * Extract a Google push notification from the request headers (lower-cased by Node). Returns null when
 * the mandatory channel id is absent (a probe with no `X-Goog-Channel-ID` is non-processable).
 */
export function extractGooglePushNotification(headers: Record<string, unknown>): GooglerPushNotification | null {
	const subscriptionId = headerValue(headers, 'x-goog-channel-id');
	if (!subscriptionId) {
		return null;
	}
	return {
		subscriptionId,
		channelToken: headerValue(headers, 'x-goog-channel-token'),
		resourceState: headerValue(headers, 'x-goog-resource-state'),
		resourceId: headerValue(headers, 'x-goog-resource-id'),
	};
}

/** True for Google's initial `sync` ping — a handshake we ack but never reconcile on. */
export function isGoogleSyncPing(n: GooglerPushNotification): boolean {
	return n.resourceState === 'sync';
}

/** One item of a Graph change-notification POST body, reduced to the fields the receiver consumes. */
export type GraphPushNotification = {
	subscriptionId: string;
	clientState?: string;
};

/**
 * Extract the well-formed Graph notification items out of an untrusted `{ value: [...] }` body.
 * Anything without a string `subscriptionId` (bounded) is dropped item-by-item; a non-`{value:[]}`
 * body yields []. clientState is carried through UNVERIFIED — the caller verifies it against the
 * subscription's connection (this pure module deliberately knows nothing about Mongo).
 */
export function extractGraphPushNotifications(body: unknown): GraphPushNotification[] {
	if (!body || typeof body !== 'object' || !Array.isArray((body as { value?: unknown }).value)) {
		return [];
	}
	const out: GraphPushNotification[] = [];
	for (const item of (body as { value: unknown[] }).value) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const { subscriptionId, clientState } = item as Record<string, unknown>;
		if (typeof subscriptionId !== 'string' || !subscriptionId || subscriptionId.length > MAX_FIELD_LENGTH) {
			continue;
		}
		out.push({
			subscriptionId,
			...(typeof clientState === 'string' && clientState.length <= MAX_FIELD_LENGTH ? { clientState } : {}),
		});
	}
	return out;
}

/**
 * Pull the `validationToken` from a Graph subscription-validation POST (`?validationToken=...`). Graph
 * validates the endpoint at create/renew by POSTing this; we must echo it back text/plain within 10s.
 * Bounded so a crafted giant token can't be reflected. Returns null when absent.
 */
export function extractValidationToken(searchParams: URLSearchParams): string | null {
	const token = searchParams.get('validationToken');
	if (typeof token !== 'string' || !token || token.length > MAX_FIELD_LENGTH) {
		return null;
	}
	return token;
}

/**
 * Renewal decision: is a subscription due to be renewed now? True when it's missing an expiry or its
 * expiry is within `leadMs` of `now`. PURE — the sweep uses this so the "renew before expiry" rule is
 * unit-testable without Graph/Google.
 */
export function shouldRenewPush(expiresAt: Date | undefined, now: Date, leadMs: number): boolean {
	if (!expiresAt) {
		return true;
	}
	return expiresAt.getTime() - now.getTime() <= leadMs;
}
