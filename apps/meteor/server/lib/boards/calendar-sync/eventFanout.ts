/**
 * Card-event → calendar-push fan-out (Phase 3). Called fire-and-forget from emitBoardEvent when a
 * card is created/updated/moved/archived/deleted. Loads the card, finds the connected calendars of
 * everyone who should see it on their calendar (its assignees + anyone who already mirrors it), and
 * pushes each. GATED: no-ops entirely when calendar sync is disabled — zero external traffic.
 *
 * Kept in its own module so events.ts (a low-level lib) never eager-loads the sync/models graph.
 */
import { BoardCalendarConnections, BoardsCards } from '@rocket.chat/models';

import { isCalendarSyncEnabled } from './config';
import { pushCardToConnection } from './service';
import { SystemLogger } from '../../logger/system';

/**
 * Push one card to the connected calendars of its assignees (and any user already mirroring it, so an
 * unassignment or clear removes the stale mirror). Best-effort per connection. `cardId` may point at a
 * now-deleted card — we handle the missing-card case by pushing to existing mirrors for teardown.
 */
export async function pushCardOnEvent(cardId: string): Promise<void> {
	if (!isCalendarSyncEnabled()) {
		return;
	}
	const card = await BoardsCards.findOneById(cardId);
	if (!card) {
		return;
	}

	// The set of users whose calendars this card should touch: current assignees + anyone with an
	// existing mirror (to catch delete-on-unassign / clear).
	const userIds = new Set<string>([...(card.assignees || []), ...(card.calendarSync || []).map((s) => s.userId)]);
	if (!userIds.size) {
		return;
	}

	for (const userId of userIds) {
		let conns;
		try {
			conns = await BoardCalendarConnections.findByUserId(userId).toArray();
		} catch (err) {
			SystemLogger.debug({ msg: 'boards.calendar.fanout.connLookupFailed', userId, err: String(err) });
			continue;
		}
		for (const conn of conns) {
			if (conn.status !== 'connected') {
				continue;
			}
			try {
				await pushCardToConnection(card, conn);
			} catch (err) {
				SystemLogger.warn({ msg: 'boards.calendar.fanout.pushFailed', cardId, connectionId: conn._id, err: String(err) });
			}
		}
	}
}
