import type { IBoardCard, IUser } from '@rocket.chat/core-typings';
import { Users, BoardsCards } from '@rocket.chat/models';

import { SystemLogger } from '../../logger/system';
import type { BoardEventName, BoardEventPayload } from '../events';
import { deliverCardEvent, deliverBoardEvent, deliverToUsers } from './deliver';
import { formatBoardEventNotification } from './formatters';

/**
 * Board EVENTS → NOTIFICATIONS wiring (M8 supplement). Completes the push-notification
 * bridge by connecting board lifecycle/automation events to appropriate notification
 * delivery. Handles five core event classes:
 *
 *   1. Card assignment (member.added) → "You're assigned to [card]"
 *   2. Due soon / overdue (card.dueSoon, card.overdue) → deadline alerts
 *   3. Comment mention (card.commented w/ mention context) → mention alerts
 *   4. Approval actions (approval_requested, approval_approved, etc.)
 *   5. Stage changes (matter.stageChanged, card.subStatusChanged)
 *
 * ARCHITECTURE: This module exports hooks that are called from the automation
 * dispatcher + key service functions. It is NOT a streamer listener (that would
 * pick up all events including RC core, increasing blast radius). Instead, call
 * sites emit into `emitBoardEvent` in events.ts, and we selectively wire specific
 * ones here.
 *
 * GRACEFUL DEGRADE: Every handler is fire-and-forget with swallowed errors. A failed
 * notification delivery never breaks the underlying mutation. Errors are logged at
 * debug level.
 */

/**
 * Handle card.dueSoon events — send a notification to the card's assignees + watchers
 * when a deadline approaches. The cron that synthesizes this event (deadline-scan)
 * passes the days-until-due in the payload so we can tailor the message.
 */
export async function onCardDueSoon(card: IBoardCard, daysUntilDue: number): Promise<void> {
	try {
		const format = formatBoardEventNotification('card.dueSoon', card.title, { daysUntilDue });
		await deliverCardEvent(card, {
			kind: 'card.dueSoon',
			...format,
			actor: 'system',
		});
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onCardDueSoon.failed', cardId: card._id, err });
	}
}

/**
 * Handle card.overdue events — send a high-priority notification when a deadline passes.
 */
export async function onCardOverdue(card: IBoardCard): Promise<void> {
	try {
		const format = formatBoardEventNotification('card.dueSoon', card.title, { isOverdue: true });
		await deliverCardEvent(card, {
			kind: 'card.overdue',
			...format,
			actor: 'system',
		});
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onCardOverdue.failed', cardId: card._id, err });
	}
}

/**
 * Handle member.added events (card assignment). When a new assignee is added to a card,
 * notify the new assignee (not the assigner, to avoid self-pings). Requires the actor
 * (the person doing the assigning) to exclude them from the notification.
 */
export async function onCardAssignment(card: IBoardCard, newAssigneeId: string, actor: string): Promise<void> {
	try {
		const assignee = await Users.findOneById(newAssigneeId);
		const format = formatBoardEventNotification('member.added', card.title, {
			assignee: assignee?.name || assignee?.username || 'Someone',
		});
		await deliverCardEvent(card, {
			kind: 'member.added',
			...format,
			actor,
			event: 'member.added',
		});
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onCardAssignment.failed', cardId: card._id, newAssigneeId, err });
	}
}

/**
 * Handle card.commented events with mention context. When a comment is posted and
 * mentions a user, notify the mentioned user(s).
 */
export async function onCardMention(card: IBoardCard, mentionedUserIds: string[], actor: string): Promise<void> {
	try {
		const format = formatBoardEventNotification('card.commented', card.title, { isMention: true });
		// Deliver only to mentioned users (exclude the actor who created the mention).
		const recipients = mentionedUserIds.filter((uid) => uid !== actor);
		if (recipients.length > 0) {
			await deliverToUsers(recipients, {
				kind: 'card.commented',
				title: format.title,
				body: format.body,
				actor,
				cardId: card._id,
				boardId: card.boardId,
				link: `/boards/b/${card.boardId}/board/${card._id}`,
			});
		}
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onCardMention.failed', cardId: card._id, err });
	}
}

/**
 * Handle approval_requested events. When an approval is requested on a card,
 * notify the assigned approvers.
 */
export async function onApprovalRequested(card: IBoardCard, approverIds: string[], actor: string): Promise<void> {
	try {
		const format = formatBoardEventNotification('approval_requested', card.title);
		const recipients = approverIds.filter((uid) => uid !== actor);
		if (recipients.length > 0) {
			await deliverToUsers(recipients, {
				kind: 'approval_requested',
				title: format.title,
				body: format.body,
				actor,
				cardId: card._id,
				boardId: card.boardId,
				link: `/boards/b/${card.boardId}/board/${card._id}`,
			});
		}
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onApprovalRequested.failed', cardId: card._id, err });
	}
}

/**
 * Handle approval_approved events. When an approver approves a card,
 * notify the assignees and card creator.
 */
export async function onApprovalApproved(card: IBoardCard, actor: string): Promise<void> {
	try {
		const format = formatBoardEventNotification('approval_approved', card.title);
		const recipients = [...(card.assignees ?? []), card.createdBy].filter((uid) => uid && uid !== actor);
		if (recipients.length > 0) {
			await deliverToUsers(recipients, {
				kind: 'approval_approved',
				title: format.title,
				body: format.body,
				actor,
				cardId: card._id,
				boardId: card.boardId,
				link: `/boards/b/${card.boardId}/board/${card._id}`,
			});
		}
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onApprovalApproved.failed', cardId: card._id, err });
	}
}

/**
 * Handle approval_rejected events. When an approver rejects/requests changes,
 * notify the card assignees and creator.
 */
export async function onApprovalRejected(card: IBoardCard, actor: string): Promise<void> {
	try {
		const format = formatBoardEventNotification('approval_rejected', card.title);
		const recipients = [...(card.assignees ?? []), card.createdBy].filter((uid) => uid && uid !== actor);
		if (recipients.length > 0) {
			await deliverToUsers(recipients, {
				kind: 'approval_rejected',
				title: format.title,
				body: format.body,
				actor,
				cardId: card._id,
				boardId: card.boardId,
				link: `/boards/b/${card.boardId}/board/${card._id}`,
			});
		}
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onApprovalRejected.failed', cardId: card._id, err });
	}
}

/**
 * Handle matter.stageChanged events. When a matter's stage changes,
 * notify board watchers and assignees.
 */
export async function onMatterStageChanged(card: IBoardCard, oldStage: string | null, newStage: string, actor: string): Promise<void> {
	try {
		const format = formatBoardEventNotification('matter.stageChanged', card.title, { oldStage: oldStage ?? undefined, newStage });
		await deliverCardEvent(card, {
			kind: 'matter.stageChanged',
			...format,
			actor,
			event: 'matter.stageChanged',
		});
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onMatterStageChanged.failed', cardId: card._id, err });
	}
}

/**
 * Handle card.subStatusChanged events. When a card's status/substatus changes,
 * notify the card's followers.
 */
export async function onCardStatusChanged(card: IBoardCard, oldStatus: string | null, newStatus: string, actor: string): Promise<void> {
	try {
		const format = formatBoardEventNotification('card.subStatusChanged', card.title, { oldStage: oldStatus ?? undefined, newStage: newStatus });
		await deliverCardEvent(card, {
			kind: 'card.subStatusChanged',
			...format,
			actor,
			event: 'card.subStatusChanged',
		});
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onCardStatusChanged.failed', cardId: card._id, err });
	}
}

/**
 * Handle card.moved events. When a card is moved to a different list,
 * notify watchers and assignees.
 */
export async function onCardMoved(card: IBoardCard, oldListId: string, actor: string): Promise<void> {
	try {
		const format = formatBoardEventNotification('card.moved', card.title);
		await deliverCardEvent(card, {
			kind: 'card.moved',
			...format,
			actor,
			event: 'card.moved',
		});
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onCardMoved.failed', cardId: card._id, err });
	}
}

/**
 * Handle due.set events. When a due date is set on a card,
 * notify assignees and watchers.
 */
export async function onDueDateSet(card: IBoardCard, dueDate: Date | null, actor: string): Promise<void> {
	try {
		if (!dueDate) {
			return;
		}
		const format = formatBoardEventNotification('due.set', card.title);
		await deliverCardEvent(card, {
			kind: 'due.set',
			...format,
			actor,
			event: 'due.set',
		});
	} catch (err) {
		SystemLogger.debug({ msg: 'boards.notifications.onDueDateSet.failed', cardId: card._id, err });
	}
}
