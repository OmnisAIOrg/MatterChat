import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { evaluateMessageForIndexing } from '../../../../../../server/lib/chi/search/indexGate';

const BOT = 'chi.bot';

const room = (overrides: Partial<IRoom> = {}): IRoom => ({ _id: 'room-1', t: 'c', ...overrides }) as IRoom;

const message = (overrides: Partial<IMessage> = {}): IMessage =>
	({
		_id: 'msg-1',
		msg: 'the deposition moved to Thursday',
		u: { _id: 'user-1', username: 'jane' },
		ts: new Date('2026-08-15T12:00:00.000Z'),
		...overrides,
	}) as IMessage;

const decide = (m: Partial<IMessage> = {}, r: Partial<IRoom> | null = {}, enabled = true) =>
	evaluateMessageForIndexing(message(m), r === null ? undefined : room(r), enabled, BOT).action;

describe('chi search index gate', () => {
	it('indexes an ordinary human message', () => {
		expect(decide()).to.equal('index');
	});

	it('skips everything when no embedding provider is configured', () => {
		expect(decide({}, {}, false)).to.equal('skip');
	});

	it('skips system messages', () => {
		expect(decide({ t: 'uj' })).to.equal('skip');
		expect(decide({ t: 'room_changed_topic' })).to.equal('skip');
	});

	it('skips messages with no text of their own', () => {
		expect(decide({ msg: '' })).to.equal('skip');
		expect(decide({ msg: '   ' })).to.equal('skip');
		expect(decide({ msg: undefined as unknown as string })).to.equal('skip');
	});

	it('skips hidden (deleted-but-retained) messages', () => {
		expect(decide({ _hidden: true })).to.equal('skip');
	});

	it("skips Chi's own posts, so an answer can never be cited as a source", () => {
		expect(decide({ u: { _id: BOT, username: 'chi.bot' } })).to.equal('skip');
	});

	it('indexes other bots — an integration posting a filing is real content', () => {
		expect(decide({ u: { _id: 'jira.bot', username: 'jira.bot' } })).to.equal('index');
	});

	it('skips edits, which the watermark would not re-read anyway', () => {
		expect(
			evaluateMessageForIndexing(
				message({ editedAt: new Date(), editedBy: { _id: 'user-1', username: 'jane' } } as Partial<IMessage>),
				room(),
				true,
				BOT,
			).action,
		).to.equal('skip');
	});

	it('skips when the room is missing', () => {
		expect(decide({}, null)).to.equal('skip');
	});

	it('skips when the message is missing', () => {
		expect(evaluateMessageForIndexing(undefined, room(), true, BOT).action).to.equal('skip');
	});

	it('indexes DMs and private groups, not just channels', () => {
		expect(decide({}, { t: 'd' })).to.equal('index');
		expect(decide({}, { t: 'p' })).to.equal('index');
	});

	it('does not need a bot id to be supplied', () => {
		expect(evaluateMessageForIndexing(message(), room(), true).action).to.equal('index');
		expect(evaluateMessageForIndexing(message({ u: { _id: BOT, username: 'chi.bot' } }), room(), true).action).to.equal('index');
	});
});

describe('chi search index gate — attachments', () => {
	const upload = { _id: 'f1', name: 'hernandez-deposition.pdf', type: 'application/pdf' };

	it('indexes an upload posted with no caption', () => {
		expect(evaluateMessageForIndexing(message({ msg: '', file: upload } as Partial<IMessage>), room(), true, BOT).action).to.equal('index');
	});

	it('indexes a multi-file upload with no caption', () => {
		expect(evaluateMessageForIndexing(message({ msg: '', files: [upload] } as Partial<IMessage>), room(), true, BOT).action).to.equal('index');
	});

	it('still skips a message carrying neither text nor a file', () => {
		expect(evaluateMessageForIndexing(message({ msg: '', files: [] } as Partial<IMessage>), room(), true, BOT).action).to.equal('skip');
	});

	it('still skips a hidden upload', () => {
		expect(
			evaluateMessageForIndexing(message({ msg: '', file: upload, _hidden: true } as Partial<IMessage>), room(), true, BOT).action,
		).to.equal('skip');
	});
});
