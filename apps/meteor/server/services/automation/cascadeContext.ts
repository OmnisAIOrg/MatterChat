import { AsyncLocalStorage } from 'node:async_hooks';

import type { LoopGuardState } from './context';

/**
 * Cascade context (M7 loop-guard plumbing). An action handler that mutates a card calls
 * the SAME M1/M5/M6 service mutators (`moveCard`, `updateCard`, …), which fire
 * `emitBoardEvent(...)` — re-entering the engine. To make the loop guard (depth + action
 * budget + re-entry set) span that re-entry WITHOUT editing the mutator services, the
 * runner executes each automation inside `withCascade(loop, fn)`, and the event seam reads
 * the ambient loop via `currentCascadeLoop()` to thread it as the child cascade's parent.
 *
 * `AsyncLocalStorage` is the right tool: `emitBoardEvent` runs synchronously within the
 * awaited mutator call that the runner invoked, so it inherits the store. Outside a run
 * (a user-initiated mutation), the store is undefined and the dispatch starts a fresh
 * root cascade — exactly the intended behavior.
 */

const storage = new AsyncLocalStorage<LoopGuardState>();

/** Run `fn` with `loop` as the ambient cascade state (so nested re-emits inherit it). */
export function withCascade<T>(loop: LoopGuardState, fn: () => Promise<T>): Promise<T> {
	return storage.run(loop, fn);
}

/** The ambient cascade loop state, or undefined when not inside an automation run. */
export function currentCascadeLoop(): LoopGuardState | undefined {
	return storage.getStore();
}
