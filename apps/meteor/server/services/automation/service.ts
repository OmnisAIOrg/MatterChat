import { ServiceClassInternal } from '@rocket.chat/core-services';
import type { IAutomation, BoardAutomationTriggerEvent } from '@rocket.chat/core-typings';
import { BoardsAutomationRuns } from '@rocket.chat/models';

import { settings } from '../../settings';
import { SystemLogger } from '../../lib/logger/system';
import type { LoopGuardState } from './context';
import { childLoopState } from './context';
import { dispatchEvent, runOne } from './dispatcher';
import { runScheduledTick } from './scheduled';

/**
 * The automation engine service (M7 — 05-automation-engine.md §4). A `ServiceClassInternal`
 * named `boards-automation` (master plan §B M7), giving the engine a lifecycle shell that
 * registers alongside Banner/NPS. The runtime API is exposed both as instance methods AND
 * as a module singleton ({@link Automation}) so the in-process callers — the event seam
 * (`emitBoardEvent`), the cron tick, and the REST routes — invoke it by direct import (no
 * proxy round-trip needed in the monolith), while the service registration keeps it
 * symmetric with the other core services.
 *
 * Everything funnels the loop-guard state through: a re-emit from a running action passes
 * `childLoopState(parent)` so depth + action budget keep accumulating across the cascade.
 */

function engineEnabled(): boolean {
	try {
		return settings.get('Boards_Automation_Enabled') === true;
	} catch {
		return false;
	}
}

export class AutomationEngineService extends ServiceClassInternal {
	protected name = 'boards-automation';

	/**
	 * The event sink. Sibling subsystems call this (via the `emitBoardEvent` seam) after
	 * they mutate state + write their audit row. Fire-and-forget: matches + enqueues, never
	 * blocks the caller. `parentLoop` is passed only by an engine re-emit (cascade child).
	 *
	 * NB: named `dispatch` (not `emit`) on purpose — `ServiceClassInternal` reserves `emit`
	 * for the inter-service event bus (`emit<T extends keyof EventSignatures>(event, ...args)`),
	 * so the engine's domain event-sink must not shadow it.
	 */
	async dispatch(
		boardId: string,
		event: BoardAutomationTriggerEvent,
		payload: Record<string, unknown>,
		parentLoop?: LoopGuardState,
	): Promise<void> {
		if (!engineEnabled()) {
			return;
		}
		const loop = parentLoop ? childLoopState(parentLoop) : undefined;
		await dispatchEvent(boardId, event, payload, loop);
	}

	/** Run a card/board button (or a REST `run`) now; awaits the per-action results. */
	async runButton(automation: IAutomation, opts: { actor: string; cardId?: string; leadId?: string }) {
		return runOne(automation, opts);
	}

	/** Dry-run an automation (editor preview / REST `dryRun`): plans, never mutates. */
	async dryRun(automation: IAutomation, opts: { actor: string; cardId?: string; leadId?: string }) {
		return runOne(automation, { ...opts, dryRun: true });
	}

	/**
	 * The per-minute master tick (driven by the cron): scheduled automations + synthesized
	 * due/overdue events + due drip-sequence steps. Honors the scheduling kill switch.
	 */
	async tick(now: Date = new Date()): Promise<void> {
		if (!engineEnabled()) {
			return;
		}
		try {
			await runScheduledTick(now);
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.automation.tick.failed', err });
		}
	}

	/** Prune run-log rows older than the retention window (driven by the daily cron). */
	async pruneRuns(now: Date = new Date()): Promise<number> {
		try {
			const days = Number(settings.get('Boards_Automation_Run_Retention_Days')) || 90;
			const before = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
			const { deletedCount } = await BoardsAutomationRuns.pruneOlderThan(before);
			return deletedCount ?? 0;
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.automation.prune.failed', err });
			return 0;
		}
	}
}

/**
 * Module singleton — the in-process handle the seam/cron/REST import directly. (The
 * service registration in `services/startup.ts` constructs its own instance for the core-
 * services lifecycle; this one is the cheap direct-call surface for the monolith.)
 */
export const Automation = new AutomationEngineService();
