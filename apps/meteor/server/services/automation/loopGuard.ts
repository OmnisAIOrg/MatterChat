import { BoardsAutomationRuns } from '@rocket.chat/models';

import { settings } from '../../settings';
import type { AutomationContext, LoopGuardState } from './context';

/**
 * Loop guard (M7 — 05-automation-engine.md §4.3). Three independent guards keep an
 * engine-emitted mutation from infinitely re-triggering other automations:
 *
 *  1. Cascade depth   — `Boards_Automation_Max_Depth` (default 5): how many levels an
 *     automation may re-trigger others before further re-emits are skipped.
 *  2. Action budget   — `Boards_Automation_Action_Budget` (default 50): the max actions a
 *     single run may execute before the remainder are skipped.
 *  3. Daily run cap   — `Boards_Automation_Daily_Run_Cap` (default 5000) per board per
 *     day: a runaway-board backstop checked before a root run is admitted.
 *
 * Plus a per-cascade re-entry guard: an automation that already fired in the current
 * cascade is blocked from firing again (the cheapest A→B→A oscillation stop). These read
 * settings live so an admin can tighten them without a redeploy; each getter degrades to
 * its default if the setting is unreadable.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function intSetting(id: string, fallback: number): number {
	try {
		const v = Number(settings.get(id));
		return Number.isFinite(v) && v >= 0 ? v : fallback;
	} catch {
		return fallback;
	}
}

export function maxDepth(): number {
	return intSetting('Boards_Automation_Max_Depth', 5);
}

export function actionBudget(): number {
	return intSetting('Boards_Automation_Action_Budget', 50);
}

export function dailyRunCap(): number {
	return intSetting('Boards_Automation_Daily_Run_Cap', 5000);
}

/** True once the cascade has reached the configured depth cap (further re-emits are skipped). */
export function atDepthCap(loop: LoopGuardState): boolean {
	return loop.depth >= maxDepth();
}

/** True once this run has spent its whole action budget (remaining actions are skipped). */
export function atActionBudget(loop: LoopGuardState): boolean {
	return loop.actionsRunInRoot >= actionBudget();
}

/** Account one executed action against the per-cascade budget. */
export function chargeAction(loop: LoopGuardState): void {
	loop.actionsRunInRoot += 1;
}

/**
 * Re-entry guard: an automation may fire at most once per cascade. Returns false (and
 * does not mark) if it already fired; otherwise marks it fired and returns true.
 */
export function admitAutomation(loop: LoopGuardState, automationId: string): boolean {
	if (loop.firedAutomationIds.has(automationId)) {
		return false;
	}
	loop.firedAutomationIds.add(automationId);
	return true;
}

/**
 * Daily-cap gate for a root run on a board. Counts today's runs for the board against the
 * cap; true => admit. Best-effort: a counting failure admits the run (we never block real
 * work on a guard read error). A cap of 0 disables the guard (always admit).
 */
export async function withinDailyCap(boardId: string, now: Date = new Date()): Promise<boolean> {
	const cap = dailyRunCap();
	if (cap <= 0) {
		return true;
	}
	try {
		const since = new Date(now.getTime() - DAY_MS);
		const count = await BoardsAutomationRuns.countByRootSince(boardId, since);
		return count < cap;
	} catch {
		return true;
	}
}

/**
 * Whether a re-emitted event is allowed to spawn another cascade level. The dispatcher
 * calls this before fanning a re-emit into the engine: it must be below the depth cap.
 */
export function canCascade(ctx: AutomationContext): boolean {
	return !atDepthCap(ctx.loop);
}
