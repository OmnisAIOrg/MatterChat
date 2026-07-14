import type { IBoardCard } from '@rocket.chat/core-typings';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { cardToEvent, decideInboundDueDate, decideOutbound, DUE_BLOCK_MS } from '../../../../../../server/lib/boards/calendar-sync/mapping';

const baseCard = (over: Partial<IBoardCard> = {}): IBoardCard =>
	({
		_id: 'card1',
		boardId: 'board1',
		listId: 'list1',
		title: 'File the motion',
		description: 'due soon',
		position: 1,
		cardType: 'task',
		labels: [],
		assignees: ['u1'],
		watchers: [],
		fieldValues: {},
		checklists: [],
		attachments: [],
		comments: [],
		cardNumber: 1,
		archived: false,
		rev: 0,
		createdBy: 'u1',
		createdAt: new Date(),
		...over,
	}) as IBoardCard;

describe('calendar-sync mapping', () => {
	describe('cardToEvent', () => {
		it('returns null when the card has no due date', () => {
			expect(cardToEvent(baseCard({ dueDate: undefined }))).to.equal(null);
		});

		it('maps a due-dated card to a 1-hour event block', () => {
			const due = new Date('2026-08-01T15:00:00.000Z');
			const ev = cardToEvent(baseCard({ dueDate: due }));
			expect(ev).to.not.equal(null);
			expect(ev!.title).to.equal('File the motion');
			expect(ev!.start.getTime()).to.equal(due.getTime());
			expect(ev!.end.getTime()).to.equal(due.getTime() + DUE_BLOCK_MS);
		});

		it('emits a deep link when a siteUrl is provided', () => {
			const ev = cardToEvent(baseCard({ dueDate: new Date('2026-08-01T15:00:00Z') }), 'https://mc.example.com/');
			expect(ev!.sourceUrl).to.equal('https://mc.example.com/admin/boards/board1?card=card1');
		});

		it('falls back to a title for a blank card title', () => {
			const ev = cardToEvent(baseCard({ title: '   ', dueDate: new Date('2026-08-01T15:00:00Z') }));
			expect(ev!.title).to.equal('Untitled card');
		});
	});

	describe('decideOutbound', () => {
		const due = new Date('2026-08-01T15:00:00Z');

		it('noop: no due date, no existing mirror', () => {
			expect(decideOutbound({ dueDate: undefined }, undefined)).to.equal('noop');
		});
		it('delete: no due date but a mirror exists', () => {
			expect(decideOutbound({ dueDate: undefined }, { externalEventId: 'e1' })).to.equal('delete');
		});
		it('create: due date, no mirror', () => {
			expect(decideOutbound({ dueDate: due }, undefined)).to.equal('create');
		});
		it('noop: due date unchanged from the last push', () => {
			expect(decideOutbound({ dueDate: due }, { externalEventId: 'e1', lastPushedDueDate: due })).to.equal('noop');
		});
		it('update: due date changed since the last push', () => {
			const moved = new Date('2026-08-02T15:00:00Z');
			expect(decideOutbound({ dueDate: moved }, { externalEventId: 'e1', lastPushedDueDate: due })).to.equal('update');
		});
	});

	describe('decideInboundDueDate', () => {
		const due = new Date('2026-08-01T15:00:00Z');

		it('ignores a cancelled event (never unschedules a deadline)', () => {
			expect(decideInboundDueDate({ dueDate: due }, { start: new Date('2026-09-01T00:00:00Z'), cancelled: true })).to.equal(null);
		});
		it('returns null when the event start matches the current due date', () => {
			expect(decideInboundDueDate({ dueDate: due }, { start: new Date(due) })).to.equal(null);
		});
		it('returns the new start when the event moved', () => {
			const moved = new Date('2026-08-05T09:00:00Z');
			const out = decideInboundDueDate({ dueDate: due }, { start: moved });
			expect(out).to.not.equal(null);
			expect(out!.getTime()).to.equal(moved.getTime());
		});
		it('adopts a start when the card had no due date', () => {
			const moved = new Date('2026-08-05T09:00:00Z');
			expect(decideInboundDueDate({ dueDate: undefined }, { start: moved })!.getTime()).to.equal(moved.getTime());
		});
	});
});
