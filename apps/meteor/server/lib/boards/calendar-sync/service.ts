/**
 * Calendar-sync service — outbound (card → calendar event) and inbound (calendar event → card due
 * date / new card) orchestration. Composes the pure mapping helpers with the model + provider + token
 * layers. All calendar HTTP goes through withFreshToken (proactive refresh + 401-retry + auth-death
 * marking) and the provider registry (never branches on provider).
 *
 * GATED: every entry point checks isCalendarSyncEnabled() first and no-ops when off — a disabled or
 * unconfigured instance makes ZERO external calls.
 */
import type { IBoardCalendarConnection, IBoardCard, ICardCalendarSync } from '@rocket.chat/core-typings';
import { BoardCalendarConnections, BoardsCards, BoardsLists } from '@rocket.chat/models';

import { settings } from '../../../../app/settings/server';
import { SystemLogger } from '../../logger/system';
import { createCard } from '../service';
import { isCalendarSyncEnabled, isProviderConfigured } from './config';
import { cardToEvent, decideInboundDueDate, decideOutbound } from './mapping';
import { getCalendarProvider } from './registry';
import { withFreshToken } from './tokens';

/** Full-sync inbound lookback window (a first poll won't pull the user's entire history). */
const INBOUND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function siteUrl(): string | undefined {
	return settings.get<string>('Site_Url') || undefined;
}

/** The mirror this connection already holds for a card, if any. */
function existingSyncFor(card: IBoardCard, connectionId: string): ICardCalendarSync | undefined {
	return (card.calendarSync || []).find((s) => s.connectionId === connectionId);
}

/**
 * Push ONE card's due-date state to ONE connected calendar (create / update / delete / noop). Records
 * or clears the card↔event correlation. Safe to call repeatedly (idempotent via decideOutbound). No-op
 * when sync is disabled or the connection isn't connected/configured.
 */
export async function pushCardToConnection(card: IBoardCard, conn: IBoardCalendarConnection): Promise<void> {
	if (!isCalendarSyncEnabled() || conn.status !== 'connected' || !isProviderConfigured(conn.provider)) {
		return;
	}
	const provider = getCalendarProvider(conn.provider);
	const existing = existingSyncFor(card, conn._id);
	const action = decideOutbound(card, existing);
	if (action === 'noop') {
		return;
	}

	if (action === 'delete' && existing) {
		await withFreshToken(conn, (token) => provider.deleteEvent(token, existing.externalCalendarId, existing.externalEventId));
		await BoardsCards.removeCalendarSync(card._id, conn._id);
		return;
	}

	const event = cardToEvent(card, siteUrl());
	if (!event) {
		return;
	}

	if (action === 'create') {
		const created = await withFreshToken(conn, (token) => provider.createEvent(token, conn.targetCalendarId, event));
		if (created.externalEventId) {
			await BoardsCards.upsertCalendarSync(
				card._id,
				buildSync(conn, created.externalEventId, conn.targetCalendarId, event.start, created.etag, created.updatedAt),
			);
		}
		return;
	}

	if (action === 'update' && existing) {
		const updated = await withFreshToken(conn, (token) =>
			provider.updateEvent(token, existing.externalCalendarId, existing.externalEventId, event),
		);
		await BoardsCards.upsertCalendarSync(
			card._id,
			buildSync(conn, existing.externalEventId, existing.externalCalendarId, event.start, updated.etag, updated.updatedAt),
		);
	}
}

function buildSync(
	conn: IBoardCalendarConnection,
	externalEventId: string,
	externalCalendarId: string,
	pushedDueDate: Date,
	etag: string | undefined,
	updatedAt: Date | undefined,
): ICardCalendarSync {
	return {
		connectionId: conn._id,
		userId: conn.userId,
		externalEventId,
		externalCalendarId,
		...(etag ? { externalEtag: etag } : {}),
		...(updatedAt ? { externalUpdatedAt: updatedAt } : {}),
		lastPushedDueDate: pushedDueDate,
		syncedAt: new Date(),
	};
}

/**
 * Sync ALL of one user's due-dated cards to their connected calendar(s). Scans the next 400 days of
 * assigned due cards + any card already mirrored on the connection (so a cleared due date is deleted).
 * Best-effort per card — one failing card never aborts the run.
 */
export async function pushUserCards(conn: IBoardCalendarConnection): Promise<{ pushed: number; failed: number }> {
	if (!isCalendarSyncEnabled() || conn.status !== 'connected') {
		return { pushed: 0, failed: 0 };
	}
	const now = new Date();
	const horizon = new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000);

	// Union of "assigned, due in window" and "already mirrored on this connection" (to catch deletes).
	const dueCards = await BoardsCards.findAssignedDueBetween(conn.userId, now, horizon).toArray();
	const mirrored = await BoardsCards.findByCalendarConnection(conn._id).toArray();
	const byId = new Map<string, IBoardCard>();
	for (const c of [...dueCards, ...mirrored]) {
		byId.set(c._id, c);
	}

	let pushed = 0;
	let failed = 0;
	for (const card of byId.values()) {
		try {
			await pushCardToConnection(card, conn);
			pushed++;
		} catch (err) {
			failed++;
			SystemLogger.warn({ msg: 'Boards calendar push failed for card', cardId: card._id, connectionId: conn._id, err: String(err) });
		}
	}
	await BoardCalendarConnections.setLastPushAtById(conn._id, new Date());
	return { pushed, failed };
}

/**
 * Poll ONE connection for calendar-side changes and reflect them:
 *  - a moved event whose card we mirror   → update that card's due date;
 *  - a brand-new event (not one we made)  → create a card on the opt-in inbound board (if configured).
 * Advances the sync cursor. Best-effort per event. No-op when disabled/unconnected.
 */
export async function pollConnection(conn: IBoardCalendarConnection): Promise<{ updated: number; created: number }> {
	if (!isCalendarSyncEnabled() || conn.status !== 'connected' || !isProviderConfigured(conn.provider)) {
		return { updated: 0, created: 0 };
	}
	const provider = getCalendarProvider(conn.provider);
	const windowStart = new Date(Date.now() - INBOUND_WINDOW_MS);

	const changes = await withFreshToken(conn, (token) => provider.listChanges(token, conn.targetCalendarId, conn.syncCursor, windowStart));

	let updated = 0;
	let created = 0;
	for (const event of changes.events) {
		if (!event.externalEventId) {
			continue;
		}
		try {
			const card = await BoardsCards.findOneByCalendarEvent(conn._id, event.externalEventId);
			if (card) {
				// A card we mirror moved in the calendar → reflect the new start onto the due date.
				const newDue = decideInboundDueDate(card, event);
				if (newDue) {
					await BoardsCards.setDueDate(card._id, newDue);
					await BoardsCards.upsertCalendarSync(
						card._id,
						buildSync(conn, event.externalEventId, conn.targetCalendarId, newDue, event.etag, event.updatedAt),
					);
					updated++;
				}
				continue;
			}
			// A brand-new event we did NOT create → opt-in "create a card from a calendar event".
			if (!event.cancelled && conn.inboundBoardId) {
				await createCardFromInboundEvent(conn, event.externalEventId, event.title, event.description, event.start);
				created++;
			}
		} catch (err) {
			SystemLogger.warn({
				msg: 'Boards calendar inbound event failed',
				connectionId: conn._id,
				eventId: event.externalEventId,
				err: String(err),
			});
		}
	}

	await BoardCalendarConnections.setSyncCursorById(conn._id, changes.nextCursor);
	await BoardCalendarConnections.setLastPollAtById(conn._id, new Date());
	return { updated, created };
}

/** Create a card from an inbound calendar event on the connection's opt-in board, and mirror it back. */
async function createCardFromInboundEvent(
	conn: IBoardCalendarConnection,
	externalEventId: string,
	title: string,
	description: string | undefined,
	start: Date,
): Promise<void> {
	const boardId = conn.inboundBoardId;
	if (!boardId) {
		return;
	}
	// Resolve the target list: the configured one, else the board's first list.
	let listId = conn.inboundListId;
	if (!listId) {
		const first = await BoardsLists.findOne({ boardId, archived: { $ne: true } }, { sort: { position: 1 }, projection: { _id: 1 } });
		listId = first?._id;
	}
	if (!listId) {
		return;
	}

	const card = await createCard(conn.userId, {
		boardId,
		listId,
		title: title?.trim() || '(untitled event)',
		...(description ? { description } : {}),
		cardType: 'task',
	});
	// Set the due date to the event start and record the correlation so we don't re-import it.
	await BoardsCards.setDueDate(card._id, start);
	await BoardsCards.upsertCalendarSync(card._id, {
		connectionId: conn._id,
		userId: conn.userId,
		externalEventId,
		externalCalendarId: conn.targetCalendarId,
		lastPushedDueDate: start,
		syncedAt: new Date(),
	});
}

/**
 * Tear down every mirror event this connection created (best-effort) — called on disconnect so a
 * user's calendar isn't left with orphaned MatterChat events. Removes the correlations too.
 */
export async function teardownConnectionMirrors(conn: IBoardCalendarConnection): Promise<void> {
	const provider = getCalendarProvider(conn.provider);
	const cards = await BoardsCards.findByCalendarConnection(conn._id).toArray();
	for (const card of cards) {
		const sync = existingSyncFor(card, conn._id);
		if (!sync) {
			continue;
		}
		try {
			await withFreshToken(conn, (token) => provider.deleteEvent(token, sync.externalCalendarId, sync.externalEventId));
		} catch (err) {
			SystemLogger.warn({ msg: 'Boards calendar mirror teardown failed', cardId: card._id, err: String(err) });
		}
		await BoardsCards.removeCalendarSync(card._id, conn._id);
	}
}
