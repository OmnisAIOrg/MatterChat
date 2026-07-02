import { expect } from 'chai';
import { beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

const stubs = {
	broadcast: sinon.stub(),
	findOneRoomById: sinon.stub(),
	findOneUserById: sinon.stub(),
	hasPermissionAsync: sinon.stub(),
	sendMessage: sinon.stub(),
	updateMessage: sinon.stub(),
	getChiBotUser: sinon.stub(),
	askChi: sinon.stub(),
	isChiConfigured: sinon.stub(),
};

const { handleChiQuestion, formatChiAnswer, formatChiFailure } = proxyquire.noCallThru().load('../../../../../server/lib/chi/service.ts', {
	'@rocket.chat/core-services': { api: { broadcast: stubs.broadcast } },
	'@rocket.chat/models': {
		Rooms: { findOneById: stubs.findOneRoomById },
		Users: { findOneById: stubs.findOneUserById },
	},
	'../../../app/authorization/server/functions/hasPermission': { hasPermissionAsync: stubs.hasPermissionAsync },
	'../../../app/lib/server/functions/sendMessage': { sendMessage: stubs.sendMessage },
	'../../../app/lib/server/functions/updateMessage': { updateMessage: stubs.updateMessage },
	'./bot': { getChiBotUser: stubs.getChiBotUser },
	'./client': { askChi: stubs.askChi },
	'./config': { isChiConfigured: stubs.isChiConfigured },
});

const BOT = { _id: 'chi.bot', username: 'chi.bot' };
const ROOM = { _id: 'rid1', name: 'smith-v-jones', fname: 'Smith v Jones', matterId: 'matter-123' };
const PLACEHOLDER = { _id: 'msg1', rid: 'rid1', msg: 'thinking' };

/** The ephemeral text of the nth broadcast call. */
const ephemeralMsg = (call = 0): string => stubs.broadcast.getCall(call).args[3].msg;

describe('chi/service — /chi orchestration', () => {
	beforeEach(() => {
		Object.values(stubs).forEach((stub) => stub.reset());
		stubs.hasPermissionAsync.resolves(true);
		stubs.isChiConfigured.returns(true);
		stubs.findOneRoomById.resolves(ROOM);
		stubs.findOneUserById.resolves({ _id: 'u1', username: 'phillip' });
		stubs.getChiBotUser.resolves(BOT);
		stubs.sendMessage.resolves(PLACEHOLDER);
		stubs.updateMessage.resolves();
		stubs.askChi.resolves({ ok: true, text: 'Treatment is ongoing.' });
	});

	it('replies with usage (ephemeral, nothing posted) on an empty question', async () => {
		await handleChiQuestion('u1', 'rid1', '   ');
		expect(stubs.broadcast.calledOnce).to.be.true;
		expect(ephemeralMsg()).to.include('Usage: /chi');
		expect(stubs.sendMessage.called).to.be.false;
		expect(stubs.askChi.called).to.be.false;
	});

	it('refuses without the chi-use permission (ephemeral only)', async () => {
		stubs.hasPermissionAsync.resolves(false);
		await handleChiQuestion('u1', 'rid1', 'question');
		expect(stubs.hasPermissionAsync.calledWith('u1', 'chi-use')).to.be.true;
		expect(ephemeralMsg()).to.include('permission');
		expect(stubs.sendMessage.called).to.be.false;
	});

	it('replies "CHI is not configured" when env is unset (unconfigured behavior)', async () => {
		stubs.isChiConfigured.returns(false);
		await handleChiQuestion('u1', 'rid1', 'question');
		expect(ephemeralMsg()).to.include('CHI is not configured');
		expect(stubs.sendMessage.called).to.be.false;
		expect(stubs.askChi.called).to.be.false;
	});

	it('happy path: posts the placeholder as the Chi bot, asks with room context, edits in the answer', async () => {
		await handleChiQuestion('u1', 'rid1', 'how is treatment going?');

		// Placeholder posted immediately as the bot.
		const [botArg, placeholderMsg, roomArg] = stubs.sendMessage.firstCall.args;
		expect(botArg).to.equal(BOT);
		expect(placeholderMsg.rid).to.equal('rid1');
		expect(placeholderMsg.msg).to.include('Chi is thinking');
		expect(roomArg).to.equal(ROOM);

		// Context assembly: matterId + room display name + asker reach the adapter.
		expect(stubs.askChi.firstCall.args[0]).to.deep.equal({
			question: 'how is treatment going?',
			roomName: 'Smith v Jones',
			matterId: 'matter-123',
			askedBy: 'phillip',
		});

		// Answer posting: the placeholder is edited in place with the attributed answer.
		const [edited, editor, original] = stubs.updateMessage.firstCall.args;
		expect(edited._id).to.equal('msg1');
		expect(edited.rid).to.equal('rid1');
		expect(edited.msg).to.include('Treatment is ongoing.');
		expect(edited.msg).to.include('matter `matter-123`');
		expect(edited.msg).to.include('@phillip');
		expect(editor).to.equal(BOT);
		expect(original).to.equal(PLACEHOLDER);
	});

	it('edits the placeholder into a friendly failure when the agent call fails', async () => {
		stubs.askChi.resolves({ ok: false, reason: 'unavailable', note: 'CHI is unavailable (AbortError)' });
		await handleChiQuestion('u1', 'rid1', 'question');
		const [edited] = stubs.updateMessage.firstCall.args;
		expect(edited.msg).to.include("Chi couldn't answer right now");
		expect(edited.msg).to.include('try again');
	});

	it('never rejects even when posting blows up (falls back to an ephemeral note)', async () => {
		stubs.sendMessage.rejects(new Error('db down'));
		await handleChiQuestion('u1', 'rid1', 'question');
		expect(ephemeralMsg()).to.include("Chi couldn't answer right now");
		expect(stubs.updateMessage.called).to.be.false;
	});
});

describe('chi/service — formatting', () => {
	it('formatChiAnswer stamps attribution and the matter id', () => {
		const out = formatChiAnswer('Answer.', { askedBy: 'phillip', matterId: 'm-1' });
		expect(out).to.include('Answer.');
		expect(out).to.include('*Chi*');
		expect(out).to.include('@phillip');
		expect(out).to.include('m-1');
	});

	it('formatChiAnswer omits missing parts cleanly', () => {
		const out = formatChiAnswer('Answer.', {});
		expect(out).to.include('— *Chi*');
		expect(out).to.not.include('@');
		expect(out).to.not.include('matter');
	});

	it('formatChiFailure is friendly and includes the note', () => {
		const out = formatChiFailure('CHI request failed (503)');
		expect(out).to.include('503');
		expect(out.toLowerCase()).to.include('try again');
	});
});
