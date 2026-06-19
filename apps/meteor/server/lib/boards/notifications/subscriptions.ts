import type { IBoardCard, IBoardSubscription, IBoardSubscriptionTarget, BoardSubscriptionEvent } from '@rocket.chat/core-typings';
import { BoardsSubscriptions, BoardsCards, BoardsActivities } from '@rocket.chat/models';

import { assertBoardRole } from '../permissions';
import type { BoardEventName } from '../events';

/**
 * Boards subscriptions (M8 — 06-data-model-and-IA.md "boards_subscriptions"; the
 * watcher seam the notification fan-out reads). Two jobs:
 *
 *   1. RECIPIENT RESOLUTION — given a card (and its board), compute the set of users
 *      who should receive a notification for an event: the card's assignees + its
 *      explicit watchers + any rows in `boards_subscriptions` that target the card
 *      (or its board), narrowed by the subscription's `events` filter. This is what
 *      `deliver` calls; it never throws (a notification fan-out must not break the
 *      mutation that triggered it).
 *
 *   2. WATCH / UNWATCH + AUTO-SUBSCRIBE — the `boards.subscriptions.watch/unwatch`
 *      REST surface, plus `autoSubscribe`, which the lifecycle seams (assign / comment)
 *      call so a user who engages with a card starts following it (Trello/Jira parity).
 *
 * Mirrors the leads-service convention: permission gate → model write → activity log.
 * Reads are board-visibility gated (`assertBoardRole observer`); writes require the
 * caller to be at least an observer on the board (you can only watch what you can see).
 * Auto-subscribe is system-driven (already-authorized lifecycle events) so it skips the
 * gate and is fully best-effort.
 */

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

/**
 * Does a subscription's `events` filter let `event` through? `null`/unset = all
 * events (the default a bell-toggle creates). A synthesized reason that is not a
 * real `BoardSubscriptionEvent` (e.g. 'sla_breach') only reaches subscribers with
 * the all-events default — never a narrowed filter — which is the safe behavior.
 */
function subscriptionWantsEvent(sub: IBoardSubscription, event?: string): boolean {
	if (!sub.events || sub.events.length === 0) {
		return true;
	}
	if (!event) {
		return true;
	}
	return (sub.events as string[]).includes(event);
}

/**
 * Resolve the recipient user-ids for a card event. Union of:
 *   - card.assignees (always notified — it's their work)
 *   - card.watchers  (the legacy inline watcher array on the card)
 *   - boards_subscriptions targeting this card, filtered by `events`
 *   - boards_subscriptions targeting the whole board, filtered by `events`
 *
 * `excludeUserId` drops the actor so a user isn't notified about their own action.
 * Best-effort: any model failure degrades to whatever was gathered so far.
 */
export async function resolveCardRecipients(
	card: Pick<IBoardCard, '_id' | 'boardId' | 'assignees' | 'watchers'>,
	options: { event?: BoardEventName | string; excludeUserId?: string } = {},
): Promise<string[]> {
	const recipients = new Set<string>();

	for (const uid of card.assignees ?? []) {
		recipients.add(uid);
	}
	for (const uid of card.watchers ?? []) {
		recipients.add(uid);
	}

	try {
		const cardWatchers = await BoardsSubscriptions.findWatchersOfCard(card._id).toArray();
		for (const sub of cardWatchers) {
			if (subscriptionWantsEvent(sub, options.event)) {
				recipients.add(sub.userId);
			}
		}
	} catch {
		/* best-effort: card-level watcher scan failed; keep assignees/inline watchers. */
	}

	try {
		const boardWatchers = await BoardsSubscriptions.findWatchersOfBoard(card.boardId).toArray();
		for (const sub of boardWatchers) {
			if (subscriptionWantsEvent(sub, options.event)) {
				recipients.add(sub.userId);
			}
		}
	} catch {
		/* best-effort: board-level watcher scan failed. */
	}

	if (options.excludeUserId) {
		recipients.delete(options.excludeUserId);
	}
	return [...recipients];
}

/**
 * Resolve recipients for a board-level event (no card subject): the board's
 * watchers, filtered by `events`. Best-effort, actor-excluded.
 */
export async function resolveBoardRecipients(
	boardId: string,
	options: { event?: BoardEventName | string; excludeUserId?: string } = {},
): Promise<string[]> {
	const recipients = new Set<string>();
	try {
		const boardWatchers = await BoardsSubscriptions.findWatchersOfBoard(boardId).toArray();
		for (const sub of boardWatchers) {
			if (subscriptionWantsEvent(sub, options.event)) {
				recipients.add(sub.userId);
			}
		}
	} catch {
		/* best-effort. */
	}
	if (options.excludeUserId) {
		recipients.delete(options.excludeUserId);
	}
	return [...recipients];
}

// ---------------------------------------------------------------------------
// Auto-subscribe (lifecycle seams)
// ---------------------------------------------------------------------------

/**
 * Quietly start a user following a card (Trello/Jira parity: assigning or commenting
 * on a card subscribes you to it). System-driven — the calling lifecycle event was
 * already authorized — so this skips the permission gate and is fully best-effort
 * (it must never break the assign/comment mutation that triggered it). Idempotent via
 * the model's `upsertWatch` (one row per user+target). `events` is left unset = all.
 */
export async function autoSubscribeToCard(userId: string, card: Pick<IBoardCard, '_id' | 'boardId'>): Promise<void> {
	if (!userId || userId === 'system' || userId.startsWith('automation:') || userId.startsWith('casepro:')) {
		return; // only real users auto-follow
	}
	try {
		await BoardsSubscriptions.upsertWatch(userId, { kind: 'card', id: card._id }, card.boardId);
	} catch {
		/* best-effort: auto-subscribe is a convenience, never load-bearing. */
	}
}

/** Auto-subscribe several users to a card at once (e.g. all assignees on assign). */
export async function autoSubscribeManyToCard(userIds: string[], card: Pick<IBoardCard, '_id' | 'boardId'>): Promise<void> {
	for (const uid of userIds) {
		await autoSubscribeToCard(uid, card);
	}
}

// ---------------------------------------------------------------------------
// Explicit watch / unwatch (REST surface)
// ---------------------------------------------------------------------------

export type WatchTargetInput = {
	kind: IBoardSubscriptionTarget['kind'];
	id: string;
	/** required for matter/lead targets where boardId is not derivable from the target id. */
	boardId?: string;
	/** narrow which events notify this watcher; omit = all. */
	events?: BoardSubscriptionEvent[];
};

/**
 * Resolve the owning boardId for a watch target. A card target derives its board from
 * the card doc (and doubles as the existence + visibility check); other targets must
 * carry an explicit `boardId` (the caller knows it from the board it is watching).
 */
async function resolveTargetBoardId(target: WatchTargetInput): Promise<string> {
	if (target.kind === 'card') {
		const card = await BoardsCards.findOneById(target.id);
		if (!card) {
			throw new Error('error-card-not-found');
		}
		return card.boardId;
	}
	if (target.kind === 'board') {
		return target.id;
	}
	if (!target.boardId) {
		throw new Error('error-board-required');
	}
	return target.boardId;
}

export type WatchResult = { subscribed: true; target: IBoardSubscriptionTarget; boardId: string };

/**
 * Watch an entity. Requires the caller to be at least an observer on the owning board
 * (you can only follow what you can see). Idempotent (upsert). Records a `field.changed`
 * activity so the watch is auditable. `notifications` are per-user — there is no extra
 * board permission beyond board visibility.
 */
export async function watch(uid: string, input: WatchTargetInput): Promise<WatchResult> {
	const boardId = await resolveTargetBoardId(input);
	await assertBoardRole(boardId, uid, 'observer', 'boards.subscriptions.watch');

	const target: IBoardSubscriptionTarget = { kind: input.kind, id: input.id };
	await BoardsSubscriptions.upsertWatch(uid, target, boardId, input.events ?? undefined);

	try {
		await BoardsActivities.log({
			boardId,
			...(input.kind === 'card' ? { cardId: input.id } : {}),
			actor: uid,
			verb: 'field.changed',
			to: { watch: { kind: input.kind, id: input.id }, ...(input.events ? { events: input.events } : {}) },
			ts: new Date(),
		});
	} catch {
		/* audit is best-effort — the watch row is the source of truth. */
	}

	return { subscribed: true, target, boardId };
}

export type UnwatchResult = { unsubscribed: true; target: IBoardSubscriptionTarget };

/**
 * Drop a watch. Requires board visibility (resolved the same way as `watch`). Removing a
 * watch you don't have is a no-op (the delete simply matches nothing). Audited.
 */
export async function unwatch(uid: string, input: WatchTargetInput): Promise<UnwatchResult> {
	const boardId = await resolveTargetBoardId(input);
	await assertBoardRole(boardId, uid, 'observer', 'boards.subscriptions.unwatch');

	const target: IBoardSubscriptionTarget = { kind: input.kind, id: input.id };
	await BoardsSubscriptions.removeWatch(uid, target);

	try {
		await BoardsActivities.log({
			boardId,
			...(input.kind === 'card' ? { cardId: input.id } : {}),
			actor: uid,
			verb: 'field.changed',
			to: { unwatch: { kind: input.kind, id: input.id } },
			ts: new Date(),
		});
	} catch {
		/* best-effort audit. */
	}

	return { unsubscribed: true, target };
}

/**
 * List a user's watches (the "things I follow" view). A subscription is private to its
 * owner and the finder keys on `userId`, so a caller can only ever read their OWN rows —
 * there is no cross-user read path and therefore no extra permission gate (the REST layer
 * already requires an authenticated user, and notifications are per-user by design).
 */
export async function listWatches(viewerUid: string): Promise<IBoardSubscription[]> {
	return BoardsSubscriptions.findByUser(viewerUid).toArray();
}
