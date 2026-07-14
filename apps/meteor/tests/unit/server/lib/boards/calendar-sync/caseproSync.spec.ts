import type { IBoardCard, ICardCalendarSync } from '@rocket.chat/core-typings';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

/**
 * CasePro-preferred sync routing unit tests. Verifies the outbound decision table (create/update/delete/
 * noop) is applied and routed to the CasePro bridge, and the correlation is recorded under the
 * `casepro:<subject>` sentinel connection id (never colliding with a standalone connection). Mocks the
 * models + settings so no Meteor/Mongo/network is touched.
 */

const upsertCalendarSync = sinon.stub().resolves();
const removeCalendarSync = sinon.stub().resolves();
const settingsGet = sinon.stub();

const { pushCardThroughCasePro, caseProConnectionId } = proxyquire.noCallThru().load(
	'../../../../../../server/lib/boards/calendar-sync/caseproSync.ts',
	{
		'@rocket.chat/models': {
			BoardsCards: {
				upsertCalendarSync,
				removeCalendarSync,
				findAssignedDueBetween: () => ({ toArray: async () => [] }),
				findByCalendarConnection: () => ({ toArray: async () => [] }),
				findOneByCalendarEvent: async () => null,
				setDueDate: sinon.stub().resolves(),
			},
		},
		'../../../../app/settings/server': { settings: { get: settingsGet } },
		'../../logger/system': { SystemLogger: { warn: sinon.stub(), debug: sinon.stub() } },
	},
);

const SUBJECT = 'omnis-sub-1';
const CONN_ID = caseProConnectionId(SUBJECT);

/** A minimal fake bridge capturing the CasePro calls. */
function makeBridge() {
	return {
		subject: SUBJECT,
		createEvent: sinon.stub().resolves('casepro-row-1'),
		updateEvent: sinon.stub().resolves(),
		deleteEvent: sinon.stub().resolves(),
		listEvents: sinon.stub().resolves([]),
	};
}

const baseCard = (over: Partial<IBoardCard> = {}): IBoardCard =>
	({
		_id: 'card1',
		boardId: 'board1',
		listId: 'list1',
		title: 'File the motion',
		description: 'due soon',
		assignees: ['u1'],
		cardType: 'task',
		calendarSync: [],
		...over,
	}) as unknown as IBoardCard;

const mirror = (over: Partial<ICardCalendarSync> = {}): ICardCalendarSync => ({
	connectionId: CONN_ID,
	userId: 'u1',
	externalEventId: 'casepro-row-1',
	externalCalendarId: 'casepro',
	lastPushedDueDate: new Date('2026-06-01T10:00:00Z'),
	syncedAt: new Date(),
	...over,
});

describe('caseproSync — CasePro-preferred routing', () => {
	beforeEach(() => {
		upsertCalendarSync.resetHistory();
		removeCalendarSync.resetHistory();
		settingsGet.reset();
		settingsGet.returns('https://matterchat.example');
	});

	it('namespaces the connection id under casepro:<subject>', () => {
		expect(CONN_ID).to.equal('casepro:omnis-sub-1');
	});

	it('CREATE: a due card with no mirror creates a CasePro event and records the row id', async () => {
		const bridge = makeBridge();
		const card = baseCard({ dueDate: new Date('2026-06-01T10:00:00Z'), calendarSync: [] });

		await pushCardThroughCasePro(card, 'u1', bridge);

		expect(bridge.createEvent.calledOnce).to.equal(true);
		expect(bridge.updateEvent.called).to.equal(false);
		expect(bridge.deleteEvent.called).to.equal(false);
		const sync = upsertCalendarSync.firstCall.args[1] as ICardCalendarSync;
		expect(sync.connectionId).to.equal(CONN_ID);
		expect(sync.externalEventId).to.equal('casepro-row-1');
		expect(sync.externalCalendarId).to.equal('casepro');
	});

	it('UPDATE: a due card whose due changed patches the existing CasePro row', async () => {
		const bridge = makeBridge();
		const card = baseCard({
			dueDate: new Date('2026-06-02T10:00:00Z'), // moved from the mirror's 06-01
			calendarSync: [mirror()],
		});

		await pushCardThroughCasePro(card, 'u1', bridge);

		expect(bridge.updateEvent.calledOnceWith('casepro-row-1')).to.equal(true);
		expect(bridge.createEvent.called).to.equal(false);
	});

	it('NOOP: a due card with an unchanged mirror does nothing', async () => {
		const bridge = makeBridge();
		const card = baseCard({
			dueDate: new Date('2026-06-01T10:00:00Z'), // same as the mirror's lastPushedDueDate
			calendarSync: [mirror()],
		});

		await pushCardThroughCasePro(card, 'u1', bridge);

		expect(bridge.createEvent.called).to.equal(false);
		expect(bridge.updateEvent.called).to.equal(false);
		expect(bridge.deleteEvent.called).to.equal(false);
		expect(upsertCalendarSync.called).to.equal(false);
	});

	it('DELETE: a cleared due date with an existing mirror deletes the CasePro event + correlation', async () => {
		const bridge = makeBridge();
		const card = baseCard({ dueDate: undefined, calendarSync: [mirror()] });

		await pushCardThroughCasePro(card, 'u1', bridge);

		expect(bridge.deleteEvent.calledOnceWith('casepro-row-1')).to.equal(true);
		expect(removeCalendarSync.calledOnceWith('card1', CONN_ID)).to.equal(true);
	});
});
