import type { IAutomation, IAutomationActionResult, IAutomationRun, AutomationRunStatus } from '@rocket.chat/core-typings';
import { BoardsAutomations, BoardsAutomationRuns, BoardsActivities } from '@rocket.chat/models';

import { SystemLogger } from '../../lib/logger/system';
import { runAction } from './actions';
import { withCascade } from './cascadeContext';
import { evaluateConditions } from './conditions';
import type { AutomationContext } from './context';
import { interpolateParams } from './interpolate';
import { atActionBudget, chargeAction } from './loopGuard';
import { skipped } from './actions/types';

/**
 * The runner (M7 — 05-automation-engine.md §4.4). Executes ONE automation against a
 * prepared {@link AutomationContext}: re-check the conditions (board state may have moved
 * since enqueue) → interpolate + run each action through the registry, charging the
 * loop-guard action budget → write a `boards_automation_runs` row → roll up the
 * automation's runCount/lastRunAt (or lastError) → append a machine `boards_activities`
 * line. The run rolls up to `ok` (all actions ok), `partial` (some ok + some errored),
 * `error` (all errored), or `skipped` (nothing ran). NEVER throws: any unexpected engine
 * error is captured as the run's top-level `error` and the run finishes `error` rather
 * than propagating into the caller/queue.
 *
 * `ctx.dryRun` runs the whole pipeline without mutating (handlers plan only) and writes a
 * `status:'dry-run'` row — that backs the editor preview and `boards.automations.dryRun`.
 */

export type RunAutomationResult = {
	runId: string;
	status: AutomationRunStatus;
	actionsRun: IAutomationActionResult[];
};

/** Roll the per-action statuses up into the run-level status. */
function rollupStatus(results: IAutomationActionResult[], dryRun: boolean): AutomationRunStatus {
	if (dryRun) {
		return 'dry-run';
	}
	if (results.length === 0) {
		return 'ok';
	}
	const anyError = results.some((r) => r.status === 'error');
	const anyOk = results.some((r) => r.status === 'ok');
	if (anyError && anyOk) {
		return 'partial'; // some actions succeeded, some errored — surfaced as its own status (M7 LOW)
	}
	if (anyError) {
		return 'error';
	}
	const allSkipped = results.every((r) => r.status === 'skipped');
	return allSkipped ? 'skipped' : 'ok';
}

export async function runAutomation(automation: IAutomation, ctx: AutomationContext): Promise<RunAutomationResult> {
	const startedAt = new Date();
	const actionsRun: IAutomationActionResult[] = [];
	let topError: string | undefined;

	try {
		// disabled guard (it may have been toggled off between enqueue and run).
		if (!automation.enabled) {
			actionsRun.push(skipped(0, automation.actions[0]?.type ?? 'comment', 'disabled', 'automation disabled'));
		} else {
			// re-check conditions against the (possibly changed) live subject.
			const pass = await evaluateConditions(automation.conditions, ctx.subject, startedAt);
			if (!pass) {
				actionsRun.push(skipped(0, automation.actions[0]?.type ?? 'comment', 'condition', 'conditions not met at run time'));
			} else {
				// Run inside the cascade context so any re-emit a mutating action triggers
				// (its M1 service calls `emitBoardEvent`) inherits THIS loop state — that is
				// what makes the depth/budget/re-entry guards span the cascade (cascadeContext.ts).
				await withCascade(ctx.loop, async () => {
					// run each action, charging the per-cascade action budget.
					for (let i = 0; i < automation.actions.length; i++) {
						const action = automation.actions[i];
						if (!ctx.dryRun && atActionBudget(ctx.loop)) {
							actionsRun.push(skipped(i, action.type, 'per-card-budget', 'action budget exhausted for this cascade'));
							continue;
						}
						// interpolate {{tokens}} in the action params against the subject.
						const { value: interpolated, missing } = interpolateParams(action, ctx);
						// eslint-disable-next-line no-await-in-loop
						const result = await runAction(interpolated, ctx, i);
						if (missing.length && result.status === 'ok') {
							result.detail = `${result.detail ?? ''}${result.detail ? ' ' : ''}(unresolved: ${missing.join(', ')})`.trim();
						}
						if (!ctx.dryRun && result.status === 'ok') {
							chargeAction(ctx.loop);
						}
						actionsRun.push(result);
						// a critical action that errored aborts the remaining actions.
						if (action.critical && result.status === 'error') {
							break;
						}
					}
				});
			}
		}
	} catch (err) {
		topError = err instanceof Error ? err.message : String(err);
		SystemLogger.warn({ msg: 'boards.automation.run.failed', automationId: automation._id, err });
	}

	const finishedAt = new Date();
	const status = topError ? 'error' : rollupStatus(actionsRun, ctx.dryRun);

	// write the run journal row.
	const runDoc: Omit<IAutomationRun, '_id' | '_updatedAt'> = {
		automationId: automation._id,
		...(automation.name ? { automationName: automation.name } : {}),
		...(ctx.boardId ? { boardId: ctx.boardId } : {}),
		...(automation.kind ? { kind: automation.kind } : {}),
		event: ctx.event,
		...(ctx.subject.card ? { cardId: ctx.subject.card._id } : {}),
		...(ctx.subject.lead ? { leadId: ctx.subject.lead._id } : {}),
		actor: ctx.actor,
		status,
		loopDepth: ctx.loop.depth,
		startedAt,
		finishedAt,
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		actionsRun,
		...(topError ? { error: topError } : {}),
	};

	let runId = '';
	try {
		runId = await BoardsAutomationRuns.logRun(runDoc);
		// seed the cascade's rootRunId from the first (top-level) run.
		if (!ctx.loop.rootRunId) {
			ctx.loop.rootRunId = runId;
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.automation.run.logFailed', automationId: automation._id, err });
	}

	// roll up the automation rollups + a machine activity line (skip for dry-run).
	if (!ctx.dryRun) {
		try {
			if (topError) {
				await BoardsAutomations.setError(automation._id, topError, finishedAt);
			} else if (status !== 'skipped') {
				await BoardsAutomations.incRunCount(automation._id, finishedAt);
			}
		} catch {
			// rollup is best-effort.
		}
		try {
			await BoardsActivities.log({
				boardId: ctx.boardId,
				...(ctx.subject.card ? { cardId: ctx.subject.card._id } : {}),
				actor: `automation:${automation._id}`,
				verb: 'automation.ran',
				to: { automationRan: automation._id, name: automation.name, status, actions: actionsRun.length, runId },
				ts: finishedAt,
			});
		} catch {
			// audit line is best-effort.
		}
	}

	return { runId, status, actionsRun };
}
