/**
 * PURE card↔event mapping helpers (no Meteor / Mongo / network imports) so they unit-test directly.
 * The service composes these with the model + provider calls.
 */
import type { IBoardCard } from '@rocket.chat/core-typings';

import type { ICalendarEvent } from './CalendarProvider';

/** A due-dated deadline is rendered as a 1-hour block (matches the one-way iCal export DTEND rule). */
export const DUE_BLOCK_MS = 60 * 60 * 1000;

/**
 * Build the calendar event that mirrors a card's due date. Returns null when the card has no usable
 * due date (nothing to mirror). `siteUrl` (optional) produces the deep-link back to the card.
 */
export function cardToEvent(card: IBoardCard, siteUrl?: string): ICalendarEvent | null {
	const due = card.dueDate ? new Date(card.dueDate) : null;
	if (!due || Number.isNaN(due.getTime())) {
		return null;
	}
	const sourceUrl = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/admin/boards/${card.boardId}?card=${card._id}` : undefined;
	return {
		title: card.title?.trim() || 'Untitled card',
		...(card.description ? { description: card.description } : {}),
		start: due,
		end: new Date(due.getTime() + DUE_BLOCK_MS),
		...(sourceUrl ? { sourceUrl } : {}),
	};
}

/**
 * Decide the outbound action for a card given whether it already has a mirror on a connection and the
 * card's current due state. Pure so the branching is unit-tested without any I/O.
 *
 * - no due date + existing mirror        → 'delete' (the deadline was cleared)
 * - no due date + no mirror              → 'noop'
 * - due date + no mirror                 → 'create'
 * - due date + mirror, dueDate unchanged → 'noop' (avoid churning the calendar)
 * - due date + mirror, dueDate changed   → 'update'
 */
export function decideOutbound(
	card: Pick<IBoardCard, 'dueDate'>,
	existing: { externalEventId: string; lastPushedDueDate?: Date } | undefined,
): 'create' | 'update' | 'delete' | 'noop' {
	const due = card.dueDate ? new Date(card.dueDate) : null;
	const hasDue = Boolean(due && !Number.isNaN(due.getTime()));

	if (!hasDue) {
		return existing ? 'delete' : 'noop';
	}
	if (!existing) {
		return 'create';
	}
	const last = existing.lastPushedDueDate ? new Date(existing.lastPushedDueDate) : null;
	if (last && last.getTime() === due?.getTime()) {
		return 'noop';
	}
	return 'update';
}

/**
 * Decide whether an inbound event change should move the card's due date. Returns the new due date to
 * apply, or null when nothing should change. We only move a card when the event's START differs from
 * the card's current dueDate — i.e. the user dragged the event in their calendar. A cancelled event is
 * ignored here (deletion of a mirror event is handled by the service, not reflected as a due-date wipe,
 * to avoid a calendar-side delete silently unscheduling a legal deadline).
 */
export function decideInboundDueDate(card: Pick<IBoardCard, 'dueDate'>, event: Pick<ICalendarEvent, 'start' | 'cancelled'>): Date | null {
	if (event.cancelled) {
		return null;
	}
	const start = event.start ? new Date(event.start) : null;
	if (!start || Number.isNaN(start.getTime())) {
		return null;
	}
	const current = card.dueDate ? new Date(card.dueDate) : null;
	if (current?.getTime() === start.getTime()) {
		return null;
	}
	return start;
}
