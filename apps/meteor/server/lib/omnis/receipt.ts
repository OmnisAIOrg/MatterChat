import type { IMessage, MessageAttachment } from '@rocket.chat/core-typings';
import { Rooms, Users } from '@rocket.chat/models';

import { sendMessage } from '../messages/sendMessage';
import { SystemLogger } from '../logger/system';

/**
 * Channel receipts — the shared "what happened" message every completed Omnis
 * action posts back into the channel it came from.
 *
 * Two reasons this exists, and the second is the one that shapes the API:
 *
 * 1. **It closes the permission loop.** Submit is granted broadly; viewing a
 *    product's queue is admin-granted. Without a receipt in the channel, a user
 *    who dropped a document has no way to learn what became of it.
 * 2. **It makes automation auditable.** For actions that trigger data entry
 *    (OmnisProof especially) the receipt ENUMERATES what actually fired, so
 *    anyone in the channel can confirm the matter was updated without opening
 *    CasePro — and a mis-triggered automation gets noticed by someone.
 *
 * ## Failure policy
 *
 * A receipt that fails to post must NEVER turn a completed action into a
 * user-visible error: the action already happened, and surfacing an error
 * invites the user to do it again. {@link postOmnisReceipt} therefore logs and
 * returns `false` rather than throwing. This is the one deliberate exception to
 * "writes throw".
 *
 * ## Why it posts as the acting user with a plain `msg`
 *
 * `sendMessage()` has silent validation gates that swallow programmatic messages
 * into warn-only logs: `alias`/`avatar` require `message-impersonate` (roles
 * `bot`/`app` only), and `customFields` are rejected unless the workspace's
 * `Message_CustomFields` setting is on. Posting as the acting user with a plain
 * `msg` + attachments avoids all of them.
 */

/** One automation step, as it will be rendered in the receipt body. */
export type OmnisReceiptStep = {
	label: string;
	/**
	 * `false` renders the step as failed rather than omitting it. A
	 * partially-applied automation that LOOKS complete is worse than one that
	 * reports the failure.
	 */
	ok: boolean;
	detail?: string;
};

export type OmnisReceiptInput = {
	/** The originating channel. */
	rid: string;
	/** The acting user — the receipt posts as them. */
	uid: string;
	/** Headline, e.g. `✍️ LOP — Maria Alvarez · signed`. */
	title: string;
	/** Optional matter the action was filed against. */
	matterName?: string;
	/** Ordered automation steps. Omit for actions that trigger no data entry. */
	steps?: OmnisReceiptStep[];
	/** "Open in <product>" deep link. Omitted when the product's web URL is unset. */
	link?: { text: string; url: string };
};

const TICK = '✓';
const CROSS = '✗';

/** Render the receipt body. Exported for tests — the wording is the contract. */
export function renderReceipt(input: OmnisReceiptInput): string {
	const lines: string[] = [input.title];

	for (const step of input.steps ?? []) {
		const mark = step.ok ? TICK : CROSS;
		const suffix = step.detail ? ` — ${step.detail}` : '';
		lines.push(`  ${mark} ${step.ok ? step.label : `${step.label} (failed)`}${suffix}`);
	}

	if (input.link) {
		lines.push(`[${input.link.text}](${input.link.url})`);
	}

	return lines.join('\n');
}

/**
 * Post a receipt into the originating channel.
 *
 * @returns `true` when posted, `false` when it could not be (already logged).
 *          Callers MUST NOT propagate a `false` as an error to the user.
 */
export async function postOmnisReceipt(input: OmnisReceiptInput): Promise<boolean> {
	try {
		const [room, user] = await Promise.all([Rooms.findOneById(input.rid), Users.findOneById(input.uid)]);
		if (!room || !user) {
			SystemLogger.warn({ msg: 'Omnis receipt skipped — room or user not found', rid: input.rid, uid: input.uid });
			return false;
		}

		const message: Partial<IMessage> & { rid: string; msg: string } = {
			rid: input.rid,
			msg: renderReceipt(input),
		};

		await sendMessage(user, message, room);
		return true;
	} catch (err) {
		// Deliberate swallow — see the failure policy above.
		SystemLogger.warn({ msg: 'Omnis receipt failed to post (action itself succeeded)', rid: input.rid, err });
		return false;
	}
}

/**
 * Post a plain system-style note into a channel (auto-process cap hit, upload-link
 * activity). Same failure policy as {@link postOmnisReceipt}.
 */
export async function postOmnisNote(rid: string, uid: string, text: string, attachments?: MessageAttachment[]): Promise<boolean> {
	try {
		const [room, user] = await Promise.all([Rooms.findOneById(rid), Users.findOneById(uid)]);
		if (!room || !user) {
			return false;
		}
		const message: Partial<IMessage> & { rid: string; msg: string } = {
			rid,
			msg: text,
			...(attachments?.length ? { attachments } : {}),
		};
		await sendMessage(user, message, room);
		return true;
	} catch (err) {
		SystemLogger.warn({ msg: 'Omnis note failed to post', rid, err });
		return false;
	}
}
