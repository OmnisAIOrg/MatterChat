import { cronJobs } from '@rocket.chat/cron';
import { Boards, BoardsCards } from '@rocket.chat/models';

import { settings } from '../settings';
import * as caseProLib from '../lib/boards/casepro';
import { refreshMatterSnapshot } from '../lib/boards/matters/service';
import { SystemLogger } from '../lib/logger/system';

/**
 * CasePro SNAPSHOT-REFRESH cron.
 *
 * Matter cards carry `link.snapshot` (IMatterSnapshot) — a read-through cache of
 * CasePro that, before this cron, was refreshed only on bind, the manual per-card
 * refresh button, or a REST call. Everything downstream (the daily reconcile sweep,
 * SOL backstop, board tiles) consumes that CACHED snapshot, so it silently went stale.
 * This job is the periodic freshener: sweep every matter-bound card and re-pull its
 * snapshot via `refreshMatterSnapshot` (which also re-arms the SOL deadline and logs
 * the `casepro.snapshot.refreshed` activity — the exact same seam as a manual refresh).
 *
 * SCHEDULING (read-at-tick, fixed outer schedule): the job is registered once at a
 * fixed 5-minute cron tick and each tick decides whether a sweep is actually due.
 * The effective cadence comes from, in precedence order:
 *   1. env `CASEPRO_SNAPSHOT_REFRESH_MINUTES` (ops override),
 *   2. admin setting `CasePro_Snapshot_Refresh_Interval` (int minutes),
 *   3. default 30 — always clamped to a 5-minute floor.
 * A tick no-ops unless `intervalMinutes` have elapsed since the last sweep STARTED
 * (start-to-start cadence, with a 30s tolerance so a tick landing a hair early does
 * not slip the whole cadence by an outer-tick period). The interval is re-read on
 * every tick, so an admin change takes effect within one tick — no re-registration,
 * no redeploy. The anchor is seeded at registration, so the first sweep runs about
 * one interval after boot rather than hammering CasePro on every restart/deploy.
 *
 * GRACEFUL DEGRADE (the hard rule, mirroring `boardsDigestCron`):
 *   - The whole tick no-ops (logged at debug ONCE, not every 5 minutes) unless
 *     `caseProMode().enabled` is true. `caseProMode` is resolved defensively off the
 *     casepro barrel so this file compiles and boots even before that seam lands —
 *     an absent accessor degrades to disabled, never to an unguarded live sweep.
 *   - Cards refresh SEQUENTIALLY with a small delay between calls — this can hit a
 *     live HTTP API, so it must never fan out unbounded.
 *   - Per-card failures are caught, counted, and skipped: one bad matter must not
 *     kill the sweep. A single sweep is capped (excess cards logged + counted as
 *     skipped and picked up next sweep); overlapping sweeps are guarded against.
 *
 * Each run logs a compact summary (`boards.casepro.snapshotCron.swept`) and stashes
 * the same shape module-level, readable via the exported `lastCaseProSweep()` getter
 * (there is no boards KV/last-sync collection to persist into, so log + in-memory
 * getter is the findable surface for a status UI).
 *
 * Registered from `cron/start.ts` after the scheduler has a live driver, mirroring
 * `boardsMattersCron` / `automationEngineCron` / `boardsDigestCron`.
 */

const SWEEP_JOB = 'BoardsCaseProSnapshotRefresh';

/** Fixed outer tick — the finest cadence the interval setting can request (min 5). */
const OUTER_SCHEDULE = '*/5 * * * *';

/** Effective-interval bounds/default (Zone B setting: default 30, min 5). */
const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 5;

/** Tolerance so an outer tick landing marginally early still counts as "due". */
const DUE_TOLERANCE_MS = 30 * 1000;

/** Pause between per-card refreshes — each one may be a live CasePro HTTP call. */
const PER_CARD_DELAY_MS = 150;

/** Hard cap on cards refreshed in ONE sweep; the rest wait for the next sweep. */
const SWEEP_CARD_CAP = 500;

/** Actor recorded on refresh activities — matches the cron convention in boardsMattersCron. */
const SWEEP_ACTOR = 'casepro:sync';

const MINUTE_MS = 60 * 1000;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

// ---------------------------------------------------------------------------
// caseProMode gate (defensive seam)
// ---------------------------------------------------------------------------

type CaseProMode = { enabled: boolean; transport?: unknown };

/**
 * Resolve `caseProMode()` off the casepro barrel WITHOUT a hard named import: the
 * accessor is being added to `server/lib/boards/casepro` alongside this cron, and a
 * defensive lookup keeps this file compiling/booting independently of merge order.
 * Missing accessor (or a throwing one) degrades to DISABLED — the safe default for a
 * job whose whole purpose is calling out to a live API.
 */
function resolveCaseProMode(): CaseProMode {
	try {
		const accessor = (caseProLib as unknown as { caseProMode?: () => CaseProMode }).caseProMode;
		if (typeof accessor === 'function') {
			return accessor();
		}
	} catch {
		// fall through to disabled.
	}
	return { enabled: false };
}

// ---------------------------------------------------------------------------
// interval resolution (env → setting → default, clamped)
// ---------------------------------------------------------------------------

/** Effective refresh interval in minutes. Never throws; always >= MIN_INTERVAL_MINUTES. */
function refreshIntervalMinutes(): number {
	let minutes = NaN;

	const env = Number.parseInt(process.env.CASEPRO_SNAPSHOT_REFRESH_MINUTES ?? '', 10);
	if (Number.isFinite(env) && env > 0) {
		minutes = env;
	}

	if (!Number.isFinite(minutes)) {
		try {
			const fromSetting = settings.get<number>('CasePro_Snapshot_Refresh_Interval');
			if (typeof fromSetting === 'number' && Number.isFinite(fromSetting) && fromSetting > 0) {
				minutes = fromSetting;
			}
		} catch {
			// setting not registered (yet) — fall through to the default.
		}
	}

	if (!Number.isFinite(minutes)) {
		minutes = DEFAULT_INTERVAL_MINUTES;
	}
	return Math.max(MIN_INTERVAL_MINUTES, Math.floor(minutes));
}

// ---------------------------------------------------------------------------
// last-run stash (module-level; consumed via the exported getter)
// ---------------------------------------------------------------------------

export type CaseProSweepInfo = {
	startedAt: Date;
	finishedAt: Date;
	durationMs: number;
	/** matter-bound cards found by the scan (refreshed + failed + skipped). */
	scanned: number;
	/** snapshots successfully re-pulled from CasePro. */
	refreshed: number;
	/** per-card refresh errors (caught + continued). */
	failed: number;
	/** bound cards NOT attempted this sweep (beyond the per-sweep cap). */
	skipped: number;
	/** true when the sweep hit SWEEP_CARD_CAP. */
	capped: boolean;
	/** the effective interval (minutes) this sweep ran under. */
	intervalMinutes: number;
};

let lastSweep: CaseProSweepInfo | undefined;

/** Last completed sweep's summary (undefined until the first sweep after boot). */
export function lastCaseProSweep(): CaseProSweepInfo | undefined {
	return lastSweep ? { ...lastSweep } : undefined;
}

// ---------------------------------------------------------------------------
// the sweep
// ---------------------------------------------------------------------------

/**
 * One full refresh sweep. Collects every matter-bound card (same bound-card query the
 * matters cron uses: matters-pipeline boards → non-archived `cardType:'matter'` cards
 * with `link.kind === 'matter'`), then refreshes each SEQUENTIALLY with a small delay.
 * Best-effort per card; never throws.
 */
export async function runSnapshotRefreshSweep(intervalMinutes: number = refreshIntervalMinutes()): Promise<CaseProSweepInfo> {
	const startedAt = new Date();

	// collect the bound cards first (cheap, local) so the cap + counts are exact.
	const boundCardIds: string[] = [];
	try {
		const boards = await Boards.findByPipelineType('matters').toArray();
		for (const board of boards) {
			if (board.archived) {
				continue;
			}
			const cards = await BoardsCards.findByBoard(board._id).toArray();
			for (const card of cards) {
				if (card.cardType !== 'matter' || card.archived || card.link?.kind !== 'matter') {
					continue;
				}
				boundCardIds.push(card._id);
			}
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.casepro.snapshotCron.scanFailed', err });
	}

	const toRefresh = boundCardIds.slice(0, SWEEP_CARD_CAP);
	const skipped = boundCardIds.length - toRefresh.length;
	const capped = skipped > 0;
	if (capped) {
		SystemLogger.warn({
			msg: 'boards.casepro.snapshotCron.capped',
			cap: SWEEP_CARD_CAP,
			bound: boundCardIds.length,
			skipped,
		});
	}

	let refreshed = 0;
	let failed = 0;

	for (let i = 0; i < toRefresh.length; i++) {
		const cardId = toRefresh[i];
		try {
			await refreshMatterSnapshot(SWEEP_ACTOR, cardId);
			refreshed += 1;
		} catch (err) {
			// one bad matter must not kill the sweep — count it and move on.
			failed += 1;
			SystemLogger.debug({ msg: 'boards.casepro.snapshotCron.cardFailed', cardId, err });
		}
		if (i < toRefresh.length - 1) {
			// sequential + spaced: this may be a live HTTP API; never fan out unbounded.
			await sleep(PER_CARD_DELAY_MS);
		}
	}

	const finishedAt = new Date();
	const summary: CaseProSweepInfo = {
		startedAt,
		finishedAt,
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		scanned: boundCardIds.length,
		refreshed,
		failed,
		skipped,
		capped,
		intervalMinutes,
	};
	lastSweep = summary;
	SystemLogger.debug({
		msg: 'boards.casepro.snapshotCron.swept',
		refreshed,
		failed,
		skipped,
		scanned: summary.scanned,
		capped,
		durationMs: summary.durationMs,
		intervalMinutes,
	});
	return summary;
}

// ---------------------------------------------------------------------------
// the tick (gate → due-check → sweep)
// ---------------------------------------------------------------------------

/** Anchor for the start-to-start cadence; seeded at registration (see header note). */
let lastSweepStartedAt: Date = new Date();

/** Re-entrancy guard: a slow sweep must not overlap the next outer tick's sweep. */
let sweepInProgress = false;

/** Log the disabled-skip once per disabled stretch, not once per 5-minute tick. */
let loggedDisabledSkip = false;

async function onSweepTick(now: Date = new Date()): Promise<void> {
	if (!resolveCaseProMode().enabled) {
		if (!loggedDisabledSkip) {
			SystemLogger.debug({ msg: 'boards.casepro.snapshotCron.skipped', reason: 'casepro-disabled' });
			loggedDisabledSkip = true;
		}
		return;
	}
	loggedDisabledSkip = false;

	if (sweepInProgress) {
		SystemLogger.debug({ msg: 'boards.casepro.snapshotCron.skipped', reason: 'sweep-in-progress' });
		return;
	}

	const intervalMinutes = refreshIntervalMinutes();
	const elapsedMs = now.getTime() - lastSweepStartedAt.getTime();
	if (elapsedMs < intervalMinutes * MINUTE_MS - DUE_TOLERANCE_MS) {
		return; // not due yet — the interval is re-checked on the next outer tick.
	}

	sweepInProgress = true;
	lastSweepStartedAt = now;
	try {
		await runSnapshotRefreshSweep(intervalMinutes);
	} catch (err) {
		// runSnapshotRefreshSweep is best-effort internally; this is a belt-and-braces net.
		SystemLogger.warn({ msg: 'boards.casepro.snapshotCron.sweepFailed', err });
	} finally {
		sweepInProgress = false;
	}
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Register the snapshot-refresh cron: one fixed 5-minute tick whose handler applies
 * the caseProMode gate + interval due-check (read-at-tick — see the header). Called
 * from `cron/start.ts`, mirroring `boardsMattersCron`.
 */
export async function boardsCaseProSnapshotCron(): Promise<void> {
	lastSweepStartedAt = new Date(); // first sweep ~one interval after boot.
	await cronJobs.add(SWEEP_JOB, OUTER_SCHEDULE, async () => onSweepTick());
}
