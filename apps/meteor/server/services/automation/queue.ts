import { SystemLogger } from '../../lib/logger/system';

/**
 * Per-board serialized FIFO (M7 — 05-automation-engine.md §4.2 "serialized per board").
 * An in-process `Map<boardId, Promise>` where each `enqueue` chains its task onto the
 * board's tail promise, so two events on the same board never interleave their action
 * lists (which would race the card state the conditions/actions read). Different boards
 * run concurrently — the map keys isolate them.
 *
 * A task failure is swallowed (logged) so it can never break the chain for the next task
 * on that board. The tail entry is cleaned up once the chain drains, to avoid unbounded
 * Map growth on long-lived boards.
 *
 * NOTE (open question §14.1): this is single-node. For a multi-instance MatterChat the
 * chain becomes a Mongo advisory lock keyed by boardId; the call sites stay identical.
 */

const chains = new Map<string, Promise<void>>();

/**
 * Enqueue `task` onto `boardId`'s serial chain. Resolves when THIS task completes (so the
 * caller can await its own work), while the chain advances for the next enqueue. Errors
 * are isolated per task.
 */
export function enqueue(boardId: string, task: () => Promise<void>): Promise<void> {
	const tail = chains.get(boardId) ?? Promise.resolve();

	const run = tail.then(async () => {
		try {
			await task();
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.automation.queue.taskFailed', boardId, err });
		}
	});

	// advance the chain; clean up the map entry once this is the last task to drain.
	chains.set(boardId, run);
	void run.finally(() => {
		if (chains.get(boardId) === run) {
			chains.delete(boardId);
		}
	});

	return run;
}

/** Current number of boards with an in-flight chain (diagnostics / tests). */
export function activeBoardCount(): number {
	return chains.size;
}
