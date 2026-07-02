import { ServerEvents, Users } from '@rocket.chat/models';

import { auditLegalHoldChanged } from './auditLegalHoldChanges';

jest.mock('@rocket.chat/models', () => ({
	ServerEvents: {
		createAuditServerEvent: jest.fn(),
	},
	Users: {
		findOneById: jest.fn(),
	},
}));

const createAuditServerEventMock = ServerEvents.createAuditServerEvent as jest.Mock;
const findOneByIdMock = Users.findOneById as jest.Mock;

describe('auditLegalHoldChanged', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		findOneByIdMock.mockResolvedValue({ _id: 'admin-id', username: 'the.admin' });
	});

	it('emits a room.legalHold.changed event with actor, scope and case details on set', async () => {
		await auditLegalHoldChanged('admin-id', 'set', { _id: 'rid1', name: 'matter-42', fname: 'Matter 42' }, {
			caseId: 'CASE-42',
			reason: 'Anticipated litigation',
		});

		expect(createAuditServerEventMock).toHaveBeenCalledTimes(1);
		expect(createAuditServerEventMock).toHaveBeenCalledWith(
			'room.legalHold.changed',
			{
				operation: 'set',
				roomId: 'rid1',
				roomName: 'Matter 42',
				caseId: 'CASE-42',
				reason: 'Anticipated litigation',
			},
			{ type: 'user', _id: 'admin-id', username: 'the.admin', ip: '', useragent: '' },
		);
	});

	it('emits a cleared event and falls back to room.name when fname is missing', async () => {
		await auditLegalHoldChanged('admin-id', 'cleared', { _id: 'rid1', name: 'matter-42' });

		expect(createAuditServerEventMock).toHaveBeenCalledWith(
			'room.legalHold.changed',
			expect.objectContaining({ operation: 'cleared', roomId: 'rid1', roomName: 'matter-42' }),
			expect.objectContaining({ _id: 'admin-id' }),
		);
	});

	it('still emits with an empty username when the actor user cannot be resolved', async () => {
		findOneByIdMock.mockResolvedValue(null);

		await auditLegalHoldChanged('ghost-id', 'set', { _id: 'rid1', name: 'matter-42' });

		expect(createAuditServerEventMock).toHaveBeenCalledWith(
			'room.legalHold.changed',
			expect.objectContaining({ operation: 'set' }),
			{ type: 'user', _id: 'ghost-id', username: '', ip: '', useragent: '' },
		);
	});
});
