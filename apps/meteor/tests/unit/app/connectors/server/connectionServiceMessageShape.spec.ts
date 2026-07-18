import { expect } from 'chai';
import { beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

const findOneByIdAndUserId = sinon.stub();
const setStatusById = sinon.stub();
const toProviderConnection = sinon.stub();
const postMessage = sinon.stub();
const resolveIdentity = sinon.stub();

const providerStub = { postMessage, resolveIdentity };

// Load the service with Mongo/Meteor/provider plumbing stubbed — the service logic itself runs real.
const service = proxyquire.noCallThru().load('../../../../../app/connectors/server/connectionService', {
	'@rocket.chat/models': {
		ExternalWorkspaceConnections: { findOneByIdAndUserId, setStatusById },
	},
	'meteor/meteor': { Meteor: { absoluteUrl: (path: string) => `https://mc.example/${path}` } },
	'./providerRegistry': { providerRegistry: { get: () => providerStub, has: () => true } },
	'./providers/google/config': { isGoogleConfigured: () => true },
	'./providers/slack/config': { isSlackConfigured: () => true },
	'./providers/teams/config': { isTeamsConfigured: () => true },
	'./runtimeConnection': { toProviderConnection },
	'./tokenCrypto': { isEncryptionConfigured: () => true },
	'../../../server/lib/logger/system': {
		SystemLogger: { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
	},
});

const { clearSelfProfileCache, sendMyMessage, toClientMessage } = service;

const makeDoc = (id: string) => ({
	_id: id,
	userId: 'user-1',
	provider: 'slack',
	externalOrgId: 'T123',
	externalOrgName: 'Slack (Acme)',
	status: 'connected',
	credentials: { ciphertext: 'sealed' },
	_updatedAt: new Date(),
});

describe('connectionService message shapes', () => {
	beforeEach(() => {
		findOneByIdAndUserId.reset();
		setStatusById.reset();
		toProviderConnection.reset();
		postMessage.reset();
		resolveIdentity.reset();
		clearSelfProfileCache();

		toProviderConnection.callsFake((doc: { _id: string; userId: string }) => ({
			connectionId: doc._id,
			ownerUserId: doc.userId,
			externalOrgId: 'T123',
			credentials: { accessToken: 'xoxp-test', externalSlackUserId: 'U-self' },
		}));
	});

	describe('toClientMessage', () => {
		it('threads avatar + mentions through and normalizes the Slack ts', () => {
			expect(
				toClientMessage({
					externalId: '1752700000.000100',
					channelExternalId: 'C1',
					authorExternalId: 'U1',
					authorDisplayName: 'Alice Attorney',
					authorAvatarUrl: 'https://avatars.example/u1-72.png',
					text: 'hi <@U2>',
					ts: '1752700000.000100',
					mentions: { U2: 'Bob Barrister' },
				}),
			).to.deep.equal({
				externalId: '1752700000.000100',
				author: 'Alice Attorney',
				authorAvatarUrl: 'https://avatars.example/u1-72.png',
				text: 'hi <@U2>',
				createdAt: new Date(1752700000000).toISOString(),
				mentions: { U2: 'Bob Barrister' },
			});
		});

		it('falls back to the author id and omits empty enrichment fields', () => {
			expect(
				toClientMessage({
					externalId: '1752700000.000100',
					channelExternalId: 'C1',
					authorExternalId: 'U08DD11QC1F',
					text: 'plain',
					ts: '1752700000.000100',
					mentions: {},
				}),
			).to.deep.equal({
				externalId: '1752700000.000100',
				author: 'U08DD11QC1F',
				text: 'plain',
				createdAt: new Date(1752700000000).toISOString(),
			});
		});
	});

	describe('sendMyMessage instant echo', () => {
		it('returns the created message in ClientMessage shape with the caller as author', async () => {
			findOneByIdAndUserId.resolves(makeDoc('conn-echo-1'));
			postMessage.resolves({ externalId: '1752700002.000100', ts: '1752700002.000100' });
			resolveIdentity.resolves({
				externalId: 'U-self',
				displayName: 'Tina Founder',
				isBot: false,
				avatarUrl: 'https://avatars.example/self-72.png',
			});

			const result = await sendMyMessage('user-1', { connectionId: 'conn-echo-1', channelExternalId: 'C1', text: 'on my way' });

			expect(result).to.not.have.property('error');
			expect(result.externalId).to.equal('1752700002.000100');
			expect(result.message).to.deep.equal({
				externalId: '1752700002.000100',
				author: 'Tina Founder',
				authorAvatarUrl: 'https://avatars.example/self-72.png',
				text: 'on my way',
				createdAt: new Date(1752700002000).toISOString(),
			});
			// The client-safe connection projection rides along, credentials stripped.
			expect(result.connection).to.not.have.property('credentials');
			// Resolved via the connection's OWN external user id.
			expect(resolveIdentity.firstCall.args[1]).to.equal('U-self');
		});

		it('caches the caller profile per connection — one resolveIdentity across sends', async () => {
			findOneByIdAndUserId.resolves(makeDoc('conn-echo-2'));
			postMessage.resolves({ externalId: '1.000100', ts: '1.000100' });
			resolveIdentity.resolves({ externalId: 'U-self', displayName: 'Tina Founder', isBot: false });

			await sendMyMessage('user-1', { connectionId: 'conn-echo-2', channelExternalId: 'C1', text: 'one' });
			await sendMyMessage('user-1', { connectionId: 'conn-echo-2', channelExternalId: 'C1', text: 'two' });

			expect(resolveIdentity.callCount).to.equal(1);
		});

		it('falls back to You + now-ISO when the profile and ts are unavailable', async () => {
			findOneByIdAndUserId.resolves(makeDoc('conn-echo-3'));
			// Provider without a ts echo (e.g. Teams) and an unresolvable identity.
			postMessage.resolves({ externalId: 'graph-message-id' });
			resolveIdentity.resolves(null);

			const before = Date.now();
			const result = await sendMyMessage('user-1', { connectionId: 'conn-echo-3', channelExternalId: 'C1', text: 'hello' });
			const after = Date.now();

			expect(result.message.author).to.equal('You');
			expect(result.message).to.not.have.property('authorAvatarUrl');
			const createdMs = Date.parse(result.message.createdAt);
			expect(createdMs).to.be.at.least(before);
			expect(createdMs).to.be.at.most(after);
		});

		it('never fails the send over a broken identity lookup', async () => {
			findOneByIdAndUserId.resolves(makeDoc('conn-echo-4'));
			postMessage.resolves({ externalId: '2.000100', ts: '2.000100' });
			resolveIdentity.rejects(new Error('slack_error:ratelimited'));

			const result = await sendMyMessage('user-1', { connectionId: 'conn-echo-4', channelExternalId: 'C1', text: 'hello' });
			expect(result).to.not.have.property('error');
			expect(result.message.author).to.equal('You');
		});

		it('still surfaces provider send failures as structured errors', async () => {
			findOneByIdAndUserId.resolves(makeDoc('conn-echo-5'));
			postMessage.rejects(new Error('slack_error:not_in_channel'));

			const result = await sendMyMessage('user-1', { connectionId: 'conn-echo-5', channelExternalId: 'C1', text: 'hello' });
			expect(result.error).to.equal('slack_error');
			expect(result.message).to.contain('not_in_channel');
		});
	});
});
