/**
 * Boards email-to-task webhook receiver — the Meteor glue. Pure logic lives in
 * emailWebhookSecurity.ts (HMAC verify + parse) + emailToTask.ts (parse→card); this file only mounts
 * the route, resolves the intake board from the recipient address, and creates the card.
 *
 * Mounted OUTSIDE /api (RC's REST/Apps router owns /api/* and 404s custom connect-handlers — mirrors
 * the /_casepro/webhook + /_connectors/teams precedents):
 *
 *   POST /_boards_email/inbound   ← a signed inbound-email payload from the mail provider (SES inbound
 *                                   notification / a forwarding-address webhook)
 *
 * SECURITY MODEL (public + unauthenticated, everything FAIL-CLOSED):
 *  1. FEATURE GATE — Boards_Email_To_Task_Enabled off (default) ⇒ 202-drop, no processing.
 *  2. FAIL-CLOSED SECRET — no webhook secret (env BOARDS_EMAIL_WEBHOOK_SECRET or the masked setting)
 *     ⇒ every request 202-drops.
 *  3. SIGNATURE — X-Boards-Email-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>; constant-time
 *     verify. Invalid/missing ⇒ 202-drop + warn; nothing leaks.
 *  4. RAW-BODY AWARE, BOUNDED — 2 MB cap; malformed JSON/shape ⇒ 202-drop.
 *  5. CAPABILITY ADDRESS — the recipient must be `boards+<token>@…`; the token resolves to a board
 *     whose email intake is enabled. Unknown token ⇒ 202-drop (non-probeable).
 *  6. 202 FAST, PROCESS ASYNC — ack immediately; create the card in setImmediate.
 */
import { Boards } from '@rocket.chat/models';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { getEmailWebhookSecret, isEmailToTaskEnabled } from './config';
import { createCardFromEmail } from './emailToTask';
import { extractIntakeToken, parseInboundEmailBody, verifyEmailSignature } from './emailWebhookSecurity';
import { SystemLogger } from '../../logger/system';

const ROUTE_PREFIX = '/_boards_email';
const SIGNATURE_HEADER = 'x-boards-email-signature';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

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

function accepted(res: any): void {
	res.writeHead(202);
	res.end();
}

async function handleInbound(req: any, res: any): Promise<void> {
	// FEATURE GATE + FAIL-CLOSED SECRET.
	if (!isEmailToTaskEnabled()) {
		return accepted(res);
	}
	const secret = getEmailWebhookSecret();
	if (!secret) {
		return accepted(res);
	}

	const raw = await readRawBody(req);
	if (!raw?.length) {
		return accepted(res);
	}

	if (!verifyEmailSignature(secret, req.headers?.[SIGNATURE_HEADER], raw)) {
		SystemLogger.warn({ msg: 'Boards email webhook: invalid or missing signature — dropping request' });
		return accepted(res);
	}

	const email = parseInboundEmailBody(raw);
	if (!email) {
		return accepted(res);
	}

	// Ack FIRST (202), process async — the sender never waits on the card write.
	accepted(res);

	setImmediate(async () => {
		try {
			const token = extractIntakeToken(email.to);
			if (!token) {
				return;
			}
			const board = await Boards.findOneByEmailIntakeToken(token);
			if (!board?.emailIntake?.enabled) {
				return; // unknown/disabled token — non-probeable drop
			}
			await createCardFromEmail(email, {
				boardId: board._id,
				listId: board.emailIntake.targetListId,
				ownerUserId: board.emailIntake.ownerUserId,
			});
		} catch (err) {
			SystemLogger.error({ msg: 'Boards email webhook: card creation failed', err: String(err) });
		}
	});
}

RoutePolicy.declare(`${ROUTE_PREFIX}/`, 'network');

WebApp.connectHandlers.use(ROUTE_PREFIX, async (req: any, res: any, next: () => void) => {
	try {
		const url = new URL(req.url, 'http://localhost');
		if (req.method === 'POST' && (url.pathname === '/inbound' || url.pathname.endsWith('/inbound'))) {
			return await handleInbound(req, res);
		}
		return next();
	} catch (err) {
		SystemLogger.error({ msg: 'Boards email webhook route error', err: String(err) });
		if (!res.headersSent) {
			res.writeHead(202);
		}
		res.end();
	}
});
