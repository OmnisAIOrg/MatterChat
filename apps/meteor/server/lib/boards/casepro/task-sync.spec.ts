import type { IBoardCard } from '@rocket.chat/core-typings';
import { Boards, BoardsCards, BoardsActivities } from '@rocket.chat/models';

import { settings } from '../../../settings';
import { caseProClient } from './client';
import { StubTransport } from './transport';
import { syncCardEvent, setTaskSyncEnabled, isTaskSyncEnabledForBoard, __resetTaskSyncStateForTests } from './task-sync';

jest.mock('@rocket.chat/models', () => ({
	Boards: { findOneById: jest.fn(), updateOne: jest.fn() },
	BoardsCards: { findOneById: jest.fn() },
	BoardsActivities: { log: jest.fn() },
}));

jest.mock('../../../settings', () => ({
	settings: { get: jest.fn() },
}));

const settingsGetMock = settings.get as jest.Mock;
const boardsFindMock = Boards.findOneById as jest.Mock;
const boardsUpdateMock = Boards.updateOne as jest.Mock;
const cardsFindMock = BoardsCards.findOneById as jest.Mock;
const activityLogMock = BoardsActivities.log as jest.Mock;

const BOARD_ID = 'B1';
const CARD_ID = 'card-abc';

const optedInBoard = { _id: BOARD_ID, caseproSync: { taskSyncEnabled: true } };

const baseCard = (overrides: Partial<IBoardCard> = {}): IBoardCard =>
	({
		_id: CARD_ID,
		boardId: BOARD_ID,
		listId: 'L1',
		title: 'Call the adjuster',
		cardType: 'task',
		archived: false,
		...overrides,
	}) as unknown as IBoardCard;

const payload = { boardId: BOARD_ID, cardId: CARD_ID, actor: 'user1' };

describe('card → CasePro task push sync', () => {
	let stub: StubTransport;

	const taskRows = async () => (await stub.query('tasks')).data;

	beforeEach(() => {
		jest.clearAllMocks();
		__resetTaskSyncStateForTests();
		stub = new StubTransport();
		caseProClient.setTransport(stub);
		settingsGetMock.mockImplementation((id: string) => id === 'CasePro_Enabled');
		boardsFindMock.mockResolvedValue(optedInBoard);
		cardsFindMock.mockResolvedValue(baseCard());
	});

	afterEach(() => {
		caseProClient.setTransport(undefined);
	});

	describe('gating', () => {
		it('does nothing when the board has not opted in (default off)', async () => {
			boardsFindMock.mockResolvedValue({ _id: BOARD_ID }); // no caseproSync
			await syncCardEvent('card.created', payload);
			expect(await taskRows()).toHaveLength(0);
			expect(activityLogMock).not.toHaveBeenCalled();
		});

		it('does nothing when CasePro_Enabled is off, even for an opted-in board', async () => {
			settingsGetMock.mockReturnValue(false);
			await syncCardEvent('card.created', payload);
			expect(await taskRows()).toHaveLength(0);
		});

		it('skips lead cards (they have their own intake write-through)', async () => {
			cardsFindMock.mockResolvedValue(baseCard({ cardType: 'lead', link: { kind: 'lead', leadId: 'lead1' } } as Partial<IBoardCard>));
			await syncCardEvent('card.created', payload);
			expect(await taskRows()).toHaveLength(0);
		});

		it('ignores events outside the sync vocabulary', async () => {
			await syncCardEvent('card.archived', payload);
			expect(await taskRows()).toHaveLength(0);
		});
	});

	describe('field mapping (the CasePro contract)', () => {
		it('card.created creates the task with subject/source/external_ref (NOT title)', async () => {
			const due = new Date('2026-08-01T12:00:00.000Z');
			cardsFindMock.mockResolvedValue(baseCard({ dueDate: due }));

			await syncCardEvent('card.created', payload);

			const rows = await taskRows();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toEqual(
				expect.objectContaining({
					subject: 'Call the adjuster', // CasePro field is `subject`, not `title`
					source: 'MatterChat',
					external_ref: CARD_ID,
					due_date: due.toISOString(),
					task_status: 'Not Started',
					status: 'active',
				}),
			);
			expect(rows[0]).not.toHaveProperty('title');

			expect(activityLogMock).toHaveBeenCalledWith(
				expect.objectContaining({
					verb: 'casepro.task.pushed',
					cardId: CARD_ID,
					actor: 'user1',
					to: expect.objectContaining({ op: 'create', externalRef: CARD_ID, pushedToCasePro: true, transport: 'stub' }),
				}),
			);
		});

		it('a matter-linked card carries related_to_id', async () => {
			cardsFindMock.mockResolvedValue(baseCard({ link: { kind: 'matter', matterId: 'stub-matter-0001' } } as Partial<IBoardCard>));
			await syncCardEvent('card.created', payload);
			expect((await taskRows())[0]).toEqual(expect.objectContaining({ related_to_id: 'stub-matter-0001' }));
		});

		it('retitle UPDATES the correlated task (upsert by external_ref, no duplicate)', async () => {
			await syncCardEvent('card.created', payload);
			const [created] = await taskRows();

			cardsFindMock.mockResolvedValue(baseCard({ title: 'Call the adjuster TODAY' }));
			await syncCardEvent('card.updated', payload);

			const rows = await taskRows();
			expect(rows).toHaveLength(1); // updated, not re-created
			expect(rows[0].id).toBe(created.id);
			expect(rows[0].subject).toBe('Call the adjuster TODAY');
			expect(activityLogMock).toHaveBeenLastCalledWith(
				expect.objectContaining({ to: expect.objectContaining({ op: 'update', caseproTaskId: String(created.id) }) }),
			);
		});

		it('completion pushes task_status Completed; a plain retitle never touches task_status', async () => {
			await syncCardEvent('card.created', payload);

			// CasePro-side status edit happens meanwhile (must not be clobbered by a retitle)
			const [created] = await taskRows();
			await stub.update('tasks', String(created.id), { task_status: 'In Progress' });

			cardsFindMock.mockResolvedValue(baseCard({ title: 'Renamed' }));
			await syncCardEvent('card.updated', payload);
			expect((await taskRows())[0].task_status).toBe('In Progress'); // preserved

			cardsFindMock.mockResolvedValue(baseCard({ title: 'Renamed', completed: true } as Partial<IBoardCard>));
			await syncCardEvent('due.completed', payload);
			expect((await taskRows())[0].task_status).toBe('Completed');
		});
	});

	describe('idempotency TTL', () => {
		it('an identical re-fire within the TTL pushes once', async () => {
			await syncCardEvent('card.created', payload);
			await syncCardEvent('card.updated', payload); // same projected fields
			expect(activityLogMock).toHaveBeenCalledTimes(1);
			expect(await taskRows()).toHaveLength(1);
		});

		it('a changed projection is pushed immediately (dedupe keys on fields, not just card)', async () => {
			await syncCardEvent('card.created', payload);
			cardsFindMock.mockResolvedValue(baseCard({ title: 'New title' }));
			await syncCardEvent('card.updated', payload);
			expect(activityLogMock).toHaveBeenCalledTimes(2);
		});
	});

	describe('setTaskSyncEnabled (the per-board opt-in)', () => {
		it('flips board.caseproSync.taskSyncEnabled and audits on the board feed', async () => {
			boardsFindMock.mockResolvedValue(optedInBoard);
			const board = await setTaskSyncEnabled('admin1', BOARD_ID, true);
			expect(boardsUpdateMock).toHaveBeenCalledWith({ _id: BOARD_ID }, { $set: { 'caseproSync.taskSyncEnabled': true }, $inc: { rev: 1 } });
			expect(activityLogMock).toHaveBeenCalledWith(
				expect.objectContaining({ verb: 'board.updated', actor: 'admin1', to: { caseproTaskSyncEnabled: true } }),
			);
			expect(isTaskSyncEnabledForBoard(board)).toBe(true);
		});

		it('isTaskSyncEnabledForBoard defaults false', () => {
			expect(isTaskSyncEnabledForBoard(null)).toBe(false);
			expect(isTaskSyncEnabledForBoard({ caseproSync: {} })).toBe(false);
		});
	});
});
