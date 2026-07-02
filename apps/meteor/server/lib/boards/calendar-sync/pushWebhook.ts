/**
 * Boards calendar PUSH (webhook) receiver — the Meteor glue. Pure verify/extract logic lives in
 * pushSecurity.ts; the subscription lifecycle + reconcile dispatch live in pushSubscriptions.ts. This
 * file only mounts the route, answers the Graph validation handshake, verifies the per-subscription
 * channel token FAIL-CLOSED, and fires the debounced reconcile.
 *
 * Mounted OUTSIDE /api (RC's REST/Apps router owns /api/* and 404s custom connect-handlers — mirrors
 * the /_connectors/teams/webhook + /_casepro/webhook + /_boards_email/inbound precedents):
 *
 *   POST /_boards_calendar/push/google    ← Google events.watch notifications (delivered as HEADERS)
 *   POST /_boards_calendar/push/outlook   ← Graph /subscriptions change-notifications (JSON body)
 *
 * SECURITY MODEL (public + unauthenticated by the providers' requirement; everything FAIL-CLOSED):
 *  1. VALIDATION HANDSHAKE (Graph) — a POST carrying `?validationToken=` is Graph validating the
 *     endpoint at subscription create/renew: reply 200 with the token as text/plain within 10s. This
 *     is the ONLY request answered without verification, and it triggers no processing.
 *  2. FAIL-CLOSED SECRET — no BOARDS_CALENDAR_PUSH_SECRET ⇒ every notification 202-drops (and no
 *     subscription is ever created, so the system silently keeps POLLING as the fallback). A loud boot
 *     warning is emitted once from startup.ts.
 *  3. CHANNEL TOKEN — every notification must carry the HMAC token derived from the deploy secret +
 *     (connectionId, subscriptionId) of the subscription it claims (constant-time compare). The
 *     subscription is resolved by subscriptionId from OUR OWN Mongo record; an attacker who invents an
 *     id matches nothing, and one who replays a real id still needs the HMAC.
 *  4. RAW-BODY AWARE, BOUNDED — the Graph body is read from the raw stream (256 KB cap, JSON.parse in a
 *     try). Google carries NO body (all signal is in headers) — the stream is drained + ignored.
 *  5. 202 FAST, PROCESS ASYNC — ack immediately; the providers retry non-2xx then drop, so we never
 *     block on the reconcile. On a verified notification → dispatchPushReconcile (debounced) runs the
 *     SAME inbound reconcile the poll does. Nothing from the payload is trusted for CONTENT.
 */
import type { CalendarProvider } from '@rocket.chat/core-typings';
import { BoardCalendarConnections } from '@rocket.chat/models';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { getCalendarPushSecret, PUSH_ROUTE_PREFIX } from './config';
import {
	extractGooglePushNotification,
	extractGraphPushNotifications,
	extractValidationToken,
	isGoogleSyncPing,
	verifyPushToken,
} from './pushSecurity';
import { dispatchPushReconcile } from './pushSubscriptions';
import { SystemLogger } from '../../logger/system';

/** Bound the raw Graph body (notification batches are a few KB; 256 KB is generous). Google has none. */
const MAX_BODY_BYTES = 256 * 1024;

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

/** Drain a stream we don't read (Google notifications carry no body we consume). */
function drain(req: any): Promise<void> {
	return new Promise((resolve) => {
		req.on('data', () => undefined);
		req.on('end', () => resolve());
		req.on('error', () => resolve());
	});
}

/** 200 + the validationToken as text/plain — the Graph endpoint-validation handshake. */
function answerValidationHandshake(res: any, validationToken: string): void {
	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end(validationToken);
}

/** Ack fast (providers want a quick 2xx; they retry then drop otherwise). */
function accepted(res: any): void {
	res.writeHead(202);
	res.end();
}

/**
 * Resolve the connection a subscription id belongs to (our own record) and verify the presented token
 * against it. Returns the connection id on success, null (drop) otherwise. FAIL-CLOSED throughout.
 */
async function verifyAndResolve(subscriptionId: string, presentedToken: unknown, secret: string): Promise<string | null> {
	const conn = await BoardCalendarConnections.findOneByPushSubscriptionId(subscriptionId);
	if (!conn) {
		return null; // unknown/forged subscription id → non-processable
	}
	if (!verifyPushToken(secret, presentedToken, conn._id, subscriptionId)) {
		SystemLogger.warn({ msg: 'boards.calendar.push.token.mismatch — dropping', subscriptionId });
		return null;
	}
	return conn._id;
}

/** Google: all signal is in headers (X-Goog-Channel-ID/-Token/-Resource-State). Body is drained. */
async function handleGoogle(req: any, res: any, secret: string): Promise<void> {
	await drain(req);
	const notif = extractGooglePushNotification(req.headers || {});
	// Ack FIRST — Google drops the channel on repeated slow/non-2xx responses.
	accepted(res);
	if (!notif || isGoogleSyncPing(notif)) {
		return; // the initial `sync` handshake ping carries no change — ignore it
	}
	setImmediate(() => {
		void (async () => {
			try {
				const connectionId = await verifyAndResolve(notif.subscriptionId, notif.channelToken, secret);
				if (connectionId) {
					dispatchPushReconcile(connectionId);
				}
			} catch (err) {
				SystemLogger.error({ msg: 'boards.calendar.push.google.failed', err: String(err) });
			}
		})();
	});
}

/** Graph: JSON `{ value: [{ subscriptionId, clientState }] }`; verify each item, dispatch per connection. */
async function handleGraph(req: any, res: any, url: URL, secret: string): Promise<void> {
	// 1. Endpoint-validation handshake: echo the token, text/plain, 200 — and nothing else.
	const validationToken = extractValidationToken(url.searchParams);
	if (validationToken) {
		return answerValidationHandshake(res, validationToken);
	}

	const raw = await readRawBody(req);
	// Ack FIRST — Graph drops deliveries on slow/5xx.
	accepted(res);
	if (!raw?.length) {
		return;
	}
	let body: unknown;
	try {
		body = JSON.parse(raw.toString('utf8'));
	} catch {
		return;
	}
	const items = extractGraphPushNotifications(body);

	setImmediate(() => {
		void (async () => {
			const dispatched = new Set<string>();
			for (const item of items) {
				try {
					const connectionId = await verifyAndResolve(item.subscriptionId, item.clientState, secret);
					if (connectionId && !dispatched.has(connectionId)) {
						dispatched.add(connectionId); // one reconcile per connection per batch (debounce collapses further)
						dispatchPushReconcile(connectionId);
					}
				} catch (err) {
					SystemLogger.error({ msg: 'boards.calendar.push.graph.item.failed', subscriptionId: item.subscriptionId, err: String(err) });
				}
			}
		})();
	});
}

async function handlePush(provider: CalendarProvider, req: any, res: any, url: URL): Promise<void> {
	// Graph's validation handshake must be answered even with no secret (it's how a subscription would
	// be created), but it never processes anything — safe. Everything else needs the secret.
	const secret = getCalendarPushSecret();

	if (provider === 'outlook') {
		// Let the handshake through regardless; drop real notifications when the secret is unset.
		if (!secret && !extractValidationToken(url.searchParams)) {
			return accepted(res); // fail-closed: no secret ⇒ silently drop, poll remains the fallback
		}
		return handleGraph(req, res, url, secret);
	}

	// Google
	if (!secret) {
		await drain(req);
		return accepted(res); // fail-closed drop
	}
	return handleGoogle(req, res, secret);
}

RoutePolicy.declare(`${PUSH_ROUTE_PREFIX}/`, 'network');

WebApp.connectHandlers.use(PUSH_ROUTE_PREFIX, async (req: any, res: any, next: () => void) => {
	try {
		// connect strips the mount prefix → req.url here is '/google' | '/outlook' (+ query).
		const url = new URL(req.url, 'http://localhost');
		const path = url.pathname;
		if (req.method === 'POST' && (path === '/google' || path.endsWith('/google'))) {
			return await handlePush('google', req, res, url);
		}
		if (req.method === 'POST' && (path === '/outlook' || path.endsWith('/outlook'))) {
			return await handlePush('outlook', req, res, url);
		}
		return next();
	} catch (err) {
		SystemLogger.error({ msg: 'boards.calendar.push.route.error', err: String(err) });
		if (!res.headersSent) {
			res.writeHead(202);
		}
		res.end();
	}
});
