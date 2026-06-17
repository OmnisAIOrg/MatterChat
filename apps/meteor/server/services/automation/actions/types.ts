import type { IAutomationAction, IAutomationActionResult, BoardAutomationActionType } from '@rocket.chat/core-typings';

import type { AutomationContext } from '../context';

/**
 * Action-handler contract (M7 — 05-automation-engine.md §4.4 / §5.3). The runner
 * dispatches the interpolated action to the registry handler for its `type`. A handler
 * NEVER throws — it returns an {@link IAutomationActionResult} (the runner records it on
 * the run doc and keeps going, unless the action is `critical`). Mutating handlers honor
 * `ctx.dryRun` (plan-only). Handlers reuse the M1/M5/M6 services so every write still
 * runs the canonical permission gate → model write → audit → re-emit path.
 */

/** A single handler. `index` is the action's position in `automation.actions[]`. */
export type ActionHandler<A extends IAutomationAction = IAutomationAction> = (
	action: A,
	ctx: AutomationContext,
	index: number,
) => Promise<IAutomationActionResult>;

/** Build an `ok` result. `detail` is the human run-log summary (e.g. "moved Intake → Treating"). */
export function ok(index: number, type: BoardAutomationActionType, detail?: string, extra?: Partial<IAutomationActionResult>): IAutomationActionResult {
	return { index, type, ok: true, status: 'ok', ...(detail ? { detail } : {}), ...extra };
}

/** Build a `skipped` result with a reason (loop-depth / per-card-budget / writeback-disabled / disabled / condition / unsupported). */
export function skipped(
	index: number,
	type: BoardAutomationActionType,
	skippedReason: IAutomationActionResult['skippedReason'],
	detail?: string,
): IAutomationActionResult {
	return { index, type, ok: false, status: 'skipped', skippedReason, ...(detail ? { detail } : {}) };
}

/** Build an `error` result from a caught value (handlers swallow + report, never rethrow). */
export function errored(index: number, type: BoardAutomationActionType, err: unknown): IAutomationActionResult {
	const message = err instanceof Error ? err.message : String(err);
	return { index, type, ok: false, status: 'error', error: message };
}

/** A dry-run plan result: records what WOULD happen without mutating. */
export function planned(index: number, type: BoardAutomationActionType, detail: string): IAutomationActionResult {
	return { index, type, ok: true, status: 'ok', detail: `[dry-run] ${detail}` };
}
