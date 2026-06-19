import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * A user's WATCH on a Boards entity (Tier 5, collection `boards_subscriptions`).
 * The seam M8 notification delivery reads to fan an event out to the right
 * inboxes: when a card moves / a comment lands / a deadline fires, the engine
 * looks up the watchers of that card (and of its board) and writes a
 * `boards_notifications` row per watcher.
 *
 * A subscription targets ONE entity (`target.kind` + `target.id`) but always
 * carries the owning `boardId` so "watchers of a whole board" is a single index
 * hit (`{ boardId, 'target.kind' }`). `events` narrows which event names notify
 * this user; `null`/unset = all events (the default a bell-toggle creates).
 *
 * NOTE on the event vocabulary: the engine's runtime event union lives in
 * `apps/meteor/server/lib/boards/events.ts` (`BoardEventName`). core-typings may
 * not import from apps/meteor, so `BoardSubscriptionEvent` below mirrors the same
 * names (same precedent as `BoardsActivityVerb` in IBoardActivity and
 * `BoardAutomationTriggerEvent` in IAutomation). Keep them in sync — same contract.
 */

export type BoardSubscriptionTargetKind = 'board' | 'list' | 'card' | 'matter' | 'lead';

export interface IBoardSubscriptionTarget {
	kind: BoardSubscriptionTargetKind;
	id: string; // boards_cards._id | boards_lists._id | boards_boards._id | matterId | leadId
}

/** Mirrors `BoardEventName` (events.ts). null/unset on a subscription = all events. */
export type BoardSubscriptionEvent =
	// card lifecycle
	| 'card.created'
	| 'card.updated'
	| 'card.moved'
	| 'card.archived'
	| 'card.subStatusChanged'
	| 'card.converted'
	| 'card.commented'
	// card-detail mutations
	| 'label.added'
	| 'label.removed'
	| 'member.added'
	| 'member.removed'
	| 'due.set'
	| 'due.completed'
	| 'checklist.itemChecked'
	| 'checklist.completed'
	| 'field.changed'
	// matter domain
	| 'matter.stageChanged'
	| 'matter.snapshotRefreshed'
	| 'casepro.stageChanged'
	// lead domain
	| 'lead.captured'
	| 'lead.statusChanged'
	| 'lead.qualified'
	| 'lead.disqualified'
	| 'lead.lost'
	| 'lead.converted'
	| 'lead.contacted'
	| 'lead.responded'
	| 'lead.noContact'
	// deadlines / card dates
	| 'deadline.created'
	| 'deadline.due'
	| 'deadline.acknowledged'
	| 'deadline.satisfied'
	| 'card.dueSoon'
	| 'card.overdue';

export interface IBoardSubscription extends IRocketChatRecord {
	userId: IUser['_id'];
	target: IBoardSubscriptionTarget;
	boardId: string; // -> boards_boards._id (always set, even for matter/lead targets, for the watcher scan)

	/** Which events notify this watcher. `null`/unset = all events. */
	events?: BoardSubscriptionEvent[] | null;

	archived: boolean;
	rev: number;
	createdBy?: IUser['_id'];
	createdAt: Date;
}
