import type { IBoardCard } from '@rocket.chat/core-typings';

import { getMyDayCards } from './reads';

/**
 * iCal (.ics) calendar feed of a user's due cards (RFC 5545).
 *
 * Reuses getMyDayCards — the same "every card assigned to me that has a due date, across all my
 * boards" query that powers boards.cards.myDay — and renders one VEVENT per card so the user can
 * subscribe to their Omnis Boards deadlines in Google / Apple / Outlook Calendar.
 *
 * The body is a plain RFC-5545 string (CRLF line endings); the route sets Content-Type:
 * text/calendar so calendar clients consume it directly.
 */

const PRODID = '-//OmnisAI//MatterChat Boards//EN';

/** RFC-5545 TEXT escaping: backslash, semicolon, comma and newlines must be escaped. */
function escapeText(value: string): string {
	return String(value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');
}

/** Format a Date as a UTC iCal timestamp: YYYYMMDDTHHMMSSZ. */
function toICalDate(date: Date): string {
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * RFC-5545 line folding: lines longer than 75 octets must be folded with CRLF + a single space.
 * We fold on character count (a safe approximation for the ASCII-heavy content we emit).
 */
function foldLine(line: string): string {
	if (line.length <= 75) {
		return line;
	}
	const chunks: string[] = [line.slice(0, 75)];
	let rest = line.slice(75);
	while (rest.length > 74) {
		chunks.push(` ${rest.slice(0, 74)}`);
		rest = rest.slice(74);
	}
	if (rest.length) {
		chunks.push(` ${rest}`);
	}
	return chunks.join('\r\n');
}

/** Stable UID per card so re-subscribes / refreshes update (not duplicate) the event. */
function cardUid(card: IBoardCard): string {
	return `boards-card-${card._id}@matterchat`;
}

function buildVEvent(card: IBoardCard, dtstamp: string, siteUrl?: string): string[] {
	const due = card.dueDate ? new Date(card.dueDate) : null;
	if (!due || Number.isNaN(due.getTime())) {
		return [];
	}
	// DTSTART = due date; DTEND = due date + 1h (a point-in-time deadline rendered as a short block).
	const dtStart = toICalDate(due);
	const dtEnd = toICalDate(new Date(due.getTime() + 60 * 60 * 1000));

	const lines = [
		'BEGIN:VEVENT',
		`UID:${cardUid(card)}`,
		`DTSTAMP:${dtstamp}`,
		`DTSTART:${dtStart}`,
		`DTEND:${dtEnd}`,
		`SUMMARY:${escapeText(card.title || 'Untitled card')}`,
	];
	if (card.description) {
		lines.push(`DESCRIPTION:${escapeText(card.description)}`);
	}
	if (siteUrl) {
		const base = siteUrl.replace(/\/+$/, '');
		lines.push(`URL:${escapeText(`${base}/admin/boards/${card.boardId}?card=${card._id}`)}`);
	}
	if (card.priority) {
		// RFC-5545 PRIORITY: 1 (high) .. 9 (low); map our 4-level scale.
		const map: Record<string, number> = { urgent: 1, high: 3, medium: 5, low: 7 };
		lines.push(`PRIORITY:${map[card.priority] ?? 0}`);
	}
	const status = card.completed || card.dueComplete ? 'COMPLETED' : 'CONFIRMED';
	lines.push(`STATUS:${status}`);
	lines.push('END:VEVENT');
	return lines;
}

/**
 * Build the full VCALENDAR document (RFC 5545) of the user's due cards.
 * `siteUrl` (optional) is the site's base URL, used to emit a per-card URL property.
 */
export async function buildICalForUser(uid: string, siteUrl?: string): Promise<string> {
	const { cards } = await getMyDayCards(uid);
	const dtstamp = toICalDate(new Date());

	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${PRODID}`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'X-WR-CALNAME:MatterChat Boards — My deadlines',
	];

	for (const card of cards) {
		lines.push(...buildVEvent(card, dtstamp, siteUrl));
	}

	lines.push('END:VCALENDAR');

	// CRLF line endings per RFC 5545, with long-line folding.
	return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
