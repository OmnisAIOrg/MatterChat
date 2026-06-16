import { SystemLogger } from '../logger/system';

/**
 * Automation seam. Every mutating board service calls this after it writes its
 * audit row. The automation engine (M7) will subscribe here; until then this is
 * a no-op that only debug-logs. Keeping the call sites in place now means M7
 * wires the runner without touching a single handler.
 *
 * The event name + payload shape ARE the contract M7 consumes — do not change
 * the signature lightly.
 */
export type BoardEventName =
	| 'board.created'
	| 'board.updated'
	| 'board.archived'
	| 'list.created'
	| 'list.updated'
	| 'list.moved'
	| 'list.archived'
	| 'card.created'
	| 'card.updated'
	| 'card.moved'
	| 'card.archived';

export type BoardEventPayload = {
	boardId: string;
	listId?: string;
	cardId?: string;
	actor: string;
	[key: string]: unknown;
};

export function emitBoardEvent(event: BoardEventName, payload: BoardEventPayload): void {
	// No-op automation seam (M7 replaces the body with a dispatch into the engine).
	SystemLogger.debug({ msg: 'boards.event', event, payload });
}
