/**
 * CasePro-preferred calendar orchestration — the outbound push + inbound poll for a user whose calendar
 * sync routes THROUGH CasePro (see caseproBridge.ts for the layered/additive rationale). Mirrors the
 * standalone service's push/poll choreography but talks to CasePro's calendar controller via the bridge
 * instead of holding a Google/Outlook token.
 *
 * Correlation reuses the SAME `card.calendarSync[]` store the standalone path uses, with a stable
 * sentinel connection id `casepro:<subject>` and `externalCalendarId: 'casepro'`. The `externalEventId`
 * is the CasePro calendar ROW id (returned by POST /calendar/create) — that's what update/delete key on.
 * So a card can hold at most one CasePro mirror per user, exactly like one standalone mirror per
 * connection, and the two never collide (distinct connectionId namespaces).
 *
 * GATED: every entry point is reached only after `getCaseProBridgeForUser` returned a bridge (CasePro
 * active + user linked + CasePro calendar connected). When it returns null the caller runs the
 * unchanged standalone path — nothing here executes.
 */
import type { IBoardCard, ICardCalendarSync } from '@rocket.chat/core-typings';
import { BoardsCards } from '@rocket.chat/models';

import { settings } from '../../../settings';
import { SystemLogger } from '../../logger/system';
import type { CaseProCalendarBridge } from './caseproBridge';
import { cardToEvent, decideInboundDueDate, decideOutbound } from './mapping';

/** The sentinel connection id namespacing CasePro mirrors on a card (distinct from real connection _ids). */
export function caseProConnectionId(subject: string): string {
	return `casepro:${subject}`;
}

/** Inbound lookback window (mirrors the standalone poll: don't pull a user's whole history on first poll). */
const INBOUND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Outbound horizon for the user sweep (mirrors the standalone 400-day window). */
const OUTBOUND_HORIZON_MS = 400 * 24 * 60 * 60 * 1000;

function siteUrl(): string | undefined {
	return settings.get<string>('Site_Url') || undefined;
}

function existingCaseProSyncFor(card: IBoardCard, connectionId: string): ICardCalendarSync | undefined {
	return (card.calendarSync || []).find((s) => s.connectionId === connectionId);
}

function buildSync(connectionId: string, userId: string, caseproRowId: string, pushedDueDate: Date): ICardCalendarSync {
	return {
		connectionId,
		userId,
		externalEventId: caseproRowId,
		externalCalendarId: 'casepro',
		lastPushedDueDate: pushedDueDate,
		syncedAt: new Date(),
	};
}

/**
 * Push ONE card's due-date state through CasePro for ONE user (create / update / delete / noop). Records
 * or clears the card↔CasePro-row correlation. Idempotent via decideOutbound (same decision table as the
 * standalone path). `userId` is the MatterChat user; the bridge is already bound to their CasePro subject.
 */
export async function pushCardThroughCasePro(card: IBoardCard, userId: string, bridge: CaseProCalendarBridge): Promise<void> {
	const connectionId = caseProConnectionId(bridge.subject);
	const existing = existingCaseProSyncFor(card, connectionId);
	const action = decideOutbound(card, existing);
	if (action === 'noop') {
		return;
	}

	if (action === 'delete' && existing) {
		await bridge.deleteEvent(existing.externalEventId);
		await BoardsCards.removeCalendarSync(card._id, connectionId);
		return;
	}

	const event = cardToEvent(card, siteUrl());
	if (!event) {
		return;
	}

	if (action === 'create') {
		const rowId = await bridge.createEvent(event);
		if (rowId) {
			await BoardsCards.upsertCalendarSync(card._id, buildSync(connectionId, userId, rowId, event.start));
		}
		return;
	}

	if (action === 'update' && existing) {
		await bridge.updateEvent(existing.externalEventId, event);
		await BoardsCards.upsertCalendarSync(card._id, buildSync(connectionId, userId, existing.externalEventId, event.start));
	}
}

/**
 * Sweep ALL of a user's due-dated cards through CasePro (cron / syncNow). Scans the outbound window of
 * assigned due cards + any card already mirrored on the CasePro connection (so a cleared due date is
 * deleted). Best-effort per card. Returns counts.
 */
export async function pushUserCardsThroughCasePro(
	userId: string,
	bridge: CaseProCalendarBridge,
): Promise<{ pushed: number; failed: number }> {
	const subject = bridge.subject;
	const connectionId = caseProConnectionId(subject);
	const now = new Date();
	const horizon = new Date(now.getTime() + OUTBOUND_HORIZON_MS);

	const dueCards = await BoardsCards.findAssignedDueBetween(userId, now, horizon).toArray();
	const mirrored = await BoardsCards.findByCalendarConnection(connectionId).toArray();
	const byId = new Map<string, IBoardCard>();
	for (const c of [...dueCards, ...mirrored]) {
		byId.set(c._id, c);
	}

	let pushed = 0;
	let failed = 0;
	for (const card of byId.values()) {
		try {
			await pushCardThroughCasePro(card, userId, bridge);
			pushed++;
		} catch (err) {
			failed++;
			SystemLogger.warn({ msg: 'boards.calendar.casepro.push.failed', cardId: card._id, userId, err: String(err) });
		}
	}
	return { pushed, failed };
}

/**
 * Poll CasePro for calendar-side changes for a user and reflect them onto mirrored cards' due dates.
 * Only moves the due date of a card we already mirror (matched by CasePro row id); it does NOT create
 * cards from CasePro-side events (inbound card-creation stays a standalone opt-in via inboundBoardId —
 * CasePro is the system of record for its own calendar, so we don't re-import its events as cards).
 * Best-effort per event.
 */
export async function pollCasePro(userId: string, bridge: CaseProCalendarBridge): Promise<{ updated: number }> {
	const subject = bridge.subject;
	const connectionId = caseProConnectionId(subject);
	const windowStart = new Date(Date.now() - INBOUND_WINDOW_MS);
	const windowEnd = new Date(Date.now() + OUTBOUND_HORIZON_MS);

	const events = await bridge.listEvents(windowStart, windowEnd);
	let updated = 0;
	for (const raw of events) {
		// CasePro all-events rows: our own mirrors carry the CasePro row id in `id`; the merged external
		// rows use synthetic `external-*` ids we never created, so they won't match a mirror and are skipped.
		const rowId = typeof raw.id === 'string' ? raw.id : undefined;
		if (!rowId) {
			continue;
		}
		const card = await BoardsCards.findOneByCalendarEvent(connectionId, rowId);
		if (!card) {
			continue;
		}
		const start = pickStart(raw);
		if (!start) {
			continue;
		}
		const newDue = decideInboundDueDate(card, { start, cancelled: false });
		if (newDue) {
			await BoardsCards.setDueDate(card._id, newDue);
			await BoardsCards.upsertCalendarSync(card._id, buildSync(connectionId, userId, rowId, newDue));
			updated++;
		}
	}
	return { updated };
}

/** Tear down every CasePro mirror event for a user (best-effort) — used when CasePro sync is turned off. */
export async function teardownCaseProMirrors(userId: string, bridge: CaseProCalendarBridge): Promise<void> {
	const subject = bridge.subject;
	const connectionId = caseProConnectionId(subject);
	const cards = await BoardsCards.findByCalendarConnection(connectionId).toArray();
	for (const card of cards) {
		const sync = existingCaseProSyncFor(card, connectionId);
		if (!sync) {
			continue;
		}
		try {
			await bridge.deleteEvent(sync.externalEventId);
		} catch (err) {
			SystemLogger.warn({ msg: 'boards.calendar.casepro.teardown.failed', cardId: card._id, userId, err: String(err) });
		}
		await BoardsCards.removeCalendarSync(card._id, connectionId);
	}
}

/** CasePro calendar rows expose start as `start` / `start_time` (local) or `.start.dateTime` (external). */
function pickStart(raw: Record<string, unknown>): Date | undefined {
	const candidate =
		(typeof raw.start === 'string' && raw.start) ||
		(typeof raw.start_time === 'string' && raw.start_time) ||
		(raw.start && typeof raw.start === 'object' && typeof (raw.start as { dateTime?: unknown }).dateTime === 'string'
			? (raw.start as { dateTime: string }).dateTime
			: undefined);
	if (!candidate) {
		return undefined;
	}
	const d = new Date(candidate);
	return Number.isNaN(d.getTime()) ? undefined : d;
}
