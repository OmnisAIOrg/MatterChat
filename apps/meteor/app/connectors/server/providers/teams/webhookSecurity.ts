/**
 * Pure security helpers for the Teams change-notification webhook. NO Meteor imports — this module
 * is unit-tested directly (apps/meteor/tests/unit/app/connectors/webhookSecurity.spec.ts).
 *
 * clientState scheme: Graph echoes back, verbatim, the `clientState` we set on the subscription.
 * We DERIVE it per subscription as HMAC-SHA256(secret, `${connectionId}:${channelExternalId}`)
 * (base64url), keyed by the deploy-level `TEAMS_WEBHOOK_CLIENT_STATE_SECRET` env. That makes
 * verification STATELESS (no secret-at-rest per subscription in Mongo) and FAIL-CLOSED: with no
 * secret configured nothing verifies, so no webhook payload is ever processed — and subscription
 * creation is gated on the same secret, so webhook mode simply stays off until it is set.
 *
 * Resource parsing: Graph identifies the changed message via the `resource` path, e.g.
 *   teams('{teamId}')/channels('{channelId}')/messages('{messageId}')
 *   teams('{teamId}')/channels('{channelId}')/messages('{messageId}')/replies('{replyId}')
 *   chats('{chatId}')/messages('{messageId}')
 * We parse it defensively (quoted segments only, bounded length) — the payload arrives on an
 * UNAUTHENTICATED public endpoint, so nothing from it is trusted until clientState verifies and
 * the ids are re-used only inside URL-encoded Graph calls.
 *
 * Clean-room: written from the Microsoft Graph change-notifications docs; nothing under
 * apps/meteor/ee/ was read or copied.
 */
import crypto from 'crypto';

/** Upper bound for any single notification field we parse (ids/resource paths are far shorter). */
const MAX_FIELD_LENGTH = 2048;

/** Derive the per-subscription clientState: HMAC-SHA256(secret, connectionId:channelExternalId), base64url. */
export function deriveClientState(secret: string, connectionId: string, channelExternalId: string): string {
	if (!secret) {
		throw new Error('teams_webhook_secret_missing');
	}
	return crypto.createHmac('sha256', secret).update(`${connectionId}:${channelExternalId}`).digest('base64url');
}

/**
 * Verify a presented clientState against the derived one. FAIL-CLOSED: returns false when the
 * secret is missing/empty, when the presented value is absent or oversized, or on any mismatch.
 * Constant-time comparison (timingSafeEqual over equal-length digests).
 */
export function verifyClientState(secret: string, presented: unknown, connectionId: string, channelExternalId: string): boolean {
	if (!secret || typeof presented !== 'string' || !presented || presented.length > MAX_FIELD_LENGTH) {
		return false;
	}
	try {
		const expected = deriveClientState(secret, connectionId, channelExternalId);
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

/** The message address parsed out of a change-notification `resource` path. */
export type ParsedNotificationResource =
	| {
			kind: 'channelMessage';
			teamId: string;
			channelId: string;
			messageId: string;
			/** Set when the changed message is a threaded reply. */
			replyId?: string;
	  }
	| {
			kind: 'chatMessage';
			chatId: string;
			messageId: string;
	  };

// Quoted-segment matchers. Graph ids never contain a single-quote; anything containing one is
// rejected by the character class, so a crafted resource can't smuggle a quote past the parse.
const CHANNEL_MESSAGE_RE =
	/^teams\('([^']{1,256})'\)\/channels\('([^']{1,256})'\)\/messages\('([^']{1,256})'\)(?:\/replies\('([^']{1,256})'\))?$/;
const CHAT_MESSAGE_RE = /^chats\('([^']{1,256})'\)\/messages\('([^']{1,256})'\)$/;

/**
 * Parse a change-notification `resource` path into the message address it points at. Returns null
 * for anything that isn't exactly a channel-message or chat-message resource (fail-closed: unknown
 * resource shapes are dropped, never guessed at).
 */
export function parseNotificationResource(resource: unknown): ParsedNotificationResource | null {
	if (typeof resource !== 'string' || !resource || resource.length > MAX_FIELD_LENGTH) {
		return null;
	}
	const channelMatch = CHANNEL_MESSAGE_RE.exec(resource);
	if (channelMatch) {
		const [, teamId, channelId, messageId, replyId] = channelMatch;
		return { kind: 'channelMessage', teamId, channelId, messageId, ...(replyId ? { replyId } : {}) };
	}
	const chatMatch = CHAT_MESSAGE_RE.exec(resource);
	if (chatMatch) {
		const [, chatId, messageId] = chatMatch;
		return { kind: 'chatMessage', chatId, messageId };
	}
	return null;
}

/** One item of a change-notification POST body, reduced to the fields the bridge consumes. */
export type IncomingNotification = {
	subscriptionId: string;
	clientState?: string;
	changeType: string;
	resource: string;
};

/**
 * Extract the well-formed notification items out of an untrusted webhook body. Anything that is
 * not `{ value: [...] }` with string `subscriptionId`/`changeType`/`resource` fields (bounded
 * length) is dropped item-by-item; a body that isn't an object yields []. clientState is carried
 * through UNVERIFIED — the caller verifies it against the subscription's connection (it needs the
 * connection doc, which this pure module deliberately knows nothing about).
 */
export function extractNotifications(body: unknown): IncomingNotification[] {
	if (!body || typeof body !== 'object' || !Array.isArray((body as { value?: unknown }).value)) {
		return [];
	}
	const items = (body as { value: unknown[] }).value;
	const out: IncomingNotification[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const { subscriptionId, clientState, changeType, resource } = item as Record<string, unknown>;
		if (typeof subscriptionId !== 'string' || !subscriptionId || subscriptionId.length > MAX_FIELD_LENGTH) {
			continue;
		}
		if (typeof changeType !== 'string' || !changeType || changeType.length > MAX_FIELD_LENGTH) {
			continue;
		}
		if (typeof resource !== 'string' || !resource || resource.length > MAX_FIELD_LENGTH) {
			continue;
		}
		out.push({
			subscriptionId,
			changeType,
			resource,
			...(typeof clientState === 'string' && clientState.length <= MAX_FIELD_LENGTH ? { clientState } : {}),
		});
	}
	return out;
}

/** One item of a LIFECYCLE notification POST body (`lifecycleEvent` instead of a message resource). */
export type IncomingLifecycleEvent = {
	subscriptionId: string;
	clientState?: string;
	/** `reauthorizationRequired` | `subscriptionRemoved` | `missed` (unknown values carried as-is). */
	lifecycleEvent: string;
};

/** Extract well-formed lifecycle events out of an untrusted lifecycle-webhook body (same rules). */
export function extractLifecycleEvents(body: unknown): IncomingLifecycleEvent[] {
	if (!body || typeof body !== 'object' || !Array.isArray((body as { value?: unknown }).value)) {
		return [];
	}
	const items = (body as { value: unknown[] }).value;
	const out: IncomingLifecycleEvent[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const { subscriptionId, clientState, lifecycleEvent } = item as Record<string, unknown>;
		if (typeof subscriptionId !== 'string' || !subscriptionId || subscriptionId.length > MAX_FIELD_LENGTH) {
			continue;
		}
		if (typeof lifecycleEvent !== 'string' || !lifecycleEvent || lifecycleEvent.length > MAX_FIELD_LENGTH) {
			continue;
		}
		out.push({
			subscriptionId,
			lifecycleEvent,
			...(typeof clientState === 'string' && clientState.length <= MAX_FIELD_LENGTH ? { clientState } : {}),
		});
	}
	return out;
}
