import type { IBoardCalendarConnection } from '@rocket.chat/core-typings';
import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

/**
 * Push (webhook) subscription lifecycle unit tests. Verifies:
 *  - create-on-connect calls the provider's createPushSubscription + persists the returned ids/expiry;
 *  - it is a NO-OP (poll fallback) when push is unconfigured — no provider call, no push write;
 *  - the renewal sweep only touches near-expiry connections and PATCHes/re-creates them;
 *  - a webhook notification triggers the SAME inbound reconcile the poll does (pollConnection), debounced.
 * Everything external (models / settings / token envelope / provider / registry) is mocked — no
 * Meteor/Mongo/network is touched.
 */

const setPushSubscriptionById = sinon.stub().resolves();
const findConnectedWithPushExpiringBefore = sinon.stub();
const findOne = sinon.stub();

const isCalendarPushConfigured = sinon.stub();
const pollConnection = sinon.stub().resolves({ updated: 1, created: 0 });

// A provider double whose push methods we assert against.
const provider = {
	createPushSubscription: sinon.stub(),
	renewPushSubscription: sinon.stub(),
	deletePushSubscription: sinon.stub().resolves(),
};

// withFreshToken just runs the fn with a fake token (the real refresh envelope is tested elsewhere).
const withFreshToken = async (_conn: unknown, fn: (t: string) => Promise<unknown>) => fn('fake-access-token');

const mod = proxyquire.noCallThru().load('../../../../../../server/lib/boards/calendar-sync/pushSubscriptions.ts', {
	'@rocket.chat/models': {
		BoardCalendarConnections: {
			setPushSubscriptionById,
			findConnectedWithPushExpiringBefore,
			findOne,
		},
	},
	'@rocket.chat/random': { Random: { id: () => 'new-generated-id' } },
	'./config': {
		getCalendarPushSecret: () => 'the-push-secret',
		googlePushNotificationUrl: () => 'https://mc.example/_boards_calendar/push/google',
		outlookPushNotificationUrl: () => 'https://mc.example/_boards_calendar/push/outlook',
		isCalendarPushConfigured,
	},
	'./registry': { getCalendarProvider: () => provider },
	'./service': { pollConnection },
	'./tokens': { withFreshToken },
	'../../logger/system': { SystemLogger: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() } },
});

const { ensurePushSubscription, renewExpiringPushSubscriptions, dispatchPushReconcile, teardownPushSubscription } = mod;

const conn = (over: Partial<IBoardCalendarConnection> = {}): IBoardCalendarConnection =>
	({
		_id: 'conn1',
		userId: 'u1',
		provider: 'google',
		status: 'connected',
		scopes: [],
		targetCalendarId: 'primary',
		createdAt: new Date(),
		...over,
	}) as unknown as IBoardCalendarConnection;

describe('boards calendar push subscription lifecycle', () => {
	beforeEach(() => {
		setPushSubscriptionById.resetHistory();
		findConnectedWithPushExpiringBefore.reset();
		findOne.reset();
		isCalendarPushConfigured.reset();
		pollConnection.resetHistory();
		provider.createPushSubscription.reset();
		provider.renewPushSubscription.reset();
		provider.deletePushSubscription.resetHistory();
	});

	describe('ensurePushSubscription (create on connect)', () => {
		it('creates a subscription and persists the ids + expiry when push is configured', async () => {
			isCalendarPushConfigured.returns(true);
			const expiresAt = new Date(Date.now() + 6 * 24 * 3600_000);
			provider.createPushSubscription.resolves({ subscriptionId: 'goog-sub-1', resourceId: 'res-9', expiresAt });

			const ok = await ensurePushSubscription(conn());

			expect(ok).to.equal(true);
			expect(provider.createPushSubscription.calledOnce).to.equal(true);
			// It passed our notification URL + a derived channel token + a minted subscription id.
			const [, calendarId, params] = provider.createPushSubscription.firstCall.args;
			expect(calendarId).to.equal('primary');
			expect(params.notificationUrl).to.equal('https://mc.example/_boards_calendar/push/google');
			expect(params.channelToken).to.be.a('string').with.lengthOf.above(0);
			expect(params.subscriptionId).to.equal('new-generated-id');
			// It persisted what the provider returned.
			const [id, push] = setPushSubscriptionById.firstCall.args;
			expect(id).to.equal('conn1');
			expect(push).to.include({ subscriptionId: 'goog-sub-1', resourceId: 'res-9' });
			expect(push.expiresAt).to.equal(expiresAt);
		});

		it('is a NO-OP (poll fallback) when push is unconfigured — no provider call, no write', async () => {
			isCalendarPushConfigured.returns(false);

			const ok = await ensurePushSubscription(conn());

			expect(ok).to.equal(false);
			expect(provider.createPushSubscription.called).to.equal(false);
			expect(setPushSubscriptionById.called).to.equal(false);
		});

		it('swallows a provider failure and returns false (connection stays on the poll)', async () => {
			isCalendarPushConfigured.returns(true);
			provider.createPushSubscription.rejects(new Error('graph_boom'));

			const ok = await ensurePushSubscription(conn());

			expect(ok).to.equal(false);
			expect(setPushSubscriptionById.called).to.equal(false);
		});

		it('does not re-create when a still-fresh subscription already exists', async () => {
			isCalendarPushConfigured.returns(true);
			const farOut = new Date(Date.now() + 5 * 24 * 3600_000); // well beyond the 12h renew lead
			const ok = await ensurePushSubscription(conn({ push: { subscriptionId: 's', expiresAt: farOut, createdAt: new Date() } }));
			expect(ok).to.equal(true);
			expect(provider.createPushSubscription.called).to.equal(false);
		});
	});

	describe('renewExpiringPushSubscriptions (renew before expiry)', () => {
		it('renews a near-expiry subscription and persists the new state', async () => {
			isCalendarPushConfigured.returns(true);
			const soon = new Date(Date.now() + 1 * 3600_000); // 1h out → inside the 12h lead
			const c = conn({ provider: 'outlook', push: { subscriptionId: 'graph-sub', expiresAt: soon, createdAt: new Date() } });
			findConnectedWithPushExpiringBefore.returns({ toArray: async () => [c] });
			const newExpiry = new Date(Date.now() + 2 * 24 * 3600_000);
			provider.renewPushSubscription.resolves({ subscriptionId: 'graph-sub', expiresAt: newExpiry });

			const result = await renewExpiringPushSubscriptions();

			expect(result).to.deep.equal({ renewed: 1, failed: 0 });
			expect(provider.renewPushSubscription.calledOnce).to.equal(true);
			const push = setPushSubscriptionById.lastCall.args[1];
			expect(push.subscriptionId).to.equal('graph-sub');
			expect(push.expiresAt).to.equal(newExpiry);
		});

		it('enumerates nothing (no push traffic) when no connection is due', async () => {
			findConnectedWithPushExpiringBefore.returns({ toArray: async () => [] });
			const result = await renewExpiringPushSubscriptions();
			expect(result).to.deep.equal({ renewed: 0, failed: 0 });
			expect(provider.renewPushSubscription.called).to.equal(false);
		});
	});

	describe('teardownPushSubscription (delete on disconnect)', () => {
		it('deletes the provider subscription and clears the stored push', async () => {
			await teardownPushSubscription(conn({ push: { subscriptionId: 's1', resourceId: 'r1', expiresAt: new Date(), createdAt: new Date() } }));
			expect(provider.deletePushSubscription.calledOnce).to.equal(true);
			expect(setPushSubscriptionById.calledWith('conn1', undefined)).to.equal(true);
		});

		it('is a no-op when there is no push subscription', async () => {
			await teardownPushSubscription(conn());
			expect(provider.deletePushSubscription.called).to.equal(false);
		});
	});

	describe('dispatchPushReconcile (notification -> the SAME reconcile the poll runs, debounced)', () => {
		let clock: sinon.SinonFakeTimers;
		beforeEach(() => {
			clock = sinon.useFakeTimers();
		});
		afterEach(() => {
			clock.restore();
		});

		it('runs pollConnection exactly once for a burst of notifications (debounced)', async () => {
			findOne.resolves(conn());

			dispatchPushReconcile('conn1');
			dispatchPushReconcile('conn1');
			dispatchPushReconcile('conn1');

			// Nothing yet — still inside the debounce window.
			expect(pollConnection.called).to.equal(false);

			await clock.tickAsync(3_500);
			// Let the async IIFE settle.
			await Promise.resolve();

			expect(findOne.calledWith({ _id: 'conn1' })).to.equal(true);
			expect(pollConnection.calledOnce).to.equal(true);
		});

		it('does not reconcile a connection that is no longer connected', async () => {
			findOne.resolves(conn({ status: 'error' }));
			dispatchPushReconcile('conn1');
			await clock.tickAsync(3_500);
			await Promise.resolve();
			expect(pollConnection.called).to.equal(false);
		});
	});
});
