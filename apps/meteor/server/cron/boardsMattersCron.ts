import { cronJobs } from '@rocket.chat/cron';
import { Boards, BoardsLists, BoardsCards, BoardsDeadlines, BoardsActivities } from '@rocket.chat/models';

import { ensureSolDeadlineForMatter, runDeadlineTick } from '../lib/boards/matters/deadlines';
import { normalizeStageName } from '../lib/boards/matters/stages';
import { SystemLogger } from '../lib/logger/system';

/**
 * Matters-depth daily cron (M5 — see matters-case-management.md §5 reminders + §9
 * stuck-matter alerts, differentiators.md §4 SOL watch).
 *
 * System-level jobs, none of which needs an interactive user:
 *   1. SOL watch — escalate unacknowledged high-risk (SOL/filing) deadlines that are
 *      near or past due (the no-missed-SOL guardrail).
 *   2. Deadline reminders — `runDeadlineTick`, the tickler that bumps escalation tiers
 *      and notifies owners for every open deadline whose reminder has come due.
 *   3. Reconcile sweep (daily) — flag matter cards whose cached snapshot's CasePro
 *      stage drifted from their board column, so the UI can prompt a reconcile.
 *   4. Stuck-matter weekly check — flag matters idle in their current stage too long.
 *
 * All are best-effort and board-wide: they scan the deadline/card collections
 * directly (not the per-user `ensureMattersBoard`) so they run with no caller context.
 * Sequences are NOT processed here — the leads service drives those, and M7 owns the
 * automation cron.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** SOL watch escalation window: high-risk deadlines within this many days get nagged. */
const SOL_WATCH_WINDOW_DAYS = 90;

/** Matters idle in a stage longer than this are flagged "stuck" by the weekly sweep. */
const STUCK_MATTER_DAYS = 30;

// ---------------------------------------------------------------------------
// 1 + 2. Daily deadline tick + SOL watch
// ---------------------------------------------------------------------------

/**
 * Daily: run the reminder tick (all kinds) then the SOL watch (high-risk only). The
 * SOL watch is a stricter overlay — it ensures every unacknowledged SOL/filing within
 * the window keeps escalating + nagging even if its `nextReminderAt` drifted.
 */
async function runDailyDeadlines(now: Date = new Date()): Promise<void> {
	try {
		const ensured = await ensureMatterSolDeadlines();
		SystemLogger.debug({ msg: 'boards.matters.cron.ensureSol', ...ensured });
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.matters.cron.ensureSol.failed', err });
	}

	try {
		const tick = await runDeadlineTick(now);
		SystemLogger.debug({ msg: 'boards.matters.cron.deadlineTick', ...tick });
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.matters.cron.deadlineTick.failed', err });
	}

	try {
		const watched = await runSolWatch(now);
		SystemLogger.debug({ msg: 'boards.matters.cron.solWatch', watched });
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.matters.cron.solWatch.failed', err });
	}

	try {
		const reconciled = await runReconcileSweep(now);
		SystemLogger.debug({ msg: 'boards.matters.cron.reconcileSweep', ...reconciled });
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.matters.cron.reconcileSweep.failed', err });
	}
}

/**
 * SOL backstop: ensure every matter card carries a SOL deadline derived from its
 * cached MatterSnapshot. `refreshMatterSnapshot()` arms SOL on bind + manual refresh,
 * but a matter bound before that seam (or never re-refreshed) would otherwise have NO
 * SOL deadline at all — defeating the no-missed-SOL guardrail. This daily sweep closes
 * that gap using ONLY the cached snapshot (no CasePro load). `ensureSolDeadlineForMatter`
 * is idempotent (refreshes in place / returns existing) and never fabricates a date, so
 * matters with no usable SOL source are simply skipped. Best-effort per card.
 */
async function ensureMatterSolDeadlines(): Promise<{ scanned: number; ensured: number }> {
	let scanned = 0;
	let ensured = 0;
	const boards = await Boards.findByPipelineType('matters').toArray();
	for (const board of boards) {
		if (board.archived) {
			continue;
		}
		const cards = await BoardsCards.findByBoard(board._id).toArray();
		for (const card of cards) {
			if (card.cardType !== 'matter' || card.archived || card.link?.kind !== 'matter' || !card.link.snapshot) {
				continue;
			}
			scanned += 1;
			try {
				const deadline = await ensureSolDeadlineForMatter('system', card, card.link.snapshot);
				if (deadline) {
					ensured += 1;
				}
			} catch {
				// best-effort per card; refreshMatterSnapshot() is the primary SOL seam.
			}
		}
	}
	return { scanned, ensured };
}

/**
 * SOL watch: for every unacknowledged high-risk deadline due within the window (or
 * overdue), force its `nextReminderAt` to now so the next tick re-nags, and record a
 * watch signal on the card's activity feed. Returns the number watched. Degrades
 * gracefully (per-deadline failures are swallowed). TODO(M8): escalate to a supervisor
 * inbox when an SOL stays unacknowledged past the innermost tier.
 */
async function runSolWatch(now: Date): Promise<number> {
	const horizon = new Date(now.getTime() + SOL_WATCH_WINDOW_DAYS * DAY_MS);
	const highRisk = await BoardsDeadlines.findUnacknowledgedHighRisk().toArray();

	let watched = 0;
	for (const d of highRisk) {
		if (d.dueDate > horizon) {
			continue; // still outside the watch window
		}
		try {
			const daysOut = Math.floor((d.dueDate.getTime() - now.getTime()) / DAY_MS);
			// re-arm the reminder so the tick re-nags this unacknowledged high-risk deadline.
			await BoardsDeadlines.bumpEscalation(d._id, d.escalationLevel, now, now);
			await BoardsActivities.log({
				boardId: d.boardId,
				cardId: d.cardId,
				actor: 'casepro:sync',
				verb: 'field.changed',
				to: { solWatch: d._id, kind: d.kind, daysOut, unacknowledged: true, highRisk: true },
				ts: now,
			});
			watched += 1;
		} catch {
			// best-effort per deadline.
		}
	}
	return watched;
}

// ---------------------------------------------------------------------------
// 3. Weekly stuck-matter sweep
// ---------------------------------------------------------------------------

/**
 * Weekly: scan every matters-pipeline board for matter cards idle in their current
 * stage beyond the stuck threshold and record a `field.changed` stuck-flag activity.
 * Board-wide and uid-free: iterates the boards directly. Best-effort throughout.
 */
async function runStuckMatterSweep(now: Date = new Date()): Promise<void> {
	try {
		const boards = await Boards.findByPipelineType('matters').toArray();
		for (const board of boards) {
			if (board.archived) {
				continue;
			}
			const lists = await BoardsLists.findByBoard(board._id).toArray();
			const listTitleById = new Map(lists.map((l) => [l._id, l.title]));
			const cards = await BoardsCards.findByBoard(board._id).toArray();

			for (const card of cards) {
				if (card.cardType !== 'matter' || card.archived || card.link?.kind !== 'matter') {
					continue;
				}
				const age = await daysInStage(card._id, card.listId, card.createdAt, now);
				if (age <= STUCK_MATTER_DAYS) {
					continue;
				}
				await BoardsActivities.log({
					boardId: board._id,
					listId: card.listId,
					cardId: card._id,
					actor: 'casepro:sync',
					verb: 'field.changed',
					to: {
						stuckMatter: card._id,
						matterId: card.link.matterId,
						stageName: listTitleById.get(card.listId) ?? card.listId,
						daysInStage: age,
						assignees: card.assignees ?? [],
					},
					ts: now,
				});
			}
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.matters.cron.stuckSweep.failed', err });
	}
}

// ---------------------------------------------------------------------------
// 4. Daily reconcile sweep (snapshot stage vs board column drift)
// ---------------------------------------------------------------------------

/**
 * Daily: detect matter cards whose CACHED snapshot's CasePro stage no longer matches
 * the board column the card sits in, and flag them stale so the UI can surface a
 * reconcile prompt (master plan M5 "reconcile sweep"; mirrors the M3a write-back
 * conflict guard, but as a periodic backstop for drift that happened in CasePro
 * directly — e.g. an attorney advanced the stage in the CRM, not on the board).
 *
 * Uses ONLY the cached snapshot (no CasePro load) per the cron's no-context rule — the
 * snapshot freshness itself is `boardsCaseProSnapshotCron`'s job (the periodic sweep in
 * `cron/boardsCaseProSnapshotCron.ts` that re-pulls every matter-bound card's snapshot);
 * this sweep just compares the two stages we already have on hand. Drift = the snapshot's stage id/name differs
 * from the card's list (matched by `caseproStageId` first, then normalized title).
 *
 * On drift it sets `link.snapshot.stale = true` and logs a `field.changed` reconcile
 * activity carrying both stages. Already-stale snapshots are re-logged at most once per
 * sweep but not re-flagged. Best-effort per card; never throws.
 */
async function runReconcileSweep(now: Date = new Date()): Promise<{ scanned: number; drifted: number }> {
	let scanned = 0;
	let drifted = 0;
	try {
		const boards = await Boards.findByPipelineType('matters').toArray();
		for (const board of boards) {
			if (board.archived) {
				continue;
			}
			const lists = await BoardsLists.findByBoard(board._id).toArray();
			const listById = new Map(lists.map((l) => [l._id, l]));
			const cards = await BoardsCards.findByBoard(board._id).toArray();

			for (const card of cards) {
				if (card.cardType !== 'matter' || card.archived || card.link?.kind !== 'matter') {
					continue;
				}
				const snapshot = card.link.snapshot;
				if (!snapshot) {
					continue; // nothing cached to compare against yet.
				}
				scanned += 1;

				const list = listById.get(card.listId);
				if (!list) {
					continue;
				}

				// drift: prefer a stage-id comparison (authoritative), else compare names.
				const idsKnown = Boolean(snapshot.stageId) && Boolean(list.caseproStageId);
				const drift = idsKnown
					? snapshot.stageId !== list.caseproStageId
					: Boolean(snapshot.stageName) && normalizeStageName(snapshot.stageName ?? '') !== normalizeStageName(list.title);

				if (!drift) {
					continue;
				}
				drifted += 1;

				try {
					// flag the cached snapshot stale (idempotent) so the card UI can prompt a
					// reconcile/refresh; never fabricate a stage move here.
					if (!snapshot.stale) {
						await BoardsCards.updateOne({ _id: card._id }, { $set: { 'link.snapshot.stale': true } });
					}
					await BoardsActivities.log({
						boardId: board._id,
						listId: card.listId,
						cardId: card._id,
						actor: 'casepro:sync',
						verb: 'field.changed',
						to: {
							reconcileDrift: card._id,
							matterId: card.link.matterId,
							boardStage: list.title,
							caseproStage: snapshot.stageName ?? snapshot.stageId,
						},
						ts: now,
					});
				} catch {
					// best-effort per card.
				}
			}
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.matters.cron.reconcileSweep.failed', err });
	}
	return { scanned, drifted };
}

/**
 * Days a card has spent in its current list, from the most recent `card.moved` into
 * that list (or createdAt). Mirrors reports.daysInStage but uid-free for the cron.
 */
async function daysInStage(cardId: string, listId: string, createdAt: Date, now: Date): Promise<number> {
	let since = createdAt;
	try {
		const activities = await BoardsActivities.findByCard(cardId, { limit: 50 }).toArray();
		const lastMove = activities.find(
			(a) => a.verb === 'card.moved' && (a.to as { listId?: string } | undefined)?.listId === listId,
		);
		if (lastMove?.ts) {
			since = lastMove.ts;
		}
	} catch {
		// fall back to createdAt
	}
	return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS));
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Register the matters-depth cron jobs. Mirrors the existing cron registrations
 * (e.g. `videoConferencesCron`): a daily deadline/SOL job and a weekly stuck-matter
 * sweep. Called from `cron/start.ts`.
 */
export async function boardsMattersCron(): Promise<void> {
	// daily at 06:00 — SOL watch + deadline reminders
	await cronJobs.add('BoardsMattersDeadlines', '0 6 * * *', async () => runDailyDeadlines());
	// weekly Monday at 07:00 — stuck-matter sweep
	await cronJobs.add('BoardsMattersStuckSweep', '0 7 * * 1', async () => runStuckMatterSweep());
}
