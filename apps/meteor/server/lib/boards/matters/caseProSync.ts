import { Boards, BoardsActivities } from '@rocket.chat/models';

import { caseProTransportDiagnostics } from '../casepro';
import { seedFromCasePro } from './service';

/**
 * CasePro Matters auto-sync service (mirrors leads/caseproSync).
 *
 * Wrapper around `seedFromCasePro` that updates the board's `caseproSync.syncStatus`
 * with timing and error info for the UI to display "Syncing from CasePro…" →
 * "Synced ✓ <time>" status.
 */

export type PullFromCaseProResult = {
	/** total matters returned by CasePro. */
	total: number;
	/** new matter cards bound on this pull. */
	bound: number;
	/** matters skipped (bad id or binding error). */
	skipped: number;
	boardId: string;
};

/**
 * THE one enablement gate for matters sync (mirrors leads). Disabled → sync is NO-OP.
 */
export function isCaseProEnabled(): boolean {
	const diag = caseProTransportDiagnostics();
	return diag.effective !== 'stub';
}

/**
 * Pull matters from CasePro and update board sync status. Wrapper around
 * `seedFromCasePro` that persists `lastSyncStartedAt`, `lastSyncFinishedAt`,
 * and `lastSyncError` on the board doc's `caseproSync.syncStatus`.
 *
 * NO-OP (returns early) when CasePro is not enabled or no matters board exists.
 */
export async function pullFromCasePro(uid: string): Promise<PullFromCaseProResult | null> {
	if (!isCaseProEnabled()) {
		return null;
	}

	// Find an existing matters board (never create from cron).
	const boards = await Boards.findByPipelineType('matters').toArray();
	const board = boards.find((b) => !b.archived);
	if (!board) {
		return null;
	}

	const startedAt = new Date();
	try {
		// Update sync status: mark as "syncing".
		await Boards.updateOne(
			{ _id: board._id },
			{ $set: { 'caseproSync.syncStatus.lastSyncStartedAt': startedAt }, $inc: { rev: 1 } },
		);

		// Run the actual sync (seedFromCasePro delegates to bindMatterCard per matter).
		const result = await seedFromCasePro(uid, board._id);

		const finishedAt = new Date();
		// Update sync status: mark as successful with finish time.
		await Boards.updateOne(
			{ _id: board._id },
			{
				$set: {
					'caseproSync.syncStatus.lastSyncFinishedAt': finishedAt,
					// Clear any prior error on success
					'caseproSync.syncStatus.lastSyncError': undefined,
				},
				$inc: { rev: 1 },
			},
		);

		await BoardsActivities.log({
			boardId: board._id,
			actor: uid,
			verb: 'casepro.snapshot.refreshed',
			to: { syncedFromCasePro: true, total: result.total, bound: result.bound, skipped: result.skipped },
			ts: finishedAt,
		});

		return { total: result.total, bound: result.bound, skipped: result.skipped, boardId: board._id };
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		// Update sync status: mark as failed with error message.
		await Boards.updateOne(
			{ _id: board._id },
			{
				$set: {
					'caseproSync.syncStatus.lastSyncFinishedAt': new Date(),
					'caseproSync.syncStatus.lastSyncError': errorMsg,
				},
				$inc: { rev: 1 },
			},
		).catch(() => {
			// swallow error updating the status itself; log the original error
		});

		await BoardsActivities.log({
			boardId: board._id,
			actor: uid,
			verb: 'casepro.snapshot.failed',
			to: { syncedFromCasePro: false, error: errorMsg },
			ts: new Date(),
		}).catch(() => {
			// swallow
		});

		throw err;
	}
}
