import type { IBoard, IBoardCard } from '@rocket.chat/core-typings';
import { Boards, BoardsCards, BoardsActivities } from '@rocket.chat/models';

import { SystemLogger } from '../../logger/system';
import { enqueue } from '../../../services/automation/queue';
import { settings } from '../../../settings';
import type { BoardEventName } from '../events';
import { caseProClient } from './client';
import { isLiveTransportConfigured } from './live';
import type { CaseProRow } from './transport';

/**
 * Card → CasePro task PUSH sync (MVP).
 *
 * Opt-in PER BOARD via `board.caseproSync.taskSyncEnabled` (default off; set with
 * `boards.casepro.taskSync.set`, board-admin only) AND the global `CasePro_Enabled`
 * master switch (same gate as the leads write-through in ../leads/caseproSync.ts).
 *
 * When a card on an opted-in board is created / retitled / due-dated / completed,
 * we UPSERT the correlated CasePro `tasks` row through the one `caseProClient`:
 *
 *   - correlation key: CasePro `tasks.external_ref` (varchar(128), indexed) = card `_id`
 *   - `tasks.source`  : 'MatterChat' (stamped on create; immutable after)
 *   - `tasks.subject` : card title — NOTE the CasePro field is `subject`, NOT `title`
 *   - `tasks.due_date`: card dueDate
 *   - completion      : card done (completed || dueComplete) → `task_status:'Completed'`
 *     (CasePro's tasks service maintains `completed_at` on that transition). While the
 *     card is NOT done, updates deliberately do NOT touch `task_status`, so a CasePro-side
 *     status edit ('In Progress', …) is never clobbered by a retitle/re-date push.
 *
 * PULL DIRECTION IS EXPLICITLY OUT OF SCOPE: CasePro emits no task events (no
 * webhook/outbox for `tasks`), so there is nothing to subscribe to. If CasePro-side
 * edits ever need mirroring, that's a polling read-through — a separate milestone.
 *
 * Delivery: fire-and-forget from the board-event seam (events.ts), serialized
 * per board on the same FIFO the automation engine uses, with a bounded
 * retry/backoff per push. An in-memory TTL idempotency guard drops an identical
 * card+fields push re-fired within the TTL (e.g. the burst of card.updated
 * events one drag emits). Every push (and terminal failure) is audited on the
 * card's activity feed (`casepro.task.pushed`).
 */

/** Board events that can change the pushed task projection. */
export const TASK_SYNC_EVENTS: readonly BoardEventName[] = ['card.created', 'card.updated', 'due.set', 'due.completed'];

// ---------------------------------------------------------------------------
// Idempotency guard — same card + same projected fields within TTL ⇒ drop.
// ---------------------------------------------------------------------------

const IDEMPOTENCY_TTL_MS = 60_000;

const recentPushes = new Map<string, number>();

function pruneExpired(nowTs: number): void {
	for (const [key, ts] of recentPushes) {
		if (nowTs - ts > IDEMPOTENCY_TTL_MS) {
			recentPushes.delete(key);
		}
	}
}

/** true ⇒ this exact push already happened within the TTL (and should be dropped). */
function isDuplicatePush(key: string, nowTs = Date.now()): boolean {
	pruneExpired(nowTs);
	const seen = recentPushes.get(key);
	if (seen !== undefined && nowTs - seen <= IDEMPOTENCY_TTL_MS) {
		return true;
	}
	recentPushes.set(key, nowTs);
	return false;
}

/** Test hook: clear the idempotency window between cases. */
export function __resetTaskSyncStateForTests(): void {
	recentPushes.clear();
}

// ---------------------------------------------------------------------------
// Gates + per-board toggle service
// ---------------------------------------------------------------------------

/** Same global master switch the leads write-through honors (kept local — no heavy import chain). */
function isCaseProEnabled(): boolean {
	try {
		return settings.get<boolean>('CasePro_Enabled') === true;
	} catch {
		return false;
	}
}

export function isTaskSyncEnabledForBoard(board: Pick<IBoard, 'caseproSync'> | null | undefined): boolean {
	return board?.caseproSync?.taskSyncEnabled === true;
}

/**
 * Flip the per-board opt-in (REST: `boards.casepro.taskSync.set`, board-admin only —
 * the caller runs `assertBoardRole`). Audited on the board feed.
 */
export async function setTaskSyncEnabled(uid: string, boardId: string, enabled: boolean): Promise<IBoard> {
	await Boards.updateOne({ _id: boardId }, { $set: { 'caseproSync.taskSyncEnabled': enabled }, $inc: { rev: 1 } });
	const board = await Boards.findOneById(boardId);
	if (!board) {
		throw new Error(`boards.casepro.taskSync.set: board ${boardId} not found`);
	}
	await BoardsActivities.log({
		boardId,
		actor: uid,
		verb: 'board.updated',
		to: { caseproTaskSyncEnabled: enabled },
		ts: new Date(),
	});
	return board;
}

// ---------------------------------------------------------------------------
// Projection: card -> CasePro task row
// ---------------------------------------------------------------------------

/** Card "done" per the PM model: task-level completed OR its due checked off. */
function isCardDone(card: IBoardCard): boolean {
	return card.completed === true || card.dueComplete === true;
}

/** The patch pushed on every sync (create adds the identity fields on top). */
function buildTaskPatch(card: IBoardCard): CaseProRow {
	return {
		subject: card.title, // CasePro field is `subject`, not `title`
		due_date: card.dueDate ? new Date(card.dueDate).toISOString() : null,
		...(isCardDone(card) ? { task_status: 'Completed' } : {}),
	};
}

/** The full row for a first-time create (identity + source + external_ref contract). */
function buildTaskCreateRow(card: IBoardCard): CaseProRow {
	return {
		...buildTaskPatch(card),
		...(isCardDone(card) ? {} : { task_status: 'Not Started' }),
		status: 'active',
		source: 'MatterChat',
		external_ref: card._id,
		...(card.link?.kind === 'matter' ? { related_to_id: card.link.matterId } : {}),
	};
}

// ---------------------------------------------------------------------------
// Push (upsert) with bounded retry
// ---------------------------------------------------------------------------

const RETRY_BACKOFF_MS = [500, 2000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type PushOutcome = { op: 'create' | 'update'; caseproTaskId?: string; response: CaseProRow };

/** One upsert attempt: find by external_ref, then create-or-patch. */
async function upsertTask(card: IBoardCard): Promise<PushOutcome> {
	const existing = await caseProClient.findTaskByExternalRef(card._id);
	if (existing?.id) {
		const response = await caseProClient.updateTask(String(existing.id), buildTaskPatch(card));
		return { op: 'update', caseproTaskId: String(existing.id), response };
	}
	const response = await caseProClient.createTask(buildTaskCreateRow(card));
	return { op: 'create', ...(response.id ? { caseproTaskId: String(response.id) } : {}), response };
}

/**
 * Entry point — called (fire-and-forget) from the board-event seam for
 * {@link TASK_SYNC_EVENTS}. Never throws into the emitting mutation.
 */
export async function syncCardEvent(event: BoardEventName, payload: { boardId: string; cardId?: string; actor: string }): Promise<void> {
	try {
		const { boardId, cardId, actor } = payload;
		if (!cardId || !(TASK_SYNC_EVENTS as readonly string[]).includes(event)) {
			return;
		}
		if (!isCaseProEnabled()) {
			return;
		}
		const board = await Boards.findOneById(boardId);
		if (!isTaskSyncEnabledForBoard(board)) {
			return;
		}
		const card = await BoardsCards.findOneById(cardId);
		if (!card || card.archived) {
			return;
		}
		// lead cards already have their own CasePro write-through (intake sync) — skip.
		if (card.link?.kind === 'lead') {
			return;
		}

		// idempotency: identical projected fields for this card within the TTL ⇒ drop.
		const dedupeKey = `${card._id}:${JSON.stringify(buildTaskPatch(card))}`;
		if (isDuplicatePush(dedupeKey)) {
			return;
		}

		// serialized per board (same FIFO discipline as the automation engine), with
		// a bounded retry inside the queued task so a transient CasePro hiccup doesn't
		// drop the push — and a terminal failure is audited, never thrown.
		await enqueue(boardId, async () => {
			let lastErr: unknown;
			for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
				try {
					const outcome = await upsertTask(card);
					await BoardsActivities.log({
						boardId,
						cardId: card._id,
						actor,
						verb: 'casepro.task.pushed',
						to: {
							op: outcome.op,
							...(outcome.caseproTaskId ? { caseproTaskId: outcome.caseproTaskId } : {}),
							externalRef: card._id,
							subject: card.title,
							...(isCardDone(card) ? { taskStatus: 'Completed' } : {}),
							pushedToCasePro: true,
							transport: isLiveTransportConfigured() ? 'live' : 'stub',
							...(attempt > 0 ? { attempt: attempt + 1 } : {}),
						},
						ts: new Date(),
					});
					return;
				} catch (err) {
					lastErr = err;
					if (attempt < RETRY_BACKOFF_MS.length) {
						await sleep(RETRY_BACKOFF_MS[attempt]);
					}
				}
			}
			// terminal: audit the failure on the card so the miss is visible, allow a
			// later event (or the same one after the TTL) to try again.
			recentPushes.delete(dedupeKey);
			SystemLogger.warn({ msg: 'boards.casepro.taskSync.pushFailed', boardId, cardId: card._id, err: lastErr });
			await BoardsActivities.log({
				boardId,
				cardId: card._id,
				actor,
				verb: 'casepro.task.pushed',
				to: {
					externalRef: card._id,
					pushedToCasePro: false,
					error: lastErr instanceof Error ? lastErr.message : String(lastErr),
				},
				ts: new Date(),
			});
		});
	} catch (err) {
		// NEVER throw into the emitting mutation.
		SystemLogger.warn({ msg: 'boards.casepro.taskSync.failed', event, err });
	}
}
