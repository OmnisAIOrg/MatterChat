import type { IMessage } from '@rocket.chat/core-typings';
import { Messages, Subscriptions } from '@rocket.chat/models';

import type { DigestChannel, DigestSub } from './digestHelpers';
import {
	MAX_DIGEST_CHANNELS,
	MAX_MESSAGES_PER_CHANNEL,
	readBoundary,
	renderDigestText,
	roomLabelFor,
	selectDigestChannels,
} from './digestHelpers';
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
 * Build the digest for one user.
 *
 * Never throws: this feeds a Chi tool and a scheduled brief, and a single
 * unreadable room must not cost the user their whole digest.
 */
export async function gatherUnreadDigest(
	userId: string,
	options: { channelLimit?: number; messageLimit?: number } = {},
): Promise<UnreadDigest> {
	const channelLimit = options.channelLimit ?? MAX_DIGEST_CHANNELS;
	const messageLimit = options.messageLimit ?? MAX_MESSAGES_PER_CHANNEL;

	const subs = await Subscriptions.find<DigestSub>(
		{
			'u._id': userId,
			'open': { $ne: false },
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

	const channels: DigestChannel[] = [];
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

	return { channels, text: renderDigestText(channels, siteUrl()) };
}
