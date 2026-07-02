import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	derivePushToken,
	extractGooglePushNotification,
	extractGraphPushNotifications,
	extractValidationToken,
	isGoogleSyncPing,
	shouldRenewPush,
	verifyPushToken,
} from '../../../../../../server/lib/boards/calendar-sync/pushSecurity';

const SECRET = 'test-calendar-push-secret';
const CONNECTION_ID = 'conn123';
const SUB_ID = 'sub-abc-456';

describe('boards calendar push security', () => {
	describe('derivePushToken / verifyPushToken (fail-closed HMAC channel token)', () => {
		it('derives a deterministic, secret+id-dependent token', () => {
			const a = derivePushToken(SECRET, CONNECTION_ID, SUB_ID);
			const b = derivePushToken(SECRET, CONNECTION_ID, SUB_ID);
			expect(a).to.equal(b);
			expect(derivePushToken('other-secret', CONNECTION_ID, SUB_ID)).to.not.equal(a);
			expect(derivePushToken(SECRET, 'other-conn', SUB_ID)).to.not.equal(a);
			expect(derivePushToken(SECRET, CONNECTION_ID, 'other-sub')).to.not.equal(a);
		});

		it('throws rather than derives without a secret', () => {
			expect(() => derivePushToken('', CONNECTION_ID, SUB_ID)).to.throw('boards_calendar_push_secret_missing');
		});

		it('verifies the derived value', () => {
			const token = derivePushToken(SECRET, CONNECTION_ID, SUB_ID);
			expect(verifyPushToken(SECRET, token, CONNECTION_ID, SUB_ID)).to.equal(true);
		});

		it('FAILS CLOSED with no secret configured', () => {
			const token = derivePushToken(SECRET, CONNECTION_ID, SUB_ID);
			expect(verifyPushToken('', token, CONNECTION_ID, SUB_ID)).to.equal(false);
		});

		it('rejects a missing, non-string, wrong, or oversized token', () => {
			const token = derivePushToken(SECRET, CONNECTION_ID, SUB_ID);
			expect(verifyPushToken(SECRET, undefined, CONNECTION_ID, SUB_ID)).to.equal(false);
			expect(verifyPushToken(SECRET, 42 as unknown as string, CONNECTION_ID, SUB_ID)).to.equal(false);
			expect(verifyPushToken(SECRET, '', CONNECTION_ID, SUB_ID)).to.equal(false);
			expect(verifyPushToken(SECRET, 'not-the-token', CONNECTION_ID, SUB_ID)).to.equal(false);
			expect(verifyPushToken(SECRET, token, 'other-conn', SUB_ID)).to.equal(false);
			expect(verifyPushToken(SECRET, token, CONNECTION_ID, 'other-sub')).to.equal(false);
			expect(verifyPushToken(SECRET, 'x'.repeat(5000), CONNECTION_ID, SUB_ID)).to.equal(false);
		});
	});

	describe('extractValidationToken (Graph endpoint-validation handshake)', () => {
		it('returns the token when present', () => {
			const sp = new URLSearchParams({ validationToken: 'hello-graph' });
			expect(extractValidationToken(sp)).to.equal('hello-graph');
		});
		it('returns null when absent', () => {
			expect(extractValidationToken(new URLSearchParams())).to.equal(null);
		});
		it('rejects an oversized token (no giant reflection)', () => {
			const sp = new URLSearchParams({ validationToken: 'x'.repeat(5000) });
			expect(extractValidationToken(sp)).to.equal(null);
		});
	});

	describe('extractGooglePushNotification (header-based signal)', () => {
		it('extracts channel id/token/state/resource from headers', () => {
			const n = extractGooglePushNotification({
				'x-goog-channel-id': SUB_ID,
				'x-goog-channel-token': 'tok',
				'x-goog-resource-state': 'exists',
				'x-goog-resource-id': 'res-1',
			});
			expect(n).to.deep.equal({ subscriptionId: SUB_ID, channelToken: 'tok', resourceState: 'exists', resourceId: 'res-1' });
		});
		it('returns null without the mandatory channel id', () => {
			expect(extractGooglePushNotification({ 'x-goog-resource-state': 'exists' })).to.equal(null);
		});
		it('flags the initial sync ping (which we ack but never reconcile on)', () => {
			const n = extractGooglePushNotification({ 'x-goog-channel-id': SUB_ID, 'x-goog-resource-state': 'sync' })!;
			expect(isGoogleSyncPing(n)).to.equal(true);
			const change = extractGooglePushNotification({ 'x-goog-channel-id': SUB_ID, 'x-goog-resource-state': 'exists' })!;
			expect(isGoogleSyncPing(change)).to.equal(false);
		});
	});

	describe('extractGraphPushNotifications', () => {
		it('extracts well-formed items and drops malformed ones', () => {
			const items = extractGraphPushNotifications({
				value: [
					{ subscriptionId: 'sub1', clientState: 'cs' },
					{ subscriptionId: 'sub2' },
					{ subscriptionId: '' },
					{ subscriptionId: 42 },
					'garbage',
					null,
				],
			});
			expect(items).to.have.length(2);
			expect(items[0]).to.deep.equal({ subscriptionId: 'sub1', clientState: 'cs' });
			expect(items[1]).to.deep.equal({ subscriptionId: 'sub2' });
		});
		it('yields nothing for non-object / value-less bodies', () => {
			expect(extractGraphPushNotifications(undefined)).to.deep.equal([]);
			expect(extractGraphPushNotifications('str')).to.deep.equal([]);
			expect(extractGraphPushNotifications({})).to.deep.equal([]);
			expect(extractGraphPushNotifications({ value: 'nope' })).to.deep.equal([]);
		});
	});

	describe('shouldRenewPush (renew-before-expiry decision)', () => {
		const now = new Date('2026-07-02T12:00:00Z');
		const LEAD = 12 * 60 * 60 * 1000; // 12h

		it('renews when there is no expiry', () => {
			expect(shouldRenewPush(undefined, now, LEAD)).to.equal(true);
		});
		it('renews when expiry is within the lead window', () => {
			const soon = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6h out (< 12h lead)
			expect(shouldRenewPush(soon, now, LEAD)).to.equal(true);
		});
		it('renews when already past expiry', () => {
			const past = new Date(now.getTime() - 60 * 1000);
			expect(shouldRenewPush(past, now, LEAD)).to.equal(true);
		});
		it('does NOT renew when expiry is beyond the lead window', () => {
			const later = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 2 days out
			expect(shouldRenewPush(later, now, LEAD)).to.equal(false);
		});
		it('renews exactly at the lead boundary', () => {
			const boundary = new Date(now.getTime() + LEAD);
			expect(shouldRenewPush(boundary, now, LEAD)).to.equal(true);
		});
	});
});
