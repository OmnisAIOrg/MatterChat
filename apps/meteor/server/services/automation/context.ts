import type { IAutomation, IBoardCard, ILead, IMatterSnapshot, BoardAutomationTriggerEvent } from '@rocket.chat/core-typings';

/**
 * Shared engine types (M7 — 05-automation-engine.md §4). The dispatcher builds an
 * `AutomationContext`, the queue serializes it per board, the runner evaluates
 * conditions + runs actions against it, the action handlers read it, and the loop
 * guard threads its mutable counters through any re-emit.
 *
 * core-typings owns the durable doc shapes (`IAutomation`, `IAutomationRun`); these
 * are the *runtime-only* structures that never persist, so they live with the engine.
 */

/** What kicked off this run — the event name, the `schedule` tick, or a manual button/REST run. */
export type AutomationFireSource = BoardAutomationTriggerEvent | 'schedule' | 'manual';

/**
 * The subject an automation acts on, resolved once by the dispatcher and reused by
 * conditions / interpolation / actions so we never re-load the card or lead per step.
 * Everything is optional: a board-button or a pure-schedule run may have no subject,
 * and a lead-domain rule may have a lead but no card (un-carded lead).
 */
export interface AutomationSubject {
	boardId: string;
	card?: IBoardCard;
	lead?: ILead;
	/** CasePro render cache for matter cards — taken ONLY from the card link (never a live load here). */
	snapshot?: IMatterSnapshot;
}

/**
 * Loop-guard accounting threaded through a whole cascade (root run → any re-emitted
 * events it triggers). `rootRunId` ties cascade children to the run that spawned them
 * for the run-log; `depth` caps A→B→A re-trigger chains; `actionsRunInRoot` caps the
 * total action work one cascade may do; `firedAutomationIds` blocks an automation from
 * re-entering its own cascade (the cheapest oscillation guard).
 */
export interface LoopGuardState {
	depth: number;
	rootRunId?: string;
	actionsRunInRoot: number;
	firedAutomationIds: Set<string>;
}

/**
 * Everything the runner + handlers need for one automation execution. `dryRun` flips
 * every mutating handler into plan-only mode (integration actions still `validate` but
 * never `execute`) for the editor preview / `boards.automations.dryRun`.
 */
export interface AutomationContext {
	automation: IAutomation;
	boardId: string;
	/** event that fired a rule, or 'schedule' / 'manual'. */
	event: AutomationFireSource;
	/** raw event payload (filters already matched by the dispatcher) — handlers may read extra keys. */
	payload?: Record<string, unknown>;
	subject: AutomationSubject;
	/** user _id | 'system' (cron) | 'automation:<id>' (cascade child). */
	actor: string;
	dryRun: boolean;
	loop: LoopGuardState;
}

/** Make a fresh root loop-guard state for a top-of-cascade run. */
export function rootLoopState(): LoopGuardState {
	return { depth: 0, actionsRunInRoot: 0, firedAutomationIds: new Set<string>() };
}

/** Derive a child loop-guard state for a re-emitted event (depth+1, same counters/set). */
export function childLoopState(parent: LoopGuardState): LoopGuardState {
	return {
		depth: parent.depth + 1,
		...(parent.rootRunId ? { rootRunId: parent.rootRunId } : {}),
		actionsRunInRoot: parent.actionsRunInRoot,
		firedAutomationIds: parent.firedAutomationIds,
	};
}
