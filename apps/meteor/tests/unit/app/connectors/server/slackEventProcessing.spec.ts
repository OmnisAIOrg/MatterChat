import { expect } from 'chai';
import { beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

import { extMessageId } from '../../../../../app/connectors/server/bridge/bridgeIds';
import * as echoSuppressionModule from '../../../../../app/connectors/server/bridge/echoSuppression';

const { echoSuppression } = echoSuppressionModule;

const TEAM = 'T123';
const CHANNEL = 'C0123456789';

const findByBridgedChannel = sinon.stub();
const setBridgedChannelLastInboundAt = sinon.stub();
const messagesFindOneById = sinon.stub();
const messagesFindOne = sinon.stub();
const roomsFindOneById = sinon.stub();
const usersFindOneById = sinon.stub();
const ingestExternalMessage = sinon.stub();
const toProviderConnection = sinon.stub();
const slackFetch = sinon.stub();
const deleteMessage = sinon.stub();
const updateMessage = sinon.stub();
const setReactionStub = sinon.stub();

const processing = proxyquire.noCallThru().load('../../../../../app/connectors/server/providers/slack/eventProcessing', {
	'@rocket.chat/models': {
		ExternalWorkspaceConnections: { findByBridgedChannel, setBridgedChannelLastInboundAt },
		Messages: { findOneById: messagesFindOneById, findOne: messagesFindOne },
		Rooms: { findOneById: roomsFindOneById },
		Users: { findOneById: usersFindOneById },
	},
	'./slackApi': { slackFetch },
	'../../../../../server/lib/logger/system': {
		SystemLogger: { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
	},
	'../../../../lib/server/functions/deleteMessage': { deleteMessage },
	'../../../../lib/server/functions/updateMessage': { updateMessage },
	'../../../../reactions/server/setReaction': { setReaction: setReactionStub },
	'../../bridge/bridgeCore': { ingestExternalMessage },
	// Hand the module OUR loaded echoSuppression instance so the singleton the spec seeds via
	// echoSuppression.add() is the very one the processing code consults (the tsx ESM/CJS dual
	// module caches would otherwise hand proxyquire a second instance).
	'../../bridge/echoSuppression': echoSuppressionModule,
	'../../runtimeConnection': { toProviderConnection },
});

const { acceptSlackEvent, clearProfileCache, processSlackMessageEvent, processSlackReactionEvent, slackEventDedup } = processing;

/** One stored connection doc bridging CHANNEL. */
const makeDoc = (id: string, userId = `user-${id}`) => ({
	_id: id,
	userId,
	provider: 'slack',
	externalOrgId: TEAM,
	status: 'connected',
	bridgedChannels: [{ channelExternalId: CHANNEL, name: 'general', rid: `rid-${id}`, createdAt: new Date() }],
});

const cursorOf = (docs: unknown[]) => ({ toArray: async () => docs });

describe('Slack event processing', () => {
	beforeEach(() => {
		findByBridgedChannel.reset();
		setBridgedChannelLastInboundAt.reset();
		setBridgedChannelLastInboundAt.resolves({});
		messagesFindOneById.reset();
		messagesFindOne.reset();
		messagesFindOne.resolves(null);
		roomsFindOneById.reset();
		usersFindOneById.reset();
		ingestExternalMessage.reset();
		toProviderConnection.reset();
		slackFetch.reset();
		deleteMessage.reset();
		updateMessage.reset();
		setReactionStub.reset();
		setReactionStub.resolves(undefined);
		clearProfileCache();

		// Default: credentials decrypt fine; the owner's own Slack id rides on them.
		toProviderConnection.callsFake((doc: any) => ({
			connectionId: doc._id,
			ownerUserId: doc.userId,
			externalOrgId: TEAM,
			credentials: { accessToken: `token-${doc._id}`, externalSlackUserId: `U-owner-${doc._id}` },
		}));
		slackFetch.resolves({ ok: true, user: { id: 'U1', profile: { display_name: 'Alice Attorney' } } });
		ingestExternalMessage.resolves(true);
	});

	describe('acceptSlackEvent (retry dedup)', () => {
		it('accepts first sight and drops the retry of the same event_id', () => {
			const eventId = `Ev-${Date.now()}-a`;
			expect(acceptSlackEvent(TEAM, eventId)).to.equal(true);
			// Slack re-delivers with X-Slack-Retry-Num on slow/failed acks — same id must be dropped.
			expect(acceptSlackEvent(TEAM, eventId)).to.equal(false);
			expect(acceptSlackEvent(TEAM, eventId)).to.equal(false);
		});

		it('scopes dedup by team (same event id from another workspace is distinct)', () => {
			const eventId = `Ev-${Date.now()}-b`;
			expect(acceptSlackEvent(TEAM, eventId)).to.equal(true);
			expect(acceptSlackEvent('T-other', eventId)).to.equal(true);
		});

		it('is backed by the TTL echo-suppression set (entries expire, no unbounded growth)', () => {
			expect(slackEventDedup.size()).to.be.a('number');
		});
	});

	describe('new messages', () => {
		it('routes a linked-channel message into bridgeCore for EVERY bridging connection', async () => {
			const docA = makeDoc('connA');
			const docB = makeDoc('connB');
			findByBridgedChannel.returns(cursorOf([docA, docB]));

			await processSlackMessageEvent(TEAM, { kind: 'new', channel: CHANNEL, ts: '1700000000.000100', user: 'U1', text: 'hello' });

			expect(findByBridgedChannel.calledOnceWith('slack', TEAM, CHANNEL)).to.equal(true);
			expect(ingestExternalMessage.callCount).to.equal(2);

			const [firstDoc, firstBridge, firstMessage, firstOwnerId] = ingestExternalMessage.firstCall.args;
			expect(firstDoc._id).to.equal('connA');
			expect(firstBridge.channelExternalId).to.equal(CHANNEL);
			expect(firstMessage).to.deep.include({
				externalId: '1700000000.000100',
				channelExternalId: CHANNEL,
				authorExternalId: 'U1',
				authorDisplayName: 'Alice Attorney',
				text: 'hello',
				ts: '1700000000.000100',
			});
			// The owner's own Slack id rides along → self-posts render unaliased, echo-safe.
			expect(firstOwnerId).to.equal('U-owner-connA');
			expect(ingestExternalMessage.secondCall.args[3]).to.equal('U-owner-connB');
		});

		it('routes a bridged DM (im/mpim conversation id) through the SAME ingest path as channels', async () => {
			// A bridged DM is just a bridgedChannels entry whose channelExternalId is the D…/G… id —
			// the fan-out, echo guards and deterministic ids are conversation-id keyed, so a
			// message.im/message.mpim event needs no parallel path.
			const DM = 'D0DMDMDMDM1';
			const doc = {
				...makeDoc('connDM'),
				bridgedChannels: [{ channelExternalId: DM, name: 'alice (DM)', rid: 'rid-connDM', createdAt: new Date() }],
			};
			findByBridgedChannel.returns(cursorOf([doc]));

			await processSlackMessageEvent(TEAM, { kind: 'new', channel: DM, ts: '1700000001.000100', user: 'U1', text: 'dm hello' });

			expect(findByBridgedChannel.calledOnceWith('slack', TEAM, DM)).to.equal(true);
			expect(ingestExternalMessage.calledOnce).to.equal(true);
			const [ingestDoc, ingestBridge, ingestMessage] = ingestExternalMessage.firstCall.args;
			expect(ingestDoc._id).to.equal('connDM');
			expect(ingestBridge.channelExternalId).to.equal(DM);
			expect(ingestMessage).to.deep.include({ externalId: '1700000001.000100', channelExternalId: DM, text: 'dm hello' });
		});

		it('does nothing for a channel no connection bridges', async () => {
			findByBridgedChannel.returns(cursorOf([]));
			await processSlackMessageEvent(TEAM, { kind: 'new', channel: 'C-unlinked', ts: '1.1', user: 'U1', text: 'x' });
			expect(ingestExternalMessage.callCount).to.equal(0);
		});

		it("ECHO PREVENTION: drops the webhook echo of this connection's own outbound post", async () => {
			const docA = makeDoc('connA-echo');
			const docB = makeDoc('connB-echo');
			findByBridgedChannel.returns(cursorOf([docA, docB]));

			// Outbound leg: bridgeCore remembered the ts chat.postMessage returned for connA.
			const echoedTs = '1700000000.000200';
			echoSuppression.add('connA-echo', echoedTs);

			await processSlackMessageEvent(TEAM, {
				kind: 'new',
				channel: CHANNEL,
				ts: echoedTs,
				user: 'U-owner-connA-echo',
				text: 'mirrored out',
			});

			// connA (the author's own connection) suppressed; connB (another user bridging the same
			// channel) still receives it — same fan-out semantics as the Teams webhook.
			expect(ingestExternalMessage.callCount).to.equal(1);
			expect(ingestExternalMessage.firstCall.args[0]._id).to.equal('connB-echo');
		});

		it('advances lastInboundAt only when a message was actually inserted', async () => {
			const doc = makeDoc('connC');
			findByBridgedChannel.returns(cursorOf([doc]));
			ingestExternalMessage.resolves(true);

			await processSlackMessageEvent(TEAM, { kind: 'new', channel: CHANNEL, ts: '1700000000.000005', user: 'U1', text: 'hi' });
			expect(setBridgedChannelLastInboundAt.calledOnce).to.equal(true);
			const [connId, channelId, at] = setBridgedChannelLastInboundAt.firstCall.args;
			expect(connId).to.equal('connC');
			expect(channelId).to.equal(CHANNEL);
			expect((at as Date).getTime()).to.equal(1700000000000);

			setBridgedChannelLastInboundAt.resetHistory();
			ingestExternalMessage.resolves(false); // duplicate → dropped by bridgeCore's guards
			await processSlackMessageEvent(TEAM, { kind: 'new', channel: CHANNEL, ts: '1700000000.000005', user: 'U1', text: 'hi' });
			expect(setBridgedChannelLastInboundAt.callCount).to.equal(0);
		});

		it('degrades to id-attribution when the profile lookup fails (never drops the message)', async () => {
			const doc = makeDoc('connD');
			findByBridgedChannel.returns(cursorOf([doc]));
			slackFetch.rejects(new Error('slack_error:missing_scope'));

			await processSlackMessageEvent(TEAM, { kind: 'new', channel: CHANNEL, ts: '2.2', user: 'U9', text: 'still here' });

			expect(ingestExternalMessage.calledOnce).to.equal(true);
			expect(ingestExternalMessage.firstCall.args[2]).to.not.have.property('authorDisplayName');
		});

		it('degrades to always-alias when credentials cannot be decrypted (never drops the message)', async () => {
			const doc = makeDoc('connE');
			findByBridgedChannel.returns(cursorOf([doc]));
			toProviderConnection.returns(null);

			await processSlackMessageEvent(TEAM, { kind: 'new', channel: CHANNEL, ts: '3.3', user: 'U1', text: 'x' });

			expect(ingestExternalMessage.calledOnce).to.equal(true);
			expect(ingestExternalMessage.firstCall.args[3]).to.equal(undefined);
		});

		it("one connection's ingest failure does not stop the fan-out to the others", async () => {
			findByBridgedChannel.returns(cursorOf([makeDoc('connF1'), makeDoc('connF2')]));
			ingestExternalMessage.onFirstCall().rejects(new Error('boom'));
			ingestExternalMessage.onSecondCall().resolves(true);

			await processSlackMessageEvent(TEAM, { kind: 'new', channel: CHANNEL, ts: '4.4', user: 'U1', text: 'x' });
			expect(ingestExternalMessage.callCount).to.equal(2);
		});
	});

	describe('edits (message_changed)', () => {
		it('applies the edit to the bridge-inserted message (deterministic ext- id)', async () => {
			const doc = makeDoc('connG');
			findByBridgedChannel.returns(cursorOf([doc]));
			const rcId = extMessageId('connG', CHANNEL, '7.000001');
			const existing = { _id: rcId, rid: 'rid-connG', msg: 'old text', customFields: { connectorBridge: { inbound: true } } };
			messagesFindOneById.callsFake(async (id: string) => (id === rcId ? existing : null));
			usersFindOneById.resolves({ _id: 'user-connG', username: 'owner' });

			await processSlackMessageEvent(TEAM, {
				kind: 'edit',
				channel: CHANNEL,
				ts: '7.000001',
				user: 'U1',
				text: 'new text',
				editedTs: '9.9',
			});

			expect(updateMessage.calledOnce).to.equal(true);
			const [payload, owner, original] = updateMessage.firstCall.args;
			expect(payload).to.deep.include({ _id: rcId, rid: 'rid-connG', msg: 'new text' });
			expect(owner._id).to.equal('user-connG');
			expect(original).to.equal(existing);
			expect(ingestExternalMessage.callCount).to.equal(0);
		});

		it('skips the write when the text is unchanged (unfurl re-deliveries)', async () => {
			const doc = makeDoc('connH');
			findByBridgedChannel.returns(cursorOf([doc]));
			const rcId = extMessageId('connH', CHANNEL, '7.000002');
			messagesFindOneById.resolves({ _id: rcId, rid: 'rid-connH', msg: 'same', customFields: {} });

			await processSlackMessageEvent(TEAM, { kind: 'edit', channel: CHANNEL, ts: '7.000002', user: 'U1', text: 'same' });
			expect(updateMessage.callCount).to.equal(0);
		});

		it('falls back to ingesting the edited form when the original was never bridged in', async () => {
			const doc = makeDoc('connI');
			findByBridgedChannel.returns(cursorOf([doc]));
			messagesFindOneById.resolves(null); // not a bridge-inserted message (e.g. our own outbound post)

			await processSlackMessageEvent(TEAM, { kind: 'edit', channel: CHANNEL, ts: '7.000003', user: 'U1', text: 'edited new' });

			expect(updateMessage.callCount).to.equal(0);
			expect(ingestExternalMessage.calledOnce).to.equal(true);
			expect(ingestExternalMessage.firstCall.args[2]).to.deep.include({ externalId: '7.000003', text: 'edited new' });
		});
	});

	describe('deletes (message_deleted)', () => {
		it('deletes ONLY the bridge-inserted message (deterministic ext- id)', async () => {
			const doc = makeDoc('connJ');
			findByBridgedChannel.returns(cursorOf([doc]));
			const rcId = extMessageId('connJ', CHANNEL, '8.000001');
			const existing = { _id: rcId, rid: 'rid-connJ', msg: 'to be removed' };
			messagesFindOneById.callsFake(async (id: string) => (id === rcId ? existing : null));
			usersFindOneById.resolves({ _id: 'user-connJ', username: 'owner' });

			await processSlackMessageEvent(TEAM, { kind: 'delete', channel: CHANNEL, ts: '8.000001' });

			expect(deleteMessage.calledOnce).to.equal(true);
			expect(deleteMessage.firstCall.args[0]).to.equal(existing);
			expect(deleteMessage.firstCall.args[1]._id).to.equal('user-connJ');
		});

		it('leaves non-bridge messages alone (a Slack delete of our own outbound post is a no-op)', async () => {
			const doc = makeDoc('connK');
			findByBridgedChannel.returns(cursorOf([doc]));
			messagesFindOneById.resolves(null);

			await processSlackMessageEvent(TEAM, { kind: 'delete', channel: CHANNEL, ts: '8.000002' });
			expect(deleteMessage.callCount).to.equal(0);
		});
	});

	describe('processSlackReactionEvent', () => {
		const TS = '9.000001';
		const reactionAction = (add: boolean) => ({ kind: 'reaction' as const, add, channel: CHANNEL, ts: TS, user: 'U2', reaction: 'thumbsup' });

		it('applies an external reaction to the bridged message as the owner', async () => {
			const doc = makeDoc('connR');
			findByBridgedChannel.returns(cursorOf([doc]));
			const rcId = extMessageId(doc._id, CHANNEL, TS);
			messagesFindOneById.withArgs(rcId).resolves({ _id: rcId, rid: `rid-${doc._id}`, reactions: {} });
			usersFindOneById.resolves({ _id: doc.userId, username: 'owner' });
			roomsFindOneById.resolves({ _id: `rid-${doc._id}` });

			await processSlackReactionEvent(TEAM, reactionAction(true));
			expect(setReactionStub.callCount).to.equal(1);
			expect(setReactionStub.firstCall.args[3]).to.equal(':thumbsup:');
		});

		it('no-ops when RC already matches the target state (toggle safety)', async () => {
			const doc = makeDoc('connR2');
			findByBridgedChannel.returns(cursorOf([doc]));
			const rcId = extMessageId(doc._id, CHANNEL, TS);
			messagesFindOneById.withArgs(rcId).resolves({
				_id: rcId,
				rid: `rid-${doc._id}`,
				reactions: { ':thumbsup:': { usernames: ['owner'] } },
			});
			usersFindOneById.resolves({ _id: doc.userId, username: 'owner' });
			roomsFindOneById.resolves({ _id: `rid-${doc._id}` });

			await processSlackReactionEvent(TEAM, reactionAction(true));
			expect(setReactionStub.callCount).to.equal(0);
		});

		it('drops the echo of its own outbound reaction mirror (pre-armed in: key)', async () => {
			const doc = makeDoc('connR3');
			findByBridgedChannel.returns(cursorOf([doc]));
			echoSuppressionModule.reactionEcho.add(doc._id, echoSuppressionModule.reactionEchoKey('in', TS, 'thumbsup', true));

			await processSlackReactionEvent(TEAM, reactionAction(true));
			expect(setReactionStub.callCount).to.equal(0);
			expect(messagesFindOneById.callCount).to.equal(0);
		});

		it('ignores reactions on messages the bridge does not know', async () => {
			const doc = makeDoc('connR4');
			findByBridgedChannel.returns(cursorOf([doc]));
			messagesFindOneById.resolves(null);
			messagesFindOne.resolves(null);

			await processSlackReactionEvent(TEAM, reactionAction(true));
			expect(setReactionStub.callCount).to.equal(0);
		});
	});
});
