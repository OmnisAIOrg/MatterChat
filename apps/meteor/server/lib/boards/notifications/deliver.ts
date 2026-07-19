import type { IBoardCard, IBoardNotification } from '@rocket.chat/core-typings';
import { BoardsNotifications } from '@rocket.chat/models';

import { settings } from '../../../../app/settings/server';
import { SystemLogger } from '../../logger/system';
import type { BoardEventName } from '../events';
import { resolveCardRecipients, resolveBoardRecipients } from './subscriptions';
import { sendWebPushToUser, isWebPushConfigured } from '../../../../app/web-push/server/send';

/**
 * Boards notification DELIVERY (M8 — closes the M7 NOTIFY-action gap + is the fan-out
 * seam every Boards lifecycle/automation event writes through). Delivery here means:
 * write one `boards_notifications` row per recipient (the durable inbox the Boards bell
 * renders via `boards.notifications.*` REST). Email is NOT sent inline — that is the
 * digest cron's job (`boardsDigestCron`), which sweeps unread rows; this keeps the
 * write path fast and SMTP-independent.
 *
 * IN-APP TOGGLE: gated by `Boards_Notifications_InApp_Enabled` (default true). When off,
 * `deliver` short-circuits and writes nothing — an admin kill switch with no redeploy.
 *
 * GRACEFUL-DEGRADE CONTRACT: nothing here throws. A failed recipient write is logged at
 * debug and skipped; a fan-out failure degrades to "delivered to whoever we could". The
 * mutation (card move / comment / automation run) that triggered delivery must never be
 * broken by notification delivery.
 *
 * IN-APP BELL: we deliberately took the SELF-CONTAINED path (boards_notifications + the
 * per-user `countUnread`/`findUnreadByUser` finders) rather than reaching into
 * Rocket.Chat's core `notify-user` streamer / native bell. That keeps the blast radius
 * inside the Boards feature: the client phase adds a Boards-scoped NavBar bell that polls
 * `boards.notifications.unreadCount` + reads `boards.notifications.list`, with no change
 * to RC's notification plumbing. (A future live-push nudge can be layered on top by
 * emitting a user-scoped stream event here; it is intentionally omitted to avoid the
 * cross-cutting risk for M8.)
 */

/** In-app delivery master toggle (degrades to enabled-by-default if the setting read fails). */
function inAppEnabled(): boolean {
	try {
		return settings.get('Boards_Notifications_InApp_Enabled') !== false;
	} catch {
		return true;
	}
}

/** Web push delivery master toggle (degrades to enabled-by-default if the setting read fails). */
function webPushEnabled(): boolean {
	try {
		return settings.get('Boards_Notifications_WebPush_Enabled') !== false;
	} catch {
		return true;
	}
}

/** The notification content + routing for ONE recipient set (subject refs + actor are shared). */
export type NotificationSpec = {
	/** Event name (BoardEventName) or a synthesized reason ('sla_breach','sol_warning','digest','mention',…). */
	kind: BoardEventName | string;
	title: string;
	body?: string;
	/** in-app router pathname the bell deep-links to (e.g. /boards/b/<boardId>/board/<cardId>). */
	link?: string;
	/** who/what caused it: user _id | 'automation:<id>' | 'casepro:sync' | 'system'. */
	actor: string;
	// subject refs (any subset; used for grouping + deep-link fallback in the inbox)
	boardId?: string;
	cardId?: string;
	leadId?: string;
};

export type DeliveryResult = {
	/** how many `boards_notifications` rows were written (0 when the toggle is off or no recipients). */
	delivered: number;
	/** the resolved recipient user-ids (returned even when the toggle suppresses the write, for the run-log). */
	recipients: string[];
	/** true when in-app delivery was suppressed by the `Boards_Notifications_InApp_Enabled` toggle. */
	suppressed: boolean;
};

/**
 * Build the standard in-app deep-link for a card (the bell's primary navigation target).
 * Mirrors the Boards client router shape used elsewhere in the feature.
 */
export function cardLink(boardId: string, cardId: string): string {
	return `/boards/b/${boardId}/board/${cardId}`;
}

/** Build the standard in-app deep-link for a board. */
export function boardLink(boardId: string): string {
	return `/boards/b/${boardId}/board`;
}

/**
 * Send web push notifications to recipients (browser push via VAPID). Fire-and-forget with
 * graceful degradation: failures are logged at debug and do not affect in-app delivery.
 * Only attempts sends if web-push is configured and the setting is enabled.
 */
async function sendWebPushNotifications(recipients: string[], spec: NotificationSpec): Promise<void> {
	if (!webPushEnabled() || !isWebPushConfigured()) {
		return;
	}

	const payload = {
		title: spec.title,
		...(spec.body ? { body: spec.body } : {}),
		...(spec.link ? { url: spec.link } : {}),
		// Use a consistent tag per card to coalesce multiple notifications
		...(spec.cardId ? { tag: `boards-card-${spec.cardId}` } : spec.boardId ? { tag: `boards-board-${spec.boardId}` } : {}),
	};

	const unique = [...new Set(recipients.filter(Boolean))];
	await Promise.all(
		unique.map(async (userId) => {
			try {
				await sendWebPushToUser(userId, payload);
			} catch (err) {
				SystemLogger.debug({ msg: 'boards.notifications.webpush.sendFailed', userId, kind: spec.kind, err });
			}
		}),
	);
}

/**
 * Write a `boards_notifications` row for each recipient. The low-level primitive every
 * other helper here funnels through. De-dupes the recipient list, honors the in-app
 * toggle, and never throws (per-row failures are swallowed + logged at debug).
 * Also dispatches web push notifications in parallel (fire-and-forget).
 */
export async function deliverToRecipients(recipients: string[], spec: NotificationSpec): Promise<DeliveryResult> {
	const unique = [...new Set(recipients.filter(Boolean))];

	// Fire web push in parallel (non-blocking, failures logged at debug).
	void sendWebPushNotifications(unique, spec).catch((err) => {
		SystemLogger.debug({ msg: 'boards.notifications.webpush.fanoutFailed', kind: spec.kind, err });
	});

	if (!inAppEnabled()) {
		return { delivered: 0, recipients: unique, suppressed: true };
	}

	let delivered = 0;
	const now = new Date();
	for (const userId of unique) {
		const row: Omit<IBoardNotification, '_id' | '_updatedAt'> = {
			userId,
			kind: spec.kind,
			title: spec.title,
			...(spec.body ? { body: spec.body } : {}),
			...(spec.link ? { link: spec.link } : {}),
			actor: spec.actor,
			...(spec.boardId ? { boardId: spec.boardId } : {}),
			...(spec.cardId ? { cardId: spec.cardId } : {}),
			...(spec.leadId ? { leadId: spec.leadId } : {}),
			read: false,
			createdAt: now,
		};
		try {
			await BoardsNotifications.createNotification(row);
			delivered += 1;
		} catch (err) {
			SystemLogger.debug({ msg: 'boards.notifications.deliver.rowFailed', userId, kind: spec.kind, err });
		}
	}

	return { delivered, recipients: unique, suppressed: false };
}

/**
 * Deliver a card event to its full recipient set (assignees + watchers + card/board
 * subscribers, minus the actor). The everyday fan-out: a lifecycle seam (assign, move,
 * comment, due) and the automation NOTIFY action both call this. Best-effort throughout.
 */
export async function deliverCardEvent(
	card: Pick<IBoardCard, '_id' | 'boardId' | 'assignees' | 'watchers'>,
	spec: Omit<NotificationSpec, 'boardId' | 'cardId'> & { event?: BoardEventName | string },
): Promise<DeliveryResult> {
	const { event, ...content } = spec;
	const recipients = await resolveCardRecipients(card, {
		...(event ? { event } : {}),
		excludeUserId: spec.actor,
	});
	return deliverToRecipients(recipients, {
		...content,
		boardId: card.boardId,
		cardId: card._id,
		link: content.link ?? cardLink(card.boardId, card._id),
	});
}

/**
 * Deliver to an EXPLICIT recipient list (the automation NOTIFY action's resolved targets,
 * or a deadline tickler's owners) without re-deriving from a card. Used when the caller
 * already knows exactly who to notify. Actor is still excluded so a user isn't pinged for
 * their own action.
 */
export async function deliverToUsers(
	userIds: string[],
	spec: NotificationSpec,
): Promise<DeliveryResult> {
	const recipients = userIds.filter((uid) => uid && uid !== spec.actor);
	return deliverToRecipients(recipients, spec);
}

/**
 * Deliver a board-level event (no card subject) to the board's watchers. Best-effort.
 */
export async function deliverBoardEvent(
	boardId: string,
	spec: Omit<NotificationSpec, 'boardId'> & { event?: BoardEventName | string },
): Promise<DeliveryResult> {
	const { event, ...content } = spec;
	const recipients = await resolveBoardRecipients(boardId, {
		...(event ? { event } : {}),
		excludeUserId: spec.actor,
	});
	return deliverToRecipients(recipients, { ...content, boardId, link: content.link ?? boardLink(boardId) });
}
