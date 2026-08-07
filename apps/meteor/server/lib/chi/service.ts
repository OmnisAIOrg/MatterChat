import { api } from '@rocket.chat/core-services';
import type { IMessage, IRoom, IUser } from '@rocket.chat/core-typings';
import { Rooms, Users } from '@rocket.chat/models';

import { getChiBotUser } from './bot';
import { askChi } from './client';
import { isChiConfigured } from './config';
import { parseChiQuestion } from './context';
import { hasPermissionAsync } from '../authorization/hasPermission';
import { sendMessage } from '../messages/sendMessage';
import { updateMessage } from '../messages/updateMessage';

/**
 * CHI assistant — /chi orchestration.
 *
 * UX flow (async by design; agent calls can take many seconds):
 *  1. Validate: question present → `chi-use` permission → CHI configured. Any miss is an
 *     EPHEMERAL note to the caller only (nothing hits the channel).
 *  2. Post a real "Chi is thinking…" placeholder into the channel as the Chi bot —
 *     everyone sees the question was picked up immediately.
 *  3. Ask the CHI agent (room name + the room's CasePro matterId + the question).
 *  4. EDIT the placeholder in place with the answer (attributed, matter-stamped footer)
 *     or a friendly failure note. The command bus is never blocked on the agent call.
 *
 * PRIVACY: neither the question nor the answer is ever logged server-side — they exist
 * only as normal channel messages (standard message storage/retention applies).
 */

const notifyEphemeral = (userId: string, rid: string, msg: string): void => {
	void api.broadcast('notify.ephemeralMessage', userId, rid, { msg });
};

const USAGE = 'Usage: /chi <question> — ask Chi (the OmnisAI assistant) about this channel, its CasePro matter, or anything else.';
const NOT_CONFIGURED = 'CHI is not configured on this workspace. An admin needs to set CHI_API_URL, CHI_API_KEY and CHI_AGENT_ID.';
const THINKING = '⏳ _Chi is thinking…_';

/** Footer stamped under every answer — attribution + the matter the answer is scoped to. */
export function formatChiAnswer(text: string, opts: { askedBy?: string; matterId?: string }): string {
	const parts: string[] = ['*Chi*'];
	if (opts.askedBy) {
		parts.push(`asked by @${opts.askedBy}`);
	}
	if (opts.matterId) {
		parts.push(`matter \`${opts.matterId}\``);
	}
	return `${text}\n\n— ${parts.join(' · ')}`;
}

/** Friendly in-channel failure (placeholder is edited to this; content never logged). */
export function formatChiFailure(note: string): string {
	return `⚠️ Chi couldn't answer right now — ${note}. Please try again in a moment.`;
}

/**
 * Handle one /chi invocation. Awaitable end-to-end for tests; the slash-command
 * callback intentionally fires it without awaiting the agent round-trip.
 */
export async function handleChiQuestion(userId: string, rid: string, params: string): Promise<void> {
	const question = parseChiQuestion(params);
	if (!question) {
		return notifyEphemeral(userId, rid, USAGE);
	}

	if (!(await hasPermissionAsync(userId, 'chi-use'))) {
		return notifyEphemeral(userId, rid, 'You do not have permission to use Chi here (missing `chi-use`).');
	}

	if (!isChiConfigured()) {
		return notifyEphemeral(userId, rid, NOT_CONFIGURED);
	}

	const room: IRoom | null = await Rooms.findOneById(rid);
	if (!room) {
		return notifyEphemeral(userId, rid, 'Chi could not find this channel.');
	}

	const asker: Pick<IUser, '_id' | 'username'> | null = await Users.findOneById(userId, { projection: { username: 1 } });
	const askedBy = asker?.username;
	const { matterId } = room;
	const roomName = room.fname || room.name;

	let bot: IUser;
	let placeholder: IMessage | false | undefined;
	try {
		bot = await getChiBotUser();
		placeholder = await sendMessage(bot, { rid, msg: THINKING }, room);
	} catch (err) {
		return notifyEphemeral(userId, rid, formatChiFailure('the assistant could not post to this channel'));
	}
	if (!placeholder) {
		return notifyEphemeral(userId, rid, formatChiFailure('the assistant could not post to this channel'));
	}

	const answer = await askChi({ question, roomName, matterId, askedBy });
	const finalText = answer.ok ? formatChiAnswer(answer.text, { askedBy, matterId }) : formatChiFailure(answer.note);

	try {
		await updateMessage({ _id: placeholder._id, rid, msg: finalText }, bot, placeholder);
	} catch (err) {
		// Edit failed (e.g. message deleted meanwhile) — last resort: tell the asker only.
		notifyEphemeral(userId, rid, answer.ok ? finalText : formatChiFailure(answer.note));
	}
}
