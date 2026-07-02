import type { BoardAutomationTriggerEvent } from '@rocket.chat/core-typings';

import { SystemLogger } from '../logger/system';

/**
 * Automation seam. Every mutating board service calls this after it writes its
 * audit row. The automation engine (M7) subscribes here: `emitBoardEvent` dispatches
 * the event into the engine (fire-and-forget), guarded by the master kill switch.
 * Keeping the call sites in place since M1 meant M7 wired the runner without touching
 * a single handler.
 *
 * The event name + payload shape ARE the contract M7 consumes — do not change
 * the signature lightly.
 */
/**
 * The event vocabulary the automation engine (M7) consumes. Three bands:
 *
 *  1. Low-level board/list/card lifecycle — already emitted by the core service
 *     (service.ts) and the leads service since M1/M3.
 *  2. Card-detail mutations (label/member/due/checklist/comment/field) — emitted
 *     by the card mutators (the M7 Emit-wiring phase adds these emit calls).
 *  3. Higher-level domain events (matter stage change, lead lifecycle, deadlines)
 *     — emitted by the M5/M6 matter & lead mutators (also the Emit-wiring phase).
 *
 * Plus three synthetic events the engine's own cron synthesizes (never emitted by
 * a caller): `deadline.due` (a tracked deadline reached its reminder window),
 * `card.dueSoon` / `card.overdue` (a card's own dueDate). They share this union so
 * the rule matcher and the builder are typed against one vocabulary.
 *
 * Each name + its payload IS the contract M7 dispatches on and the wiring phase
 * emits — keep the names stable.
 */
export type BoardEventName =
	// --- board / list / card lifecycle (emitted today) ---
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
	| 'card.archived'
	| 'card.deleted'
	// --- card-detail mutations (Emit-wiring phase) ---
	| 'card.subStatusChanged'
	| 'card.converted'
	| 'card.commented'
	| 'label.added'
	| 'label.removed'
	| 'member.added'
	| 'member.removed'
	| 'due.set'
	| 'due.completed'
	| 'checklist.itemChecked'
	| 'checklist.completed'
	| 'field.changed'
	// --- matter domain (M5 mutators) ---
	| 'matter.stageChanged'
	| 'matter.snapshotRefreshed'
	| 'casepro.stageChanged'
	// --- lead domain (M6 mutators) ---
	| 'lead.captured'
	| 'lead.statusChanged'
	| 'lead.qualified'
	| 'lead.disqualified'
	| 'lead.lost'
	| 'lead.converted'
	| 'lead.contacted'
	| 'lead.responded'
	| 'lead.noContact'
	// --- deadlines (M5 deadline engine + cron-synthesized due) ---
	| 'deadline.created'
	| 'deadline.due'
	| 'deadline.acknowledged'
	| 'deadline.satisfied'
	// --- cron-synthesized card-date events ---
	| 'card.dueSoon'
	| 'card.overdue'
	// --- scheduled-automation pseudo-event (kind:'scheduled' trigger) ---
	| 'schedule';

export type BoardEventPayload = {
	boardId: string;
	listId?: string;
	cardId?: string;
	actor: string;
	[key: string]: unknown;
};

/**
 * Board/list lifecycle + snapshot/satisfied events have no card subject and are NOT in
 * the automation trigger vocabulary (`BoardAutomationTriggerEvent`) — they are emitted for
 * future consumers but are never dispatched into the rule engine. Everything else maps
 * 1:1 onto a trigger event the engine matches on.
 */
const NON_TRIGGER_EVENTS = new Set<BoardEventName>([
	'board.created',
	'board.updated',
	'board.archived',
	'list.created',
	'list.updated',
	'list.moved',
	'list.archived',
	'card.deleted',
	'matter.snapshotRefreshed',
	'deadline.satisfied',
]);

/** A `BoardEventName` that is also a `BoardAutomationTriggerEvent` (everything not in the exclude set). */
function asTriggerEvent(event: BoardEventName): BoardAutomationTriggerEvent | undefined {
	return NON_TRIGGER_EVENTS.has(event) ? undefined : (event as BoardAutomationTriggerEvent);
}

/** Card events that can change the pushed CasePro-task projection (mirrors TASK_SYNC_EVENTS). */
const CASEPRO_TASK_SYNC_EVENTS = new Set<BoardEventName>(['card.created', 'card.updated', 'due.set', 'due.completed']);

export function emitBoardEvent(event: BoardEventName, payload: BoardEventPayload): void {
	SystemLogger.debug({ msg: 'boards.event', event, payload });

	// Second fan-out: card → CasePro task PUSH sync (opt-in per board — see
	// casepro/task-sync.ts). Same fire-and-forget + dynamic-import + swallowed-catch
	// discipline as the automation dispatch below: it must never slow or break the
	// emitting mutation, and this low-level lib must not pull the sync module (and
	// its models/settings imports) at module-eval time.
	if (CASEPRO_TASK_SYNC_EVENTS.has(event) && typeof payload.cardId === 'string') {
		const { boardId, cardId, actor } = payload;
		void import('./casepro/task-sync')
			.then(({ syncCardEvent }) => syncCardEvent(event, { boardId, cardId, actor }))
			.catch((err) => {
				SystemLogger.debug({ msg: 'boards.event.taskSyncFailed', event, err });
			});
	}

	const triggerEvent = asTriggerEvent(event);
	if (!triggerEvent) {
		return;
	}

	// Fire-and-forget into the engine. NEVER throw into the emitting mutation: a dynamic
	// import (the engine pulls in models/services that must not load at module-eval time
	// for this low-level lib) + a swallowed catch keep the card move on its <16ms path.
	//
	// `currentCascadeLoop()` is read inside the resolved import (same async context as the
	// emitting call): when the emit originates from an action handler's mutation it returns
	// the running cascade's loop state, which is threaded as the child cascade's parent so
	// the loop guard (depth/budget/re-entry) spans the re-trigger. A user-initiated mutation
	// has no ambient loop → a fresh root cascade. (events.ts dynamic-imports the engine to
	// avoid loading models/services at this low-level lib's module-eval time.)
	void Promise.all([import('../../services/automation/service'), import('../../services/automation/cascadeContext')])
		.then(([{ Automation }, { currentCascadeLoop }]) => Automation.dispatch(payload.boardId, triggerEvent, payload, currentCascadeLoop()))
		.catch((err) => {
			SystemLogger.debug({ msg: 'boards.event.dispatchFailed', event, err });
		});
}
