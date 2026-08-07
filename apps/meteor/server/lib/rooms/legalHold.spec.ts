import { Rooms, ServerEvents, Users } from '@rocket.chat/models';

import { permissions } from '../authorization/constant/permissions';
import { clearRoomLegalHold, getLegalHoldState, isRoomUnderLegalHold, setRoomLegalHold } from './legalHold';

jest.mock('@rocket.chat/models', () => ({
	Rooms: {
		saveLegalHoldById: jest.fn(),
		clearLegalHoldById: jest.fn(),
		findOneById: jest.fn(),
	},
	Users: {
		findOneById: jest.fn(),
	},
	ServerEvents: {
		createAuditServerEvent: jest.fn(),
	},
}));

const roomsFindOneByIdMock = Rooms.findOneById as jest.Mock;
const saveLegalHoldByIdMock = Rooms.saveLegalHoldById as jest.Mock;
const clearLegalHoldByIdMock = Rooms.clearLegalHoldById as jest.Mock;
const usersFindOneByIdMock = Users.findOneById as jest.Mock;
const createAuditServerEventMock = ServerEvents.createAuditServerEvent as jest.Mock;

const room = { _id: 'rid1', name: 'matter-42', fname: 'Matter 42' };

describe('legal hold — permission gate', () => {
	it('seeds the manage-legal-hold permission for admin (and only admin) by default', () => {
		const permission = permissions.find(({ _id }) => _id === 'manage-legal-hold');
		expect(permission).toBeDefined();
		expect(permission?.roles).toEqual(['admin']);
	});
});

describe('isRoomUnderLegalHold (the purge/erase guard predicate)', () => {
	it.each([
		['null room', null, false],
		['room without retention', { _id: 'rid1' }, false],
		['retention without legalHold', { _id: 'rid1', retention: {} }, false],
		['hold explicitly disabled (released)', { _id: 'rid1', retention: { legalHold: { enabled: false } } }, false],
		['hold enabled', { _id: 'rid1', retention: { legalHold: { enabled: true } } }, true],
	])('%s → %s', (_label, input, expected) => {
		expect(isRoomUnderLegalHold(input as any)).toBe(expected);
	});

	it('defaults the state to disabled when never set', () => {
		expect(getLegalHoldState({ _id: 'rid1' })).toEqual({ enabled: false });
	});
});

describe('setRoomLegalHold', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		usersFindOneByIdMock.mockResolvedValue({ _id: 'admin-id', username: 'the.admin' });
	});

	it('persists the hold with actor + case details and audits the change', async () => {
		const persisted = { enabled: true, setAt: new Date(), setBy: { _id: 'admin-id', username: 'the.admin' }, caseId: 'CASE-42' };
		roomsFindOneByIdMock.mockResolvedValue({ _id: 'rid1', retention: { legalHold: persisted } });

		const result = await setRoomLegalHold('admin-id', room, { caseId: 'CASE-42', reason: 'Anticipated litigation' });

		expect(saveLegalHoldByIdMock).toHaveBeenCalledWith('rid1', {
			setBy: { _id: 'admin-id', username: 'the.admin' },
			caseId: 'CASE-42',
			reason: 'Anticipated litigation',
		});
		expect(createAuditServerEventMock).toHaveBeenCalledWith(
			'room.legalHold.changed',
			expect.objectContaining({ operation: 'set', roomId: 'rid1', caseId: 'CASE-42' }),
			expect.objectContaining({ _id: 'admin-id' }),
		);
		expect(result).toEqual(persisted);
	});

	it('does not fail the hold change when the audit write rejects (best-effort doctrine)', async () => {
		roomsFindOneByIdMock.mockResolvedValue({ _id: 'rid1', retention: { legalHold: { enabled: true } } });
		createAuditServerEventMock.mockRejectedValue(new Error('audit backend down'));

		await expect(setRoomLegalHold('admin-id', room)).resolves.toEqual({ enabled: true });
		expect(saveLegalHoldByIdMock).toHaveBeenCalled();
	});
});

describe('clearRoomLegalHold', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		usersFindOneByIdMock.mockResolvedValue({ _id: 'admin-id', username: 'the.admin' });
	});

	it('releases the hold and audits the change with the released hold’s caseId', async () => {
		roomsFindOneByIdMock
			// first read: the previous hold (for the audit payload)
			.mockResolvedValueOnce({ _id: 'rid1', retention: { legalHold: { enabled: true, caseId: 'CASE-42' } } })
			// second read: the persisted state after clearing
			.mockResolvedValueOnce({ _id: 'rid1', retention: { legalHold: { enabled: false, caseId: 'CASE-42' } } });

		const result = await clearRoomLegalHold('admin-id', room);

		expect(clearLegalHoldByIdMock).toHaveBeenCalledWith('rid1');
		expect(createAuditServerEventMock).toHaveBeenCalledWith(
			'room.legalHold.changed',
			expect.objectContaining({ operation: 'cleared', roomId: 'rid1', caseId: 'CASE-42' }),
			expect.objectContaining({ _id: 'admin-id' }),
		);
		expect(result).toEqual({ enabled: false, caseId: 'CASE-42' });
		expect(isRoomUnderLegalHold({ _id: 'rid1', retention: { legalHold: result } })).toBe(false);
	});
});
