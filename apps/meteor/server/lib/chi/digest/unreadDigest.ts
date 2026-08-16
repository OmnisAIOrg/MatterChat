import type { IMessage, IUser } from '@rocket.chat/core-typings';
import { Messages, Subscriptions, Users } from '@rocket.chat/models';

import type { DigestChannel, DigestSub } from './digestHelpers';
import {
	MAX_DIGEST_CHANNELS,
	MAX_MESSAGES_PER_CHANNEL,
	readBoundary,
	renderDigestText,
	roomLabelFor,
	selectDigestChannels,
} from './digestHelpers';
import type { NotificationRule } from '../notify/notificationRules';
import { isSilenced, readNotificationRules, rulesReferenceSenderRoles, tzOffsetMinutes } from '../notify/triageDecision';
import { settings } from '../../../settings';

/**
 * MATTERCHAT: gather what a user actually missed.
 *
 * Reads ONLY through the caller's own subscriptions, so the digest can never
 * surface a room they are not in — the same rule the rest of the Chi workspace
 * tools follow. All decidable logic lives in digestHelpers (pure, unit-tested);
 * this file is the database half.
 */

export type UnreadDigest = {
	channels: DigestChannel[];
	text: string;
};

const EMPTY: UnreadDigest = { channels: [], text: 'Nothing unread.' };

const siteUrl = (): string => {
	try {
		return settings.get<string>('Site_Url') || '';
	} catch {
		return '';
	}
};

async function unreadMessagesFor(sub: DigestSub, limit: number): Promise<{ messages: DigestChannel['messages']; omitted: number }> {
	const since = readBoundary(sub);

	// Newest-first with a limit, then reversed — reading oldest-first would mean
	// scanning an unbounded backlog for someone who has been away a fortnight.
	const query: Record<string, unknown> = {
		rid: sub.rid,
		t: { $exists: false },
		msg: { $exists: true, $ne: '' },
		...(since ? { ts: { $gt: since } } : {}),
	};

	const docs = await Messages.find<Pick<IMessage, '_id' | 'msg' | 'u' | 'ts'>>(query, {
		sort: { ts: -1 },
		limit: limit + 1,
		projection: { msg: 1, u: 1, ts: 1 },
	}).toArray();

	// One extra was fetched purely to detect truncation without a second count.
	const omitted = docs.length > limit ? Math.max(0, (sub.unread || docs.length) - limit) : 0;

	const messages = docs
		.slice(0, limit)
		.reverse()
		.map((doc) => ({
			id: doc._id,
			username: doc.u?.username || 'someone',
			text: doc.msg || '',
			ts: doc.ts,
		}));

	return { messages, omitted };
}

/**
 * The user's own `silence` rules, applied to the digest.
 *
 * A `digest` rule belongs in here — being held back from interrupting is exactly what it asked
 * for. A `silence` rule does not: the rules UI says "never surface it", and a digest that
 * re-raises silenced messages the next morning would make that a lie.
 *
 * Costs nothing for the overwhelming majority: one projection on a user document that is read
 * either way, and an early return when they have no rules. Roles are fetched in a single batch
 * query, and only when some rule actually names a role.
 */
async function buildSilenceFilter(
	rules: NotificationRule[],
	utcOffset: unknown,
	channels: DigestChannel[],
): Promise<((channel: DigestChannel, message: DigestChannel['messages'][number]) => boolean) | null> {
	if (!rules.length) {
		return null;
	}

	let rolesByUsername = new Map<string, string[]>();
	if (rulesReferenceSenderRoles(rules)) {
		const usernames = [...new Set(channels.flatMap((channel) => channel.messages.map((message) => message.username)))].filter(Boolean);
		if (usernames.length) {
			const senders = await Users.find<Pick<IUser, '_id' | 'username' | 'roles'>>(
				{ username: { $in: usernames } },
				{ projection: { username: 1, roles: 1 } },
			).toArray();
			rolesByUsername = new Map(senders.map((sender) => [sender.username || '', Array.isArray(sender.roles) ? sender.roles : []]));
		}
	}

	const tz = tzOffsetMinutes(utcOffset);
	return (channel, message) =>
		isSilenced(rules, {
			roomId: channel.rid,
			roomName: channel.name,
			roomType: channel.roomType,
			senderUsername: message.username,
			senderRoles: rolesByUsername.get(message.username),
			text: message.text,
			// A digest is read after the fact, so "was I mentioned" is what the subscription
			// recorded, not something re-derived from the text.
			isMention: channel.mentions > 0 || channel.roomType === 'd',
			isDM: channel.roomType === 'd',
			at: message.ts,
			tzOffsetMinutes: tz,
		});
}

/**
 * Build the digest for one user.
 *
 * Never throws: this feeds a Chi tool and a scheduled brief, and a single
 * unreadable room must not cost the user their whole digest.
 */
export async function gatherUnreadDigest(
	userId: string,
	options: { channelLimit?: number; messageLimit?: number; rid?: string } = {},
): Promise<UnreadDigest> {
	const channelLimit = options.channelLimit ?? MAX_DIGEST_CHANNELS;
	const messageLimit = options.messageLimit ?? MAX_MESSAGES_PER_CHANNEL;

	const subs = await Subscriptions.find<DigestSub>(
		{
			'u._id': userId,
			'open': { $ne: false },
			// One room ("what did I miss in HERE") narrows the SUBSCRIPTION query, so a room the
			// caller is not in produces no subscription and therefore no digest — the same
			// authority check as the workspace-wide path, not a second one.
			...(options.rid ? { rid: options.rid } : {}),
			// Muted conversations are excluded at the query, not filtered later: the
			// user already said they do not want these, and a digest that re-raises
			// them silently overrides a preference they set on purpose.
			'disableNotifications': { $ne: true },
		},
		{ projection: { rid: 1, name: 1, fname: 1, t: 1, unread: 1, userMentions: 1, alert: 1, ls: 1, ts: 1 } },
	).toArray();

	const selected = selectDigestChannels(subs, channelLimit);
	if (!selected.length) {
		return EMPTY;
	}

	let channels: DigestChannel[] = [];
	for (const sub of selected) {
		try {
			const { messages, omitted } = await unreadMessagesFor(sub, messageLimit);
			channels.push({
				rid: sub.rid,
				label: roomLabelFor(sub),
				name: sub.name || sub.fname || '',
				roomType: sub.t,
				unread: sub.unread || 0,
				mentions: sub.userMentions || 0,
				messages,
				omitted,
			});
		} catch {
			// Skip the room, keep the digest.
		}
	}

	if (!channels.length) {
		return EMPTY;
	}

	// The user's own `silence` rules, applied last so the fetch stays one bounded query per room.
	try {
		const user = await Users.findOneById<Pick<IUser, '_id' | 'utcOffset'> & { settings?: unknown }>(userId, {
			projection: { 'utcOffset': 1, 'settings.chi.notificationRules': 1 },
		});
		const silenced = await buildSilenceFilter(readNotificationRules(user), user?.utcOffset, channels);
		if (silenced) {
			const kept: DigestChannel[] = [];
			for (const channel of channels) {
				const messages = channel.messages.filter((message) => !silenced(channel, message));
				if (messages.length) {
					kept.push({ ...channel, messages });
				}
			}
			if (!kept.length) {
				return EMPTY;
			}
			channels = kept;
		}
	} catch {
		// A triage failure must not cost the user their digest — show everything.
	}

	return { channels, text: renderDigestText(channels, siteUrl()) };
}
