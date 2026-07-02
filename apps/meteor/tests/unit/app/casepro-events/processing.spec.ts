import { expect } from 'chai';
import { describe, it } from 'mocha';

import { EventMemo, MatterDigestBuffer, formatCaseUpdateMessage, humanizeEntityType, matterLink } from '../../../../app/casepro-events/server/processing';
import type { CaseProEvent } from '../../../../app/casepro-events/server/security';

const event = (overrides: Partial<CaseProEvent> = {}): CaseProEvent => ({
	eventId: 'evt-1',
	entityType: 'matters',
	entityId: 'ent-1',
	matterId: 'matter-42',
	changeType: 'updated',
	changedFields: [],
	organizationId: 'org-1',
	timestamp: '2026-07-01T12:00:00.000Z',
	...overrides,
});

/** Manual scheduler: captures callbacks so tests fire the window deterministically. */
class ManualScheduler {
	public pending: Array<{ fn: () => void; ms: number }> = [];

	schedule = (fn: () => void, ms: number): unknown => {
		this.pending.push({ fn, ms });
		return this.pending.length;
	};

	fireAll(): void {
		const batch = this.pending.splice(0);
		for (const { fn } of batch) {
			fn();
		}
	}
}

describe('CasePro webhook processing', () => {
	describe('humanizeEntityType', () => {
		it('singularizes and capitalizes known CasePro entity types', () => {
			expect(humanizeEntityType('matters')).to.equal('Matter');
			expect(humanizeEntityType('insurances')).to.equal('Insurance');
			expect(humanizeEntityType('notes')).to.equal('Note');
			expect(humanizeEntityType('medical_providers')).to.equal('Medical provider');
			expect(humanizeEntityType('injuries')).to.equal('Injury');
		});

		it('degrades unknown types by replacing underscores', () => {
			expect(humanizeEntityType('foo_bars')).to.equal('Foo bar');
			expect(humanizeEntityType('status')).to.equal('Status'); // trailing "ss" is not a plural
			expect(humanizeEntityType('')).to.equal('Record');
		});
	});

	describe('formatCaseUpdateMessage', () => {
		it('renders a single event', () => {
			expect(formatCaseUpdateMessage([event({ entityType: 'insurances' })], 'matter-42')).to.equal(
				'Case update: Insurance updated',
			);
		});

		it('lists changed field names (never values) for a single event', () => {
			expect(formatCaseUpdateMessage([event({ entityType: 'insurances', changedFields: ['status', 'phase'] })], 'matter-42')).to.equal(
				'Case update: Insurance updated — fields: status, phase',
			);
		});

		it('renders a digest for multiple events, first-occurrence order with counts', () => {
			const events = [
				event({ entityType: 'insurances', changeType: 'updated' }),
				event({ entityType: 'notes', changeType: 'created' }),
				event({ entityType: 'insurances', changeType: 'updated' }),
			];
			expect(formatCaseUpdateMessage(events, 'matter-42')).to.equal(
				'Case update: 3 changes — insurance updated ×2, note created',
			);
		});

		it('does not list field names in digests', () => {
			const events = [event({ changedFields: ['secret_field'] }), event({ entityType: 'notes', changeType: 'created' })];
			expect(formatCaseUpdateMessage(events, 'matter-42')).to.not.contain('secret_field');
		});

		it('appends a deep link when a web base URL is configured', () => {
			expect(formatCaseUpdateMessage([event()], 'matter-42', 'https://casepro.example.com/')).to.equal(
				'Case update: Matter updated\nhttps://casepro.example.com/matters/matter-42',
			);
		});

		it('posts plain text when no web base URL is configured', () => {
			const text = formatCaseUpdateMessage([event()], 'matter-42', '');
			expect(text).to.equal('Case update: Matter updated');
			expect(text).to.not.contain('http');
		});
	});

	describe('matterLink', () => {
		it('URL-encodes the matter id and trims trailing slashes', () => {
			expect(matterLink('https://casepro.example.com//', 'm/1 2')).to.equal('https://casepro.example.com/matters/m%2F1%202');
			expect(matterLink('   ', 'matter-42')).to.equal(null);
			expect(matterLink('', 'matter-42')).to.equal(null);
		});
	});

	describe('EventMemo (idempotency)', () => {
		it('reports first-seen once, duplicates thereafter inside the TTL', () => {
			let now = 1_000_000;
			const memo = new EventMemo(15 * 60 * 1000, 10, () => now);
			expect(memo.firstSeen('evt-1')).to.equal(true);
			expect(memo.firstSeen('evt-1')).to.equal(false);
			now += 14 * 60 * 1000;
			expect(memo.firstSeen('evt-1')).to.equal(false);
			expect(memo.firstSeen('evt-2')).to.equal(true);
		});

		it('forgets a key after the TTL expires', () => {
			let now = 1_000_000;
			const memo = new EventMemo(15 * 60 * 1000, 10, () => now);
			expect(memo.firstSeen('evt-1')).to.equal(true);
			now += 15 * 60 * 1000 + 1;
			expect(memo.firstSeen('evt-1')).to.equal(true);
		});

		it('evicts oldest entries at the cap instead of growing unbounded', () => {
			const now = 1_000_000;
			const memo = new EventMemo(15 * 60 * 1000, 3, () => now);
			expect(memo.firstSeen('a')).to.equal(true);
			expect(memo.firstSeen('b')).to.equal(true);
			expect(memo.firstSeen('c')).to.equal(true);
			expect(memo.firstSeen('d')).to.equal(true); // evicts 'a'
			expect(memo.firstSeen('a')).to.equal(true); // 'a' was forgotten
			expect(memo.firstSeen('d')).to.equal(false); // 'd' still remembered
		});
	});

	describe('MatterDigestBuffer (burst collapse)', () => {
		it('collapses multiple events inside one window into a single flush', () => {
			const flushes: Array<{ matterId: string; events: CaseProEvent[] }> = [];
			const scheduler = new ManualScheduler();
			const buffer = new MatterDigestBuffer((matterId, events) => {
				flushes.push({ matterId, events });
			}, 60_000, scheduler.schedule);

			buffer.add(event({ eventId: 'e1', entityType: 'insurances' }), 'matter-42');
			buffer.add(event({ eventId: 'e2', entityType: 'notes', changeType: 'created' }), 'matter-42');
			buffer.add(event({ eventId: 'e3' }), 'matter-42');

			expect(scheduler.pending).to.have.lengthOf(1); // only the FIRST event schedules the window
			expect(scheduler.pending[0].ms).to.equal(60_000);
			expect(flushes).to.have.lengthOf(0); // nothing posts before the window closes

			scheduler.fireAll();
			expect(flushes).to.have.lengthOf(1);
			expect(flushes[0].matterId).to.equal('matter-42');
			expect(flushes[0].events.map((e) => e.eventId)).to.deep.equal(['e1', 'e2', 'e3']);
		});

		it('starts a NEW window (new message) for events after a flush', () => {
			const flushes: CaseProEvent[][] = [];
			const scheduler = new ManualScheduler();
			const buffer = new MatterDigestBuffer((_matterId, events) => {
				flushes.push(events);
			}, 60_000, scheduler.schedule);

			buffer.add(event({ eventId: 'e1' }), 'matter-42');
			scheduler.fireAll();
			buffer.add(event({ eventId: 'e2' }), 'matter-42');
			scheduler.fireAll();

			expect(flushes).to.have.lengthOf(2);
			expect(flushes[0].map((e) => e.eventId)).to.deep.equal(['e1']);
			expect(flushes[1].map((e) => e.eventId)).to.deep.equal(['e2']);
		});

		it('keeps windows separate per matter', () => {
			const flushes: Array<{ matterId: string; count: number }> = [];
			const scheduler = new ManualScheduler();
			const buffer = new MatterDigestBuffer((matterId, events) => {
				flushes.push({ matterId, count: events.length });
			}, 60_000, scheduler.schedule);

			buffer.add(event({ eventId: 'e1' }), 'matter-1');
			buffer.add(event({ eventId: 'e2' }), 'matter-2');
			buffer.add(event({ eventId: 'e3' }), 'matter-1');

			expect(scheduler.pending).to.have.lengthOf(2); // one window per matter
			scheduler.fireAll();
			expect(flushes).to.deep.equal([
				{ matterId: 'matter-1', count: 2 },
				{ matterId: 'matter-2', count: 1 },
			]);
		});

		it('swallows onFlush rejections (never throws out of the timer)', () => {
			const scheduler = new ManualScheduler();
			const buffer = new MatterDigestBuffer(async () => {
				throw new Error('boom');
			}, 60_000, scheduler.schedule);
			buffer.add(event(), 'matter-42');
			expect(() => scheduler.fireAll()).to.not.throw();
		});
	});
});
