/**
 * Email-to-task: turn a forwarded/received email into a Boards card. The PURE parsing lives in
 * emailParse.ts (unit-tested, no Meteor); this thin creator composes it with the normal `createCard`
 * service path (board ACL, activity log, card numbering all behave as if a member created it — mirrors
 * the forms public-submit precedent).
 *
 * The INBOUND TRANSPORT is a webhook a mail provider (SES inbound / a forwarding address) POSTs to,
 * verified FAIL-CLOSED with HMAC (see emailWebhook.ts, cloned from /_casepro/webhook). This module
 * never speaks SMTP/IMAP — we do NOT run a mail server.
 */
import type { IBoardCard } from '@rocket.chat/core-typings';
import { Meteor } from 'meteor/meteor';

import { createCard } from '../service';
import type { InboundEmail } from './emailParse';
import { parseEmailToCard } from './emailParse';

export type { InboundEmail } from './emailParse';

/** The board routing a verified inbound email resolves to (resolved by the webhook from the `to` address). */
export type EmailTaskTarget = {
	boardId: string;
	listId: string;
	/** The MatterChat user the card is created AS (the board member who owns the intake address). */
	ownerUserId: string;
};

/**
 * Create a card from a verified inbound email, AS the target's owner user. Throws (via createCard) if
 * the owner has lost board access — the conservative "disabled intake" outcome, matching forms.
 */
export async function createCardFromEmail(email: InboundEmail, target: EmailTaskTarget): Promise<IBoardCard> {
	if (!target.boardId || !target.listId || !target.ownerUserId) {
		throw new Meteor.Error('error-invalid-email-target', 'Invalid email-to-task target');
	}
	const { title, description } = parseEmailToCard(email);
	return createCard(target.ownerUserId, {
		boardId: target.boardId,
		listId: target.listId,
		title,
		description,
		cardType: 'task',
	});
}
