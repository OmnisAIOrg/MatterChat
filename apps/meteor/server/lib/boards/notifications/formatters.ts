import type { BoardEventName } from '../events';

/**
 * Boards event → human-readable notification title + body formatter (for both in-app
 * bell and web push). Maps the five core board events to titles + optional bodies:
 *   - assigned (member.added)
 *   - due soon (card.dueSoon)
 *   - comment mention (card.commented + is-mention context)
 *   - approval requested (automation action, marked in spec.kind)
 *   - stage change (matter.stageChanged | card.subStatusChanged)
 *
 * Formatters take the event kind, card title (if available), and contextual metadata
 * to produce compact, action-oriented notifications.
 */

export type NotificationFormat = {
	title: string;
	body?: string;
};

/**
 * Format a board event into a notification title + optional body.
 * Designed for both in-app bell (full text) and web push (compact).
 */
export function formatBoardEventNotification(
	kind: string,
	cardTitle?: string,
	context?: {
		actor?: string;
		// For assignment events
		assignee?: string;
		// For due date/deadline events
		daysUntilDue?: number;
		isOverdue?: boolean;
		// For stage/status changes
		oldStage?: string;
		newStage?: string;
		// For mention/comment events
		isMention?: boolean;
		// For approval events
		approvalAction?: 'requested' | 'approved' | 'rejected' | 'requested-changes';
	},
): NotificationFormat {
	const card = cardTitle ? `"${cardTitle}"` : 'Card';

	switch (kind) {
		case 'member.added':
			return {
				title: `You're assigned to ${card}`,
				body: context?.assignee ? `Assigned by ${context.assignee}` : undefined,
			};

		case 'card.dueSoon':
			if (context?.isOverdue) {
				return {
					title: `Overdue: ${card}`,
					body: `This card is overdue and needs your attention`,
				};
			}
			return {
				title: `Due soon: ${card}`,
				body: context?.daysUntilDue ? `Due in ${context.daysUntilDue} day${context.daysUntilDue === 1 ? '' : 's'}` : undefined,
			};

		case 'card.commented':
			if (context?.isMention) {
				return {
					title: `Mentioned in ${card}`,
					body: `Someone mentioned you in a comment`,
				};
			}
			return {
				title: `Comment on ${card}`,
				body: 'A new comment was added to this card',
			};

		case 'approval_requested':
		case 'automation:approval':
			return {
				title: `Approval needed for ${card}`,
				body: 'An approval request requires your action',
			};

		case 'approval_approved':
			return {
				title: `Approved: ${card}`,
				body: 'Your approval was confirmed',
			};

		case 'approval_rejected':
			return {
				title: `Changes requested on ${card}`,
				body: 'An approval request was sent back for changes',
			};

		case 'matter.stageChanged':
			return {
				title: `Stage changed: ${card}`,
				body: context?.newStage ? `Moved to ${context.newStage}` : 'Stage has been updated',
			};

		case 'card.subStatusChanged':
			return {
				title: `Status changed: ${card}`,
				body: context?.newStage ? `Status is now ${context.newStage}` : 'Status has been updated',
			};

		case 'card.created':
			return {
				title: `New card: ${card}`,
				body: 'A new card was created',
			};

		case 'card.moved':
			return {
				title: `Moved: ${card}`,
				body: 'This card was moved to a different list',
			};

		case 'due.set':
			return {
				title: `Due date set: ${card}`,
				body: 'A due date was assigned to this card',
			};

		case 'label.added':
			return {
				title: `Label added to ${card}`,
				body: 'A new label was applied to this card',
			};

		case 'checklist.itemChecked':
			return {
				title: `Progress: ${card}`,
				body: 'A checklist item was completed',
			};

		default:
			return {
				title: `Board notification: ${card}`,
				body: `Event: ${kind}`,
			};
	}
}
