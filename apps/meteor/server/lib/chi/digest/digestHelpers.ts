/**
 * MATTERCHAT: pure helpers for Catch Me Up and the morning brief.
 *
 * No Meteor, model, or settings imports — everything here is input → output so
 * it unit-tests without a database (see tests/unit/server/lib/chi/digest/).
 *
 * ## Why a digest is not just a count
 *
 * The existing `catch_me_up` tool reports how MUCH is waiting: eleven unread in
 * four channels. That tells you the size of the problem, not what it is, so the
 * user still opens all four channels — which is the work they asked to avoid.
 *
 * A digest carries the actual messages, and every line carries a permalink, so
 * the summary the model writes is something you can click rather than something
 * you have to act on afterwards. That is the whole difference between a summary
 * and a to-do list.
 */

export type DigestSub = {
	rid: string;
	name?: string;
	fname?: string;
	t: string;
	unread?: number;
	userMentions?: number;
	alert?: boolean;
	/** Subscription last-seen timestamp — the read boundary. */
	ls?: Date;
	/** Subscription creation, used as the boundary when the room was never opened. */
	ts?: Date;
};

export type DigestMessage = {
	id: string;
	username: string;
	text: string;
	ts: Date;
};

export type DigestChannel = {
	rid: string;
	/** Human label, e.g. `#intake` — for display only. */
	label: string;
	/**
	 * The ROUTING name (the room's `name`), kept separate from `label`.
	 *
	 * These differ more often than you would expect: a room can display an
	 * `fname` ("Smith & Associates") that is not its route (`smith-associates`),
	 * and deriving one from the other by stripping the `#` produces links that
	 * 404 for exactly the firms whose names needed prettifying.
	 */
	name: string;
	roomType: string;
	unread: number;
	mentions: number;
	messages: DigestMessage[];
	/** Unread messages beyond those included. */
	omitted: number;
};

/** How many conversations one digest covers before it stops being readable. */
export const MAX_DIGEST_CHANNELS = 8;

/** How many messages we carry per conversation. */
export const MAX_MESSAGES_PER_CHANNEL = 15;

export const roomLabelFor = (sub: Pick<DigestSub, 'name' | 'fname' | 't'>): string =>
	`${sub.t === 'd' ? '@' : '#'}${sub.name || sub.fname || 'conversation'}`;

/**
 * The URL path segment Rocket.Chat routes each room type under. A wrong segment
 * produces a link that 404s, which is worse than no link at all — so unknown
 * types fall back to `channel`, the only one that is ever correct by accident.
 */
export const roomPathSegment = (roomType: string): string => {
	switch (roomType) {
		case 'd':
			return 'direct';
		case 'p':
			return 'group';
		case 'l':
			return 'livechat';
		default:
			return 'channel';
	}
};

/**
 * A clickable jump link to one message.
 *
 * Returns an empty string rather than a broken URL when the pieces are missing:
 * a digest line with no link still reads fine, but a line linking to
 * `undefined` looks like a bug to the user and is one.
 */
export const buildPermalink = (siteUrl: string, sub: Pick<DigestSub, 'name' | 'fname' | 't'>, messageId: string): string => {
	const base = (siteUrl || '').replace(/\/+$/, '');
	const roomName = sub.name || sub.fname || '';
	if (!base || !roomName || !messageId) {
		return '';
	}
	return `${base}/${roomPathSegment(sub.t)}/${encodeURIComponent(roomName)}?msg=${encodeURIComponent(messageId)}`;
};

/** The read boundary for a subscription: last-seen, else when they joined. */
export const readBoundary = (sub: Pick<DigestSub, 'ls' | 'ts'>): Date | undefined => sub.ls ?? sub.ts;

/**
 * Which conversations a digest should cover, most-deserving first.
 *
 * Ordering is mentions, then unread volume, then name — someone who was named
 * personally is waiting on a reply, and that outranks a busy channel they were
 * merely in. Muted conversations are dropped entirely: the user already said
 * they did not want to hear about those, and a digest that re-surfaces muted
 * channels quietly overrides a preference the user set deliberately.
 */
export const selectDigestChannels = (subs: DigestSub[], limit: number = MAX_DIGEST_CHANNELS): DigestSub[] =>
	subs
		.filter((sub) => (sub.unread || 0) > 0 || sub.alert === true)
		.sort((a, b) => {
			const mentions = (b.userMentions || 0) - (a.userMentions || 0);
			if (mentions !== 0) {
				return mentions;
			}
			const unread = (b.unread || 0) - (a.unread || 0);
			if (unread !== 0) {
				return unread;
			}
			return roomLabelFor(a).localeCompare(roomLabelFor(b));
		})
		.slice(0, Math.max(0, limit));

/**
 * Totals across a digest, for the one-line header.
 */
export const digestTotals = (channels: DigestChannel[]): { conversations: number; unread: number; mentions: number } => ({
	conversations: channels.length,
	unread: channels.reduce((sum, channel) => sum + channel.unread, 0),
	mentions: channels.reduce((sum, channel) => sum + channel.mentions, 0),
});

/**
 * Render the digest as the text handed to the model (or emailed verbatim).
 *
 * Deliberately plain: the tool gathers, the model reasons. Handing the model
 * pre-summarized prose would mean summarizing a summary, which is where
 * detail goes to die.
 */
export const renderDigestText = (channels: DigestChannel[], siteUrl: string): string => {
	if (!channels.length) {
		return 'Nothing unread.';
	}

	const totals = digestTotals(channels);
	const header = `${totals.unread} unread message${totals.unread === 1 ? '' : 's'} across ${totals.conversations} conversation${
		totals.conversations === 1 ? '' : 's'
	}${totals.mentions ? `, including ${totals.mentions} direct mention${totals.mentions === 1 ? '' : 's'}` : ''}.`;

	const blocks = channels.map((channel) => {
		const heading = `${channel.label}${channel.mentions ? ` — ${channel.mentions} mention${channel.mentions === 1 ? '' : 's'}` : ''}${
			channel.unread ? ` (${channel.unread} unread)` : ''
		}`;
		if (!channel.messages.length) {
			return `${heading}\n  (no readable messages — they may have been deleted)`;
		}
		const lines = channel.messages.map((message) => {
			const link = buildPermalink(siteUrl, { name: channel.name, t: channel.roomType }, message.id);
			const text = message.text.replace(/\s+/g, ' ').trim();
			return `  - ${message.username}: ${text}${link ? ` [jump](${link})` : ''}`;
		});
		if (channel.omitted > 0) {
			lines.push(`  - …and ${channel.omitted} earlier message${channel.omitted === 1 ? '' : 's'}`);
		}
		return `${heading}\n${lines.join('\n')}`;
	});

	return [header, '', ...blocks].join('\n');
};
