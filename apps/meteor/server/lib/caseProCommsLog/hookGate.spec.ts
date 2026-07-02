import type { IMessage, IRoom } from '@rocket.chat/core-typings';

import { evaluateMessageForCommsLog } from './hookGate';

const message = (overrides: Partial<IMessage> = {}): IMessage =>
	({
		_id: 'msg-1',
		rid: 'room-1',
		msg: 'hello',
		ts: new Date('2026-07-01T12:00:00.000Z'),
		u: { _id: 'u1', username: 'alice', name: 'Alice Attorney' },
		...overrides,
	}) as IMessage;

const matterRoom = (overrides: Partial<IRoom> = {}): IRoom =>
	({
		_id: 'room-1',
		t: 'p',
		matterId: 'matter-1',
		...overrides,
	}) as IRoom;

describe('evaluateMessageForCommsLog (the afterSaveMessage gate)', () => {
	it('skips rooms without a matterId — normal rooms are untouched', () => {
		expect(evaluateMessageForCommsLog(message(), matterRoom({ matterId: undefined }), true)).toEqual({ action: 'skip' });
		expect(evaluateMessageForCommsLog(message(), undefined, true)).toEqual({ action: 'skip' });
	});

	it('skips everything when the global switches are off (kill switch)', () => {
		expect(evaluateMessageForCommsLog(message(), matterRoom(), false)).toEqual({ action: 'skip' });
	});

	it('skips channels that opted out via the per-channel toggle', () => {
		expect(evaluateMessageForCommsLog(message(), matterRoom({ caseProCommsLog: { enabled: false } }), true)).toEqual({
			action: 'skip',
		});
	});

	it('defaults to ON for matter-linked channels (enabled undefined ⇒ log)', () => {
		expect(evaluateMessageForCommsLog(message(), matterRoom(), true)).toEqual({ action: 'log', edited: false });
		expect(evaluateMessageForCommsLog(message(), matterRoom({ caseProCommsLog: {} }), true)).toEqual({
			action: 'log',
			edited: false,
		});
	});

	it('skips system messages and empty/file-only messages', () => {
		expect(evaluateMessageForCommsLog(message({ t: 'uj' } as Partial<IMessage>), matterRoom(), true)).toEqual({ action: 'skip' });
		expect(evaluateMessageForCommsLog(message({ msg: '' }), matterRoom(), true)).toEqual({ action: 'skip' });
		expect(evaluateMessageForCommsLog(message({ msg: '   ' }), matterRoom(), true)).toEqual({ action: 'skip' });
	});

	it('flags edited messages so they are re-sent with the same id (idempotent upstream)', () => {
		const edited = message({ editedAt: new Date(), editedBy: { _id: 'u1', username: 'alice' } } as Partial<IMessage>);
		expect(evaluateMessageForCommsLog(edited, matterRoom(), true)).toEqual({ action: 'log', edited: true });
	});
});
