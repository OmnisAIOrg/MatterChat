import type { IActionCaseproWriteback } from '@rocket.chat/core-typings';
import { BoardsActivities } from '@rocket.chat/models';

import { settings } from '../../../../app/settings/server';
import { hasPermissionAsync } from '../../../../app/authorization/server/functions/hasPermission';
import { caseProClient } from '../../../lib/boards/casepro/client';
import { __forceLiveTransportForTests } from '../../../lib/boards/casepro/live';
import { StubTransport } from '../../../lib/boards/casepro/transport';
import { rootLoopState } from '../context';
import type { AutomationContext } from '../context';
import { handleCaseproWriteback, __resetWritebackStateForTests } from './integration';

jest.mock('@rocket.chat/models', () => ({
	BoardsActivities: { log: jest.fn() },
}));

jest.mock('../../../../app/settings/server', () => ({
	settings: { get: jest.fn() },
}));

jest.mock('../../../../app/authorization/server/functions/hasPermission', () => ({
	hasPermissionAsync: jest.fn(),
}));

const settingsGetMock = settings.get as jest.Mock;
const hasPermissionMock = hasPermissionAsync as jest.Mock;
const activityLogMock = BoardsActivities.log as jest.Mock;

const STUB_MATTER_ID = 'stub-matter-0001';

const advanceStage = (stageId = 'stub-stage-intake'): IActionCaseproWriteback => ({
	type: 'caseproWriteback',
	operation: 'advanceStage',
	stageId,
});

const buildCtx = (overrides: Partial<AutomationContext> = {}): AutomationContext =>
	({
		automation: { _id: 'auto1', createdBy: 'author1' },
		boardId: 'B1',
		event: 'card.moved',
		subject: {
			boardId: 'B1',
			card: { _id: 'card1', title: 'Doe v. Roe', link: { kind: 'matter', matterId: STUB_MATTER_ID } },
		},
		actor: 'user1',
		dryRun: false,
		loop: rootLoopState(),
		...overrides,
	}) as unknown as AutomationContext;

describe('handleCaseproWriteback', () => {
	let stub: StubTransport;

	beforeEach(() => {
		jest.clearAllMocks();
		__resetWritebackStateForTests();
		stub = new StubTransport();
		caseProClient.setTransport(stub);
		// default: gates open + live transport (individual cases flip these off)
		settingsGetMock.mockImplementation((id: string) => id === 'Boards_Automation_CasePro_Writeback_Enabled');
		hasPermissionMock.mockResolvedValue(true);
		__forceLiveTransportForTests(true);
	});

	afterEach(() => {
		__forceLiveTransportForTests(undefined);
		caseProClient.setTransport(undefined);
	});

	describe('gates (unchanged behavior)', () => {
		it('skips writeback-disabled when the master setting is off', async () => {
			settingsGetMock.mockReturnValue(false);
			const result = await handleCaseproWriteback(advanceStage(), buildCtx(), 0);
			expect(result.status).toBe('skipped');
			expect(result.skippedReason).toBe('writeback-disabled');
			expect(activityLogMock).not.toHaveBeenCalled();
		});

		it('skips writeback-disabled when the actor lacks the permission', async () => {
			hasPermissionMock.mockResolvedValue(false);
			const result = await handleCaseproWriteback(advanceStage(), buildCtx(), 0);
			expect(result.status).toBe('skipped');
			expect(result.skippedReason).toBe('writeback-disabled');
		});

		it('dry-run plans (validated, never executed)', async () => {
			const result = await handleCaseproWriteback(advanceStage(), buildCtx({ dryRun: true }), 0);
			expect(result.ok).toBe(true);
			expect(result.validated).toBe(true);
			expect(result.executed).toBeUndefined();
			const row = await stub.get('matters', STUB_MATTER_ID);
			expect(row?.stage_id).toBe('stub-stage-prelit'); // untouched
		});
	});

	describe('transport-live gate', () => {
		it('keeps audit-only behavior when no live transport: skipped:no-live-transport + executed:false audit', async () => {
			__forceLiveTransportForTests(false);
			const result = await handleCaseproWriteback(advanceStage(), buildCtx(), 0);
			expect(result.status).toBe('skipped');
			expect(result.skippedReason).toBe('no-live-transport');
			expect(result.validated).toBe(true);
			expect(result.executed).toBe(false);
			expect(result.caseproRef).toEqual({ entity: 'matters', id: STUB_MATTER_ID, op: 'update:stage_id=stub-stage-intake' });
			expect(activityLogMock).toHaveBeenCalledWith(expect.objectContaining({ to: expect.objectContaining({ executed: false, skippedReason: 'no-live-transport' }) }));
			const row = await stub.get('matters', STUB_MATTER_ID);
			expect(row?.stage_id).toBe('stub-stage-prelit'); // untouched
		});
	});

	describe('execution (live transport)', () => {
		it('advanceStage executes against the transport and records the result', async () => {
			const result = await handleCaseproWriteback(advanceStage(), buildCtx(), 0);
			expect(result.ok).toBe(true);
			expect(result.executed).toBe(true);
			expect(result.validated).toBe(true);
			expect(result.caseproResponse).toEqual({ id: STUB_MATTER_ID, stage_id: 'stub-stage-intake' });

			const row = await stub.get('matters', STUB_MATTER_ID);
			expect(row?.stage_id).toBe('stub-stage-intake'); // the write actually landed

			expect(activityLogMock).toHaveBeenCalledWith(
				expect.objectContaining({
					verb: 'automation.ran',
					cardId: 'card1',
					to: expect.objectContaining({ caseproWriteback: 'advanceStage', executed: true, response: { id: STUB_MATTER_ID, stage_id: 'stub-stage-intake' } }),
				}),
			);
		});

		it('updateField executes for an allow-listed matters column', async () => {
			const action: IActionCaseproWriteback = { type: 'caseproWriteback', operation: 'updateField', field: 'liability_status', value: 'Disputed' };
			const result = await handleCaseproWriteback(action, buildCtx(), 0);
			expect(result.executed).toBe(true);
			const row = await stub.get('matters', STUB_MATTER_ID);
			expect(row?.liability_status).toBe('Disputed');
		});

		it('updateField refuses a non-allow-listed column (skipped:unsupported, nothing written)', async () => {
			const action: IActionCaseproWriteback = { type: 'caseproWriteback', operation: 'updateField', field: 'client_id', value: 'evil' };
			const result = await handleCaseproWriteback(action, buildCtx(), 0);
			expect(result.status).toBe('skipped');
			expect(result.skippedReason).toBe('unsupported');
			const row = await stub.get('matters', STUB_MATTER_ID);
			expect(row?.client_id).toBe('stub-party-client');
		});

		it('createMatterFromLead executes via the lead intake link', async () => {
			const ctx = buildCtx({
				subject: { boardId: 'B1', lead: { _id: 'lead1', caseproIntakeId: 'stub-intake-1' } } as unknown as AutomationContext['subject'],
			});
			const action: IActionCaseproWriteback = { type: 'caseproWriteback', operation: 'createMatterFromLead' };
			const result = await handleCaseproWriteback(action, ctx, 0);
			expect(result.executed).toBe(true);
			const createdId = (result.caseproResponse as { id: string }).id;
			expect(createdId).toBeTruthy();
			const intake = await stub.get('intake_questionnaires', 'stub-intake-1');
			expect(intake?.matter_id).toBe(createdId);
		});
	});

	describe('idempotency TTL guard', () => {
		it('the same card+field op within the TTL executes once (second is skipped:duplicate-op)', async () => {
			const first = await handleCaseproWriteback(advanceStage(), buildCtx(), 0);
			expect(first.executed).toBe(true);

			const second = await handleCaseproWriteback(advanceStage(), buildCtx(), 0);
			expect(second.status).toBe('skipped');
			expect(second.skippedReason).toBe('duplicate-op');
			expect(second.executed).toBe(false);

			// executed audit was written exactly once
			const executedLogs = activityLogMock.mock.calls.filter(([entry]) => entry.to?.executed === true);
			expect(executedLogs).toHaveLength(1);
		});

		it('a DIFFERENT value for the same card+field is not deduplicated', async () => {
			await handleCaseproWriteback(advanceStage('stub-stage-intake'), buildCtx(), 0);
			const result = await handleCaseproWriteback(advanceStage('stub-stage-prelit'), buildCtx(), 0);
			expect(result.executed).toBe(true);
			const row = await stub.get('matters', STUB_MATTER_ID);
			expect(row?.stage_id).toBe('stub-stage-prelit');
		});

		it('a failed execution frees the idempotency slot for a retry', async () => {
			const failing = {
				query: jest.fn().mockResolvedValue({ data: [], total: 0 }),
				get: jest.fn().mockResolvedValue(null),
				listSchema: jest.fn(),
				create: jest.fn().mockRejectedValue(new Error('boom')),
				update: jest.fn().mockRejectedValue(new Error('boom')),
				ingest: jest.fn().mockResolvedValue({ ok: true }),
			};
			caseProClient.setTransport(failing);
			const failed = await handleCaseproWriteback(advanceStage(), buildCtx(), 0);
			expect(failed.status).toBe('error');

			caseProClient.setTransport(stub);
			const retried = await handleCaseproWriteback(advanceStage(), buildCtx(), 0);
			expect(retried.executed).toBe(true);
		});
	});
});
