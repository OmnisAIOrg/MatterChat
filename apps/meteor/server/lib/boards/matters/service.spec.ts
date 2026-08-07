import type { IBoardCard, IMatterSnapshot } from '@rocket.chat/core-typings';
import { BoardsCards, BoardsActivities } from '@rocket.chat/models';

import { caseProClient } from './caseProClient';
import { refreshMatterSnapshot } from './service';

/**
 * Regression coverage for the "matters degrade gracefully" fix.
 *
 * The bug: `boards.matters.bind` → `refreshMatterSnapshot` hard-failed with
 * `error-matter-not-found` (400) whenever CasePro couldn't resolve the matter (disabled,
 * stub/unreachable transport, OR a genuinely unknown id). That violated standalone-first —
 * MatterChat must work without CasePro. The fix: a GRACEFUL refresh soft-links the matter and
 * writes a PENDING (`resolved:false`) placeholder snapshot instead of throwing, while a
 * NON-graceful (manual) refresh still throws so the user gets a clear signal.
 */

// Meteor.Error — `meteor/meteor` is a Meteor-runtime module unresolvable under jest, so mock it
// virtually (the server preset doesn't map it). Only `Meteor.Error` is used by the code under test.
jest.mock(
	'meteor/meteor',
	() => ({
		Meteor: {
			// eslint-disable-next-line @typescript-eslint/naming-convention
			Error: class MeteorError extends Error {
				public error: string;

				public reason?: string;

				constructor(error: string, reason?: string) {
					super(reason ?? error);
					this.error = error;
					this.reason = reason;
				}
			},
		},
	}),
	{ virtual: true },
);

jest.mock('@rocket.chat/models', () => ({
	Boards: {},
	BoardsLists: {},
	BoardsCards: { findOneById: jest.fn(), refreshMatterSnapshot: jest.fn(), updateOne: jest.fn() },
	BoardsActivities: { log: jest.fn() },
	Rooms: {},
	Users: {},
}));

// Stub the transitive imports that would otherwise drag in Meteor server internals.
jest.mock('../../rooms/createRoom', () => ({ createRoom: jest.fn() }));
jest.mock('../service', () => ({ createBoard: jest.fn(), createList: jest.fn() }));
jest.mock('./deadlines', () => ({ ensureSolDeadlineForMatter: jest.fn() }));

jest.mock('./caseProClient', () => ({
	caseProClient: { matterSnapshot: jest.fn() },
	getStageId: jest.fn(),
}));

const cardsFindMock = BoardsCards.findOneById as jest.Mock;
const refreshSnapshotMock = BoardsCards.refreshMatterSnapshot as jest.Mock;
const activityLogMock = BoardsActivities.log as jest.Mock;
const matterSnapshotMock = caseProClient.matterSnapshot as jest.Mock;

const CARD_ID = 'card-1';
const MATTER_ID = 'E2E-abc123';

const matterCard = (overrides: Partial<IBoardCard> = {}): IBoardCard =>
	({
		_id: CARD_ID,
		boardId: 'B1',
		listId: 'L1',
		title: `Matter ${MATTER_ID}`,
		cardType: 'matter',
		archived: false,
		link: { kind: 'matter', matterId: MATTER_ID },
		...overrides,
	}) as unknown as IBoardCard;

const resolvedSnapshot = (): IMatterSnapshot => ({
	matterId: MATTER_ID,
	matterName: 'Doe v. Roe',
	fetchedAt: new Date(),
	stale: false,
	resolved: true,
});

describe('refreshMatterSnapshot — graceful degrade', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		refreshSnapshotMock.mockResolvedValue(undefined);
		activityLogMock.mockResolvedValue(undefined);
	});

	describe('graceful:true (bind path)', () => {
		it('soft-links with a PENDING snapshot when the matter cannot be resolved (not found / disabled / unreachable)', async () => {
			// CasePro returns null (matter id doesn't resolve, or stub has no such matter).
			matterSnapshotMock.mockResolvedValue(null);
			cardsFindMock
				.mockResolvedValueOnce(matterCard()) // initial load
				.mockResolvedValueOnce(matterCard({ link: { kind: 'matter', matterId: MATTER_ID, snapshot: { matterId: MATTER_ID, fetchedAt: new Date(), stale: true, resolved: false } } })); // reload after write

			const card = await refreshMatterSnapshot('uid', CARD_ID, { graceful: true });

			// wrote a placeholder, did NOT throw
			expect(refreshSnapshotMock).toHaveBeenCalledTimes(1);
			const written = refreshSnapshotMock.mock.calls[0][1] as IMatterSnapshot;
			expect(written.matterId).toBe(MATTER_ID);
			expect(written.resolved).toBe(false);
			expect(written.stale).toBe(true);
			expect((card.link as { snapshot?: IMatterSnapshot }).snapshot?.resolved).toBe(false);
		});

		it('treats a THROWING transport (unreachable) the same as not-found — soft-link, no rethrow', async () => {
			matterSnapshotMock.mockRejectedValue(new Error('CasePro get(matters) failed: HTTP 502'));
			cardsFindMock.mockResolvedValueOnce(matterCard()).mockResolvedValueOnce(matterCard());

			await expect(refreshMatterSnapshot('uid', CARD_ID, { graceful: true })).resolves.toBeDefined();
			expect(refreshSnapshotMock).toHaveBeenCalledTimes(1);
			expect(refreshSnapshotMock.mock.calls[0][1].resolved).toBe(false);
		});

		it('does NOT clobber an already-resolved snapshot on a transient miss', async () => {
			matterSnapshotMock.mockResolvedValue(null);
			const alreadyResolved = matterCard({
				link: { kind: 'matter', matterId: MATTER_ID, snapshot: resolvedSnapshot() },
			});
			cardsFindMock.mockResolvedValueOnce(alreadyResolved).mockResolvedValueOnce(alreadyResolved);

			await refreshMatterSnapshot('uid', CARD_ID, { graceful: true });

			// no placeholder written over the good snapshot
			expect(refreshSnapshotMock).not.toHaveBeenCalled();
			expect(activityLogMock).not.toHaveBeenCalled();
		});
	});

	describe('graceful:false (manual refresh path) — unchanged hard-fail', () => {
		it('still throws error-matter-not-found when the matter cannot be resolved', async () => {
			matterSnapshotMock.mockResolvedValue(null);
			cardsFindMock.mockResolvedValueOnce(matterCard());

			await expect(refreshMatterSnapshot('uid', CARD_ID)).rejects.toMatchObject({ error: 'error-matter-not-found' });
			expect(refreshSnapshotMock).not.toHaveBeenCalled();
		});
	});

	describe('happy path — unchanged', () => {
		it('writes the resolved snapshot and logs a refresh when CasePro returns one', async () => {
			matterSnapshotMock.mockResolvedValue(resolvedSnapshot());
			cardsFindMock
				.mockResolvedValueOnce(matterCard())
				.mockResolvedValueOnce(matterCard({ title: 'Doe v. Roe', link: { kind: 'matter', matterId: MATTER_ID, snapshot: resolvedSnapshot() } }));

			const card = await refreshMatterSnapshot('uid', CARD_ID);

			expect(refreshSnapshotMock).toHaveBeenCalledTimes(1);
			expect(refreshSnapshotMock.mock.calls[0][1].resolved).toBe(true);
			expect((card.link as { snapshot?: IMatterSnapshot }).snapshot?.resolved).toBe(true);
		});
	});
});
