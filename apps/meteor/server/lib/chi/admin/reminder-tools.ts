import { Messages, Rooms, Subscriptions } from '@rocket.chat/models';

import type { ChiTool } from './tools';
import { getChiContext } from './turnctx';
import { ChiReminders } from '../../../models/ChiReminders';
import { describeReminder, validateReminderTime } from '../reminders/reminderHelpers';

/**
 * MATTERCHAT: Chi reminders and follow-ups.
 *
 * Every tool here is `access: 'user'` and acts only on the CALLER's own
 * reminders, resolved through the caller's own subscriptions — the same rule
 * the rest of the workspace tools follow.
 *
 * ## Why the conditional kind exists
 *
 * A plain timer is easy and only half the job. The case that actually costs a
 * firm money is "opposing counsel hasn't come back to us" — and a reminder that
 * fires whether or not they replied trains you to dismiss it without reading.
 * A `no-reply` follow-up cancels itself when somebody else posts in the room,
 * so it only ever speaks when the thing you were waiting for did not happen.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const norm = (s?: string): string => (s || '').toLowerCase();

type Sub = { rid: string; name?: string; fname?: string; t: string };

const roomLabel = (sub: Pick<Sub, 'name' | 'fname' | 't'>): string => `${sub.t === 'd' ? '@' : '#'}${sub.name || sub.fname || 'conversation'}`;

/** Resolve a room the caller belongs to, or the one they are currently viewing. */
async function resolveCallerRoom(uid: string, query: string): Promise<Sub | null> {
	const subs = await Subscriptions.find<Sub>(
		{ 'u._id': uid, 'open': { $ne: false } },
		{ projection: { rid: 1, name: 1, fname: 1, t: 1 } },
	).toArray();

	const q = norm(query.replace(/^[#@]/, ''));
	if (!q) {
		const ctx = getChiContext();
		if (ctx?.rid) {
			return subs.find((s) => s.rid === ctx.rid) ?? null;
		}
		return null;
	}
	return (
		subs.find((s) => norm(s.name) === q || norm(s.fname) === q) ||
		subs.find((s) => norm(s.name).startsWith(q) || norm(s.fname).startsWith(q)) ||
		subs.find((s) => norm(s.name).includes(q) || norm(s.fname).includes(q)) ||
		null
	);
}

const remindMe: ChiTool = {
	def: {
		name: 'remind_me',
		description:
			'Set a reminder for the user. Two kinds. A plain timer: "remind me about this Thursday", "nudge me in 2 hours", "remind me tomorrow 9am to file the motion". A conditional follow-up that cancels itself if someone replies: "remind me if opposing counsel hasn\'t replied by Friday", "chase this if nobody answers by Monday" — pass ifNoReply: true for those. Pass the user\'s own time phrase through verbatim in `when`; do not convert it to a date yourself.',
		inputSchema: {
			type: 'object',
			properties: {
				when: { type: 'string', description: 'The time phrase exactly as the user said it, e.g. "thursday", "in 2 hours", "tomorrow 9am".' },
				note: { type: 'string', description: 'What the reminder is about, in the user\'s words.' },
				channel: { type: 'string', description: 'Conversation this concerns; omit to use the one being viewed.' },
				ifNoReply: { type: 'boolean', description: 'true = only fire if nobody else has posted in that conversation by then.' },
			},
			required: ['when'],
		},
	},
	access: 'user',
	async execute(input, actor) {
		const now = new Date();
		const check = validateReminderTime({ when: str(input.when), now });
		if (!check.ok) {
			return check.reason;
		}

		const ifNoReply = input.ifNoReply === true;
		const sub = await resolveCallerRoom(actor._id, str(input.channel));

		// A conditional follow-up needs a conversation to watch; a plain timer does not.
		if (ifNoReply && !sub) {
			return 'Which conversation should I watch for a reply? Open it, or name it.';
		}

		const ctx = getChiContext();
		const reminder = await ChiReminders.create({
			userId: actor._id,
			kind: ifNoReply ? 'no-reply' : 'timer',
			note: str(input.note),
			dueAt: check.at,
			...(sub ? { rid: sub.rid, roomLabel: roomLabel(sub) } : {}),
			...(ctx?.focusedMessageId ? { messageId: ctx.focusedMessageId } : {}),
			...(ifNoReply ? { watchSince: now } : {}),
		});

		const where = reminder.roomLabel ? ` in ${reminder.roomLabel}` : '';
		return ifNoReply
			? `I'll check ${reminder.roomLabel} on ${check.at.toLocaleString()} and only nudge you if nobody has replied.`
			: `Reminder set for ${check.at.toLocaleString()}${where}.`;
	},
};

const listReminders: ChiTool = {
	def: {
		name: 'list_reminders',
		description: 'List the reminders the user has pending. Use for "what reminders do I have", "what am I chasing", "show my follow-ups".',
		inputSchema: { type: 'object', properties: {} },
	},
	access: 'user',
	async execute(_input, actor) {
		const now = new Date();
		const reminders = await ChiReminders.listPending(actor._id);
		if (!reminders.length) {
			return 'You have no reminders set.';
		}
		const lines = reminders.map((reminder, index) =>
			describeReminder(
				{
					_id: reminder._id,
					kind: reminder.kind,
					note: reminder.note,
					dueAt: reminder.dueAt,
					rid: reminder.rid,
					roomLabel: reminder.roomLabel,
					messageId: reminder.messageId,
				},
				now,
				index,
			),
		);
		return [`${reminders.length} reminder${reminders.length === 1 ? '' : 's'} pending:`, ...lines].join('\n');
	},
};

const cancelReminder: ChiTool = {
	def: {
		name: 'cancel_reminder',
		description:
			'Cancel one pending reminder by its position in the list from list_reminders (1-based), or cancel every one with all: true. Use for "cancel the second reminder", "clear all my reminders".',
		inputSchema: {
			type: 'object',
			properties: {
				position: { type: 'number', description: '1-based position from list_reminders.' },
				all: { type: 'boolean', description: 'true to cancel every pending reminder.' },
			},
		},
	},
	access: 'user',
	needsConfirm(input) {
		return input.all === true ? 'Cancel EVERY pending reminder' : undefined;
	},
	async execute(input, actor) {
		if (input.all === true) {
			const count = await ChiReminders.cancelAll(actor._id);
			return count ? `Cancelled ${count} reminder${count === 1 ? '' : 's'}.` : 'You had no reminders to cancel.';
		}

		const position = typeof input.position === 'number' ? input.position : Number.NaN;
		if (!Number.isInteger(position) || position < 1) {
			return 'Which one? Give me its number from the list, or say "cancel all".';
		}

		// Resolve position against the same ordering list_reminders showed, so the
		// number the user just read is the one that gets cancelled.
		const reminders = await ChiReminders.listPending(actor._id);
		const target = reminders[position - 1];
		if (!target) {
			return `You only have ${reminders.length} reminder${reminders.length === 1 ? '' : 's'} pending.`;
		}
		await ChiReminders.cancel(actor._id, target._id);
		return `Cancelled: ${target.note || 'reminder'}.`;
	},
};

/**
 * Has anyone other than the reminder's owner posted in the watched room since
 * it was set? Exported for the cron and for tests.
 */
export async function hasSomeoneReplied(rid: string, since: Date, ownerId: string): Promise<boolean> {
	const reply = await Messages.findOne(
		{ 'rid': rid, 'ts': { $gt: since }, 'u._id': { $ne: ownerId }, 't': { $exists: false } },
		{ projection: { _id: 1 } },
	);
	return Boolean(reply);
}

export async function roomStillExists(rid: string): Promise<boolean> {
	return Boolean(await Rooms.findOneById(rid, { projection: { _id: 1 } }));
}

export const CHI_REMINDER_TOOLS: ChiTool[] = [remindMe, listReminders, cancelReminder];
