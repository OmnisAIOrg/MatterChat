import { expect } from 'chai';
import { describe, it } from 'mocha';

import type { DigestChannel, DigestSub } from '../../../../../../server/lib/chi/digest/digestHelpers';
import {
	MAX_DIGEST_CHANNELS,
	buildPermalink,
	digestTotals,
	readBoundary,
	renderDigestText,
	roomLabelFor,
	roomPathSegment,
	selectDigestChannels,
} from '../../../../../../server/lib/chi/digest/digestHelpers';

const sub = (over: Partial<DigestSub> = {}): DigestSub => ({ rid: 'r1', name: 'general', t: 'c', ...over });

const channel = (over: Partial<DigestChannel> = {}): DigestChannel => ({
	rid: 'r1',
	label: '#general',
	name: 'general',
	roomType: 'c',
	unread: 1,
	mentions: 0,
	messages: [],
	omitted: 0,
	...over,
});

describe('digestHelpers', () => {
	describe('roomPathSegment', () => {
		it('maps each room type to its route', () => {
			expect(roomPathSegment('c')).to.equal('channel');
			expect(roomPathSegment('p')).to.equal('group');
			expect(roomPathSegment('d')).to.equal('direct');
			expect(roomPathSegment('l')).to.equal('livechat');
		});

		it('falls back to channel for an unknown type rather than emitting a broken route', () => {
			expect(roomPathSegment('x')).to.equal('channel');
			expect(roomPathSegment('')).to.equal('channel');
		});
	});

	describe('roomLabelFor', () => {
		it('prefixes DMs with @ and everything else with #', () => {
			expect(roomLabelFor({ name: 'jane', t: 'd' })).to.equal('@jane');
			expect(roomLabelFor({ name: 'general', t: 'c' })).to.equal('#general');
			expect(roomLabelFor({ name: 'private', t: 'p' })).to.equal('#private');
		});

		it('falls back to fname, then to a generic label', () => {
			expect(roomLabelFor({ fname: 'Display Name', t: 'c' })).to.equal('#Display Name');
			expect(roomLabelFor({ t: 'c' })).to.equal('#conversation');
		});
	});

	describe('buildPermalink', () => {
		it('builds a jump link for a channel message', () => {
			expect(buildPermalink('https://chat.example.com', { name: 'general', t: 'c' }, 'abc123')).to.equal(
				'https://chat.example.com/channel/general?msg=abc123',
			);
		});

		it('uses the right segment per room type', () => {
			expect(buildPermalink('https://x.io', { name: 'jane', t: 'd' }, 'm1')).to.equal('https://x.io/direct/jane?msg=m1');
			expect(buildPermalink('https://x.io', { name: 'secret', t: 'p' }, 'm1')).to.equal('https://x.io/group/secret?msg=m1');
		});

		it('strips trailing slashes from the site URL', () => {
			expect(buildPermalink('https://x.io///', { name: 'general', t: 'c' }, 'm1')).to.equal('https://x.io/channel/general?msg=m1');
		});

		it('percent-encodes room names and message ids', () => {
			expect(buildPermalink('https://x.io', { name: 'a b&c', t: 'c' }, 'm/1')).to.equal('https://x.io/channel/a%20b%26c?msg=m%2F1');
		});

		it('returns an empty string rather than a broken link when a piece is missing', () => {
			expect(buildPermalink('', { name: 'general', t: 'c' }, 'm1')).to.equal('');
			expect(buildPermalink('https://x.io', { t: 'c' }, 'm1')).to.equal('');
			expect(buildPermalink('https://x.io', { name: 'general', t: 'c' }, '')).to.equal('');
		});
	});

	describe('readBoundary', () => {
		it('prefers last-seen', () => {
			const ls = new Date('2026-01-02');
			const ts = new Date('2026-01-01');
			expect(readBoundary({ ls, ts })).to.equal(ls);
		});

		it('falls back to the subscription start when the room was never opened', () => {
			const ts = new Date('2026-01-01');
			expect(readBoundary({ ts })).to.equal(ts);
		});

		it('is undefined when neither is known', () => {
			expect(readBoundary({})).to.be.undefined;
		});
	});

	describe('selectDigestChannels', () => {
		it('keeps only conversations with unread or an alert', () => {
			const picked = selectDigestChannels([
				sub({ rid: 'a', unread: 3 }),
				sub({ rid: 'b', unread: 0 }),
				sub({ rid: 'c', unread: 0, alert: true }),
			]);
			expect(picked.map((s) => s.rid)).to.deep.equal(['a', 'c']);
		});

		it('puts mentions first, even when another channel has more unread', () => {
			const picked = selectDigestChannels([
				sub({ rid: 'busy', name: 'busy', unread: 50 }),
				sub({ rid: 'mentioned', name: 'mentioned', unread: 1, userMentions: 1 }),
			]);
			expect(picked[0].rid).to.equal('mentioned');
		});

		it('orders by unread volume when mentions tie', () => {
			const picked = selectDigestChannels([sub({ rid: 'few', name: 'few', unread: 2 }), sub({ rid: 'many', name: 'many', unread: 9 })]);
			expect(picked.map((s) => s.rid)).to.deep.equal(['many', 'few']);
		});

		it('breaks a full tie by name so the order is stable between runs', () => {
			const picked = selectDigestChannels([sub({ rid: 'z', name: 'zulu', unread: 1 }), sub({ rid: 'a', name: 'alpha', unread: 1 })]);
			expect(picked.map((s) => s.name)).to.deep.equal(['alpha', 'zulu']);
		});

		it('caps the number of conversations', () => {
			const many = Array.from({ length: 30 }, (_, i) => sub({ rid: `r${i}`, name: `c${i}`, unread: 1 }));
			expect(selectDigestChannels(many)).to.have.lengthOf(MAX_DIGEST_CHANNELS);
			expect(selectDigestChannels(many, 3)).to.have.lengthOf(3);
		});

		it('returns nothing for a zero or negative limit rather than throwing', () => {
			const many = Array.from({ length: 5 }, (_, i) => sub({ rid: `r${i}`, unread: 1 }));
			expect(selectDigestChannels(many, 0)).to.deep.equal([]);
			expect(selectDigestChannels(many, -1)).to.deep.equal([]);
		});

		it('handles an empty list', () => {
			expect(selectDigestChannels([])).to.deep.equal([]);
		});
	});

	describe('digestTotals', () => {
		it('sums unread and mentions across channels', () => {
			expect(digestTotals([channel({ unread: 3, mentions: 1 }), channel({ unread: 4, mentions: 2 })])).to.deep.equal({
				conversations: 2,
				unread: 7,
				mentions: 3,
			});
		});

		it('is all zeroes for an empty digest', () => {
			expect(digestTotals([])).to.deep.equal({ conversations: 0, unread: 0, mentions: 0 });
		});
	});

	describe('renderDigestText', () => {
		it('says so plainly when there is nothing unread', () => {
			expect(renderDigestText([], 'https://x.io')).to.equal('Nothing unread.');
		});

		it('leads with a total line and pluralizes correctly', () => {
			const single = renderDigestText([channel({ unread: 1, messages: [{ id: 'm', username: 'jo', text: 'hi', ts: new Date() }] })], 'https://x.io');
			expect(single.split('\n')[0]).to.equal('1 unread message across 1 conversation.');
		});

		it('mentions the mention count when there is one', () => {
			const text = renderDigestText([channel({ unread: 2, mentions: 1, messages: [{ id: 'm', username: 'jo', text: 'hi', ts: new Date() }] })], 'https://x.io');
			expect(text.split('\n')[0]).to.contain('including 1 direct mention');
		});

		it('includes a jump link per message', () => {
			const text = renderDigestText(
				[channel({ label: '#general', name: 'general', roomType: 'c', messages: [{ id: 'abc', username: 'jo', text: 'the hearing moved', ts: new Date() }] })],
				'https://x.io',
			);
			expect(text).to.contain('jo: the hearing moved');
			expect(text).to.contain('[jump](https://x.io/channel/general?msg=abc)');
		});

		it('links by routing name, not by the display label', () => {
			// A firm room displays "Smith & Associates" but routes as the slug.
			const text = renderDigestText(
				[
					channel({
						label: '#Smith & Associates',
						name: 'smith-associates',
						messages: [{ id: 'abc', username: 'jo', text: 'hi', ts: new Date() }],
					}),
				],
				'https://x.io',
			);
			expect(text).to.contain('[jump](https://x.io/channel/smith-associates?msg=abc)');
		});

		it('collapses newlines inside a message so one message stays one line', () => {
			const text = renderDigestText(
				[channel({ messages: [{ id: 'm', username: 'jo', text: 'line one\nline two\n\nline three', ts: new Date() }] })],
				'https://x.io',
			);
			const messageLines = text.split('\n').filter((l) => l.startsWith('  - '));
			expect(messageLines).to.have.lengthOf(1);
			expect(messageLines[0]).to.contain('line one line two line three');
		});

		it('reports how many earlier messages were left out', () => {
			const text = renderDigestText(
				[channel({ omitted: 12, messages: [{ id: 'm', username: 'jo', text: 'hi', ts: new Date() }] })],
				'https://x.io',
			);
			expect(text).to.contain('…and 12 earlier messages');
		});

		it('explains an empty channel instead of rendering a bare heading', () => {
			const text = renderDigestText([channel({ unread: 3, messages: [] })], 'https://x.io');
			expect(text).to.contain('no readable messages');
		});

		it('omits the link when no site URL is configured, keeping the line readable', () => {
			const text = renderDigestText([channel({ messages: [{ id: 'abc', username: 'jo', text: 'hi', ts: new Date() }] })], '');
			expect(text).to.contain('jo: hi');
			expect(text).to.not.contain('[jump]');
		});
	});
});
