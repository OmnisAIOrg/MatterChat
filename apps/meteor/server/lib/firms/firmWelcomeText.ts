import type { ChannelSpec } from './firmTemplates';

/**
 * MATTERCHAT: the text of the message Chi posts into a brand-new firm.
 *
 * Pure — no Meteor/model imports — so it unit-tests without a database, the
 * same split as firmsHelpers vs firmsService. The posting half lives in
 * firmWelcome.ts.
 *
 * ## Why this message exists
 *
 * Setup creates a team and several channels, and then says nothing. The owner
 * lands in a workspace that looks like it always came that way: no evidence
 * anything was done for them, and no indication of what to do next. The
 * complaint that started this work was literally "it just made me a channel".
 *
 * So Chi states what it built and what to do next, in the room the owner is
 * about to land in. One message, not a tour — the point is to close the loop on
 * an action they just took, not to teach the product.
 */
export const renderWelcome = (firmName: string, channels: ChannelSpec[], ownerUsername?: string): string => {
	const greeting = ownerUsername ? `Welcome to **${firmName}**, @${ownerUsername}.` : `Welcome to **${firmName}**.`;

	const lines = [greeting, ''];

	// Seeding is best-effort, so an empty list is possible. Claiming channels
	// exist when they do not is worse than saying nothing about them.
	if (channels.length) {
		lines.push(`I set up ${channels.length} channel${channels.length === 1 ? '' : 's'} to match how you work:`);
		lines.push(...channels.map((channel) => `• **${channel.display}** — ${channel.topic}`));
		lines.push('');
	}

	lines.push(
		'Everything here is private to your firm. A few things you can ask me:',
		'• "invite jane@… and john@…" — add your team',
		'• "catch me up" — what you missed, with links',
		'• "remind me Thursday to chase the adjuster"',
		'',
		'You can rename or delete any of these channels — they are ordinary channels.',
	);

	return lines.join('\n');
};
