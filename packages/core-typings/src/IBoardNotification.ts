import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * A per-user Boards notification (Tier 5, collection `boards_notifications`).
 * The inbox the bell renders and the digest reads. Append-only-ish: rows are
 * created by the M8 delivery seam (the automation NOTIFY action + lifecycle
 * fan-out via boards_subscriptions), then flipped read/unread; trash is kept so
 * a user can clear/prune read items.
 *
 * `kind` is loosely typed (an event name OR a synthesized string like
 * 'sla_breach'/'sol_warning'/'digest') — the same open-string convention the
 * automation engine uses for actor/verb — so new notification reasons don't
 * require a core-typings change. `link` is an in-app router pathname the bell
 * deep-links to (e.g. `/boards/b/<boardId>/board/<cardId>`).
 */

export interface IBoardNotification extends IRocketChatRecord {
	userId: IUser['_id'];

	// subject refs (any subset; used for grouping + deep-link fallback)
	boardId?: string; // -> boards_boards._id
	cardId?: string; // -> boards_cards._id
	leadId?: string; // -> boards_leads._id

	/** Event name (BoardEventName) or a synthesized reason ('sla_breach','sol_warning','digest','mention',…). */
	kind: string;
	title: string;
	body?: string;
	link?: string; // in-app router pathname to open

	/** Who/what caused it: user _id | 'automation:<id>' | 'casepro:sync' | 'system'. */
	actor: string;

	read: boolean;
	readAt?: Date;
	createdAt: Date;
}
