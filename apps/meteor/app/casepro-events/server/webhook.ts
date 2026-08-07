/**
 * CasePro case-update webhook receiver — the Meteor glue. Pure logic lives in security.ts +
 * processing.ts (unit-tested, no Meteor imports); this file only mounts the route and posts the
 * flushed digests into rooms.
 *
 * Mounted OUTSIDE /api (RC's REST/Apps router owns `/api/*` and 404s custom connect-handlers —
 * mirrors the `/_connectors/teams` webhook precedent exactly):
 *
 *   POST /_casepro/webhook   ← signed case-update events from the CasePro CRM
 *
 * SECURITY MODEL (public + unauthenticated endpoint, so everything fails closed):
 *  1. FAIL-CLOSED SECRET — no CASEPRO_WEBHOOK_SECRET env ⇒ one loud boot warning, then every
 *     request is answered 202 with NO processing (drop).
 *  2. SIGNATURE — X-CasePro-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>; constant-time
 *     verify (see security.ts). Invalid/missing ⇒ 202-drop + warn log; nothing leaks.
 *  3. TIMESTAMP SKEW — the signed body's `timestamp` must be within ±5 min of server time.
 *  4. RAW-BODY AWARE, BOUNDED — 1 MB cap; malformed JSON/shape ⇒ 202-drop.
 *  5. 202 FAST, PROCESS ASYNC — ack immediately, then setImmediate: dedupe on event_id (sha256 of
 *     raw body when absent), collapse bursts per matter into one 60s digest, post to every room
 *     whose `matterId` (IRoom top-level field, set by the boards channel↔matter link) matches.
 *
 * Messages post via the standard sendMessage() path as 'rocket.cat' with alias "CasePro" — no new
 * message pipeline. Deep link appended when the `CasePro_Web_URL` setting is present (read
 * defensively; a sibling lane may register it — absent/empty ⇒ plain text).
 */
import crypto from 'crypto';

import { Rooms, Users } from '@rocket.chat/models';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { CASEPRO_ROUTE_PREFIX, CASEPRO_SIGNATURE_HEADER, caseproWebhookSecret } from './config';
import { EventMemo, MatterDigestBuffer, formatCaseUpdateMessage } from './processing';
import type { CaseProEvent } from './security';
import { isTimestampFresh, parseCaseProEvent, verifySignature } from './security';
import { sendMessage } from '../../../server/lib/messages/sendMessage';
import { settings } from '../../../server/settings';
import { SystemLogger } from '../../../server/lib/logger/system';

/** Bound the raw request body (a case-update event is <1 KB; 1 MB is generous). */
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

/** Ack fast; the sender never learns why a payload was dropped. */
function accepted(res: any): void {
	res.writeHead(202);
	res.end();
}

/** `CasePro_Web_URL` setting, read defensively (it may not be registered yet). Empty ⇒ no link. */
function caseproWebUrl(): string {
	try {
		return String(settings.get('CasePro_Web_URL') || '').trim();
	} catch {
		return '';
	}
}

/** Post ONE flushed digest window into every room linked to the matter (rooms.matterId). */
async function postDigest(matterId: string, events: CaseProEvent[]): Promise<void> {
	const rooms = await Rooms.find({ matterId }).toArray();
	if (!rooms.length) {
		return;
	}
	const bot = await Users.findOneById('rocket.cat');
	if (!bot?.username) {
		SystemLogger.warn({ msg: 'CasePro webhook: rocket.cat user missing — cannot post case updates', matterId });
		return;
	}
	const text = formatCaseUpdateMessage(events, matterId, caseproWebUrl());
	for (const room of rooms) {
		try {
			await sendMessage(bot, { msg: text, rid: room._id, alias: 'CasePro', groupable: false }, room);
		} catch (err) {
			SystemLogger.warn({ msg: 'CasePro webhook: posting case update failed', rid: room._id, matterId, err: String(err) });
		}
	}
}

const eventMemo = new EventMemo();
const digestBuffer = new MatterDigestBuffer(async (matterId, events) => {
	try {
		await postDigest(matterId, events);
	} catch (err) {
		SystemLogger.error({ msg: 'CasePro webhook: digest processing failed', matterId, err: String(err) });
	}
});

async function handleWebhook(req: any, res: any): Promise<void> {
	// FAIL-CLOSED: without the deploy secret nothing can verify, so nothing is processed.
	const secret = caseproWebhookSecret();
	if (!secret) {
		return accepted(res);
	}

	const raw = await readRawBody(req);
	if (!raw?.length) {
		return accepted(res);
	}

	if (!verifySignature(secret, req.headers?.[CASEPRO_SIGNATURE_HEADER], raw)) {
		SystemLogger.warn({ msg: 'CasePro webhook: invalid or missing signature — dropping request' });
		return accepted(res);
	}

	const event = parseCaseProEvent(raw);
	if (!event) {
		return accepted(res);
	}

	if (!isTimestampFresh(event.timestamp, Date.now())) {
		SystemLogger.warn({ msg: 'CasePro webhook: timestamp outside allowed skew — dropping event', eventId: event.eventId });
		return accepted(res);
	}

	// Ack FIRST (202), process async — the sender never waits on room writes.
	accepted(res);

	setImmediate(() => {
		try {
			const dedupeKey = event.eventId || crypto.createHash('sha256').update(raw).digest('hex');
			if (!eventMemo.firstSeen(dedupeKey)) {
				return;
			}
			if (!event.matterId) {
				return;
			}
			digestBuffer.add(event, event.matterId);
		} catch (err) {
			SystemLogger.error({ msg: 'CasePro webhook: event processing failed', err: String(err) });
		}
	});
}

// ─── mount ───────────────────────────────────────────────────────────────────────────────────

RoutePolicy.declare(`${CASEPRO_ROUTE_PREFIX}/`, 'network');

WebApp.connectHandlers.use(CASEPRO_ROUTE_PREFIX, async (req: any, res: any, next: () => void) => {
	try {
		// connect strips the mount prefix, so req.url here is '/webhook' (+ query).
		const url = new URL(req.url, 'http://localhost');
		if (req.method === 'POST' && (url.pathname === '/webhook' || url.pathname.endsWith('/webhook'))) {
			return await handleWebhook(req, res);
		}
		return next();
	} catch (err) {
		SystemLogger.error({ msg: 'CasePro webhook route error', err: String(err) });
		// Internal failures are logged, never leaked — the sender only ever sees 2xx.
		if (!res.headersSent) {
			res.writeHead(202);
		}
		res.end();
	}
});
