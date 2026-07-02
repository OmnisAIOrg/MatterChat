import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	deriveClientState,
	extractLifecycleEvents,
	extractNotifications,
	parseNotificationResource,
	verifyClientState,
} from '../../../../app/connectors/server/providers/teams/webhookSecurity';

const SECRET = 'test-webhook-secret';
const CONNECTION_ID = 'conn123';
const CHANNEL_ID = 'team-guid|19:abc123@thread.tacv2';

describe('Teams webhook security', () => {
	describe('deriveClientState / verifyClientState', () => {
		it('derives a deterministic, secret-dependent clientState', () => {
			const a = deriveClientState(SECRET, CONNECTION_ID, CHANNEL_ID);
			const b = deriveClientState(SECRET, CONNECTION_ID, CHANNEL_ID);
			expect(a).to.equal(b);
			expect(deriveClientState('other-secret', CONNECTION_ID, CHANNEL_ID)).to.not.equal(a);
			expect(deriveClientState(SECRET, 'other-conn', CHANNEL_ID)).to.not.equal(a);
			expect(deriveClientState(SECRET, CONNECTION_ID, 'other-channel')).to.not.equal(a);
		});

		it('throws rather than derives without a secret', () => {
			expect(() => deriveClientState('', CONNECTION_ID, CHANNEL_ID)).to.throw('teams_webhook_secret_missing');
		});

		it('verifies the derived value', () => {
			const state = deriveClientState(SECRET, CONNECTION_ID, CHANNEL_ID);
			expect(verifyClientState(SECRET, state, CONNECTION_ID, CHANNEL_ID)).to.equal(true);
		});

		it('FAILS CLOSED with no secret configured', () => {
			const state = deriveClientState(SECRET, CONNECTION_ID, CHANNEL_ID);
			expect(verifyClientState('', state, CONNECTION_ID, CHANNEL_ID)).to.equal(false);
		});

		it('rejects a missing, non-string, wrong, or oversized clientState', () => {
			const state = deriveClientState(SECRET, CONNECTION_ID, CHANNEL_ID);
			expect(verifyClientState(SECRET, undefined, CONNECTION_ID, CHANNEL_ID)).to.equal(false);
			expect(verifyClientState(SECRET, 42 as unknown as string, CONNECTION_ID, CHANNEL_ID)).to.equal(false);
			expect(verifyClientState(SECRET, '', CONNECTION_ID, CHANNEL_ID)).to.equal(false);
			expect(verifyClientState(SECRET, 'not-the-state', CONNECTION_ID, CHANNEL_ID)).to.equal(false);
			expect(verifyClientState(SECRET, state, 'other-conn', CHANNEL_ID)).to.equal(false);
			expect(verifyClientState(SECRET, state, CONNECTION_ID, 'other-channel')).to.equal(false);
			expect(verifyClientState(SECRET, 'x'.repeat(5000), CONNECTION_ID, CHANNEL_ID)).to.equal(false);
		});
	});

	describe('parseNotificationResource', () => {
		it('parses a channel message resource', () => {
			const parsed = parseNotificationResource("teams('team-guid')/channels('19:abc@thread.tacv2')/messages('1616990032035')");
			expect(parsed).to.deep.equal({
				kind: 'channelMessage',
				teamId: 'team-guid',
				channelId: '19:abc@thread.tacv2',
				messageId: '1616990032035',
			});
		});

		it('parses a threaded reply resource', () => {
			const parsed = parseNotificationResource("teams('t1')/channels('c1')/messages('100')/replies('200')");
			expect(parsed).to.deep.equal({ kind: 'channelMessage', teamId: 't1', channelId: 'c1', messageId: '100', replyId: '200' });
		});

		it('parses a chat message resource', () => {
			const parsed = parseNotificationResource("chats('19:xyz@unq.gbl.spaces')/messages('42')");
			expect(parsed).to.deep.equal({ kind: 'chatMessage', chatId: '19:xyz@unq.gbl.spaces', messageId: '42' });
		});

		it('rejects unknown/malformed/oversized resources (fail closed)', () => {
			expect(parseNotificationResource(undefined)).to.equal(null);
			expect(parseNotificationResource('')).to.equal(null);
			expect(parseNotificationResource('users/123/messages/1')).to.equal(null);
			expect(parseNotificationResource("teams('t1')/channels('c1')")).to.equal(null);
			expect(parseNotificationResource("teams('t1')/channels('c1')/messages('1')/extra('x')")).to.equal(null);
			// A quote can't be smuggled through the quoted-segment character class.
			expect(parseNotificationResource("teams('t'1')/channels('c1')/messages('1')")).to.equal(null);
			expect(parseNotificationResource(`teams('${'x'.repeat(3000)}')/channels('c')/messages('1')`)).to.equal(null);
		});
	});

	describe('extractNotifications', () => {
		it('extracts well-formed items and drops malformed ones', () => {
			const body = {
				value: [
					{ subscriptionId: 'sub1', clientState: 'cs', changeType: 'created', resource: "teams('t')/channels('c')/messages('1')" },
					{ subscriptionId: 'sub2', changeType: 'updated', resource: "chats('x')/messages('2')" },
					{ subscriptionId: '', changeType: 'created', resource: 'r' }, // empty id
					{ subscriptionId: 'sub3', changeType: 42, resource: 'r' }, // wrong type
					{ subscriptionId: 'sub4', changeType: 'created' }, // no resource
					'garbage',
					null,
				],
			};
			const items = extractNotifications(body);
			expect(items).to.have.length(2);
			expect(items[0]).to.deep.include({ subscriptionId: 'sub1', changeType: 'created', clientState: 'cs' });
			expect(items[1].subscriptionId).to.equal('sub2');
			expect(items[1].clientState).to.equal(undefined);
		});

		it('yields nothing for non-object / value-less bodies', () => {
			expect(extractNotifications(undefined)).to.deep.equal([]);
			expect(extractNotifications('str')).to.deep.equal([]);
			expect(extractNotifications({})).to.deep.equal([]);
			expect(extractNotifications({ value: 'nope' })).to.deep.equal([]);
		});
	});

	describe('extractLifecycleEvents', () => {
		it('extracts well-formed lifecycle events', () => {
			const body = {
				value: [
					{ subscriptionId: 'sub1', clientState: 'cs', lifecycleEvent: 'reauthorizationRequired' },
					{ subscriptionId: 'sub2', lifecycleEvent: 'missed' },
					{ subscriptionId: 'sub3' }, // no event
				],
			};
			const events = extractLifecycleEvents(body);
			expect(events).to.have.length(2);
			expect(events[0].lifecycleEvent).to.equal('reauthorizationRequired');
			expect(events[1]).to.deep.equal({ subscriptionId: 'sub2', lifecycleEvent: 'missed' });
		});
	});
});
