/**
 * MATTERCHAT: pure helpers for Chi reminders and follow-ups.
 *
 * No Meteor, model, settings, or clock access — `now` is always passed in, so
 * every case here is deterministic under test (see
 * tests/unit/server/lib/chi/reminders/).
 *
 * ## Why parse time here and not in the model
 *
 * The calling model turns "remind me Thursday" into a structured argument, but
 * it is unreliable about what Thursday MEANS relative to now, and a reminder
 * that fires on the wrong day is worse than none — the user stops trusting the
 * feature after a single miss. So the model passes a phrase and we resolve it
 * against a real clock, with the boundary cases pinned by tests.
 */

export type ReminderKind = 'timer' | 'no-reply';

export type ReminderInput = {
	/** Natural phrase from the user, e.g. "thursday", "in 2 hours", "tomorrow 9am". */
	when: string;
	now: Date;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Default hour-of-day for a bare day reference ("thursday" → Thursday 09:00). */
export const DEFAULT_REMINDER_HOUR = 9;

/** Furthest ahead a reminder may be set. Beyond this it is almost always a parse error. */
export const MAX_REMINDER_DAYS = 365;

/** Soonest a reminder may be set — under a minute is a mis-parse, not an intent. */
export const MIN_REMINDER_MS = 30_000;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const atHour = (base: Date, hour: number, minute = 0): Date => {
	const d = new Date(base.getTime());
	d.setHours(hour, minute, 0, 0);
	return d;
};

/**
 * Pull an explicit clock time out of a phrase: "9am", "9:30 pm", "17:00".
 * Returns null when the phrase carries no time of day.
 */
export const parseTimeOfDay = (phrase: string): { hour: number; minute: number } | null => {
	const text = phrase.toLowerCase();

	const meridiem = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
	if (meridiem) {
		const rawHour = Number(meridiem[1]);
		const minute = Number(meridiem[2] ?? 0);
		if (rawHour < 1 || rawHour > 12 || minute > 59) {
			return null;
		}
		const isPm = meridiem[3] === 'pm';
		// 12am is midnight (0) and 12pm is noon (12) — the one case where the
		// usual "+12 for pm" arithmetic gives the wrong answer twice a day.
		const hour = rawHour === 12 ? (isPm ? 12 : 0) : isPm ? rawHour + 12 : rawHour;
		return { hour, minute };
	}

	const twentyFour = text.match(/\b(\d{1,2}):(\d{2})\b/);
	if (twentyFour) {
		const hour = Number(twentyFour[1]);
		const minute = Number(twentyFour[2]);
		if (hour > 23 || minute > 59) {
			return null;
		}
		return { hour, minute };
	}

	return null;
};

/**
 * Resolve a phrase to an absolute instant.
 *
 * Returns null when the phrase cannot be understood. Callers surface that as a
 * question back to the user — guessing produces a reminder that fires at a time
 * nobody asked for, which is how people learn to distrust it.
 */
export const resolveReminderTime = ({ when, now }: ReminderInput): Date | null => {
	const phrase = (when || '').trim().toLowerCase();
	if (!phrase) {
		return null;
	}

	const time = parseTimeOfDay(phrase);

	// "in 20 minutes" / "in 2 hours" / "in 3 days" / "in 1 week"
	const relative = phrase.match(/\bin\s+(\d+)\s*(minute|min|hour|hr|day|week)s?\b/);
	if (relative) {
		const amount = Number(relative[1]);
		const unit = relative[2];
		const ms =
			unit === 'minute' || unit === 'min'
				? amount * MINUTE
				: unit === 'hour' || unit === 'hr'
					? amount * HOUR
					: unit === 'day'
						? amount * DAY
						: amount * 7 * DAY;
		return new Date(now.getTime() + ms);
	}

	if (/\btomorrow\b/.test(phrase)) {
		const base = new Date(now.getTime() + DAY);
		return atHour(base, time?.hour ?? DEFAULT_REMINDER_HOUR, time?.minute ?? 0);
	}

	if (/\btonight\b/.test(phrase)) {
		return atHour(now, time?.hour ?? 19, time?.minute ?? 0);
	}

	if (/\b(today|later)\b/.test(phrase)) {
		const candidate = atHour(now, time?.hour ?? now.getHours() + 1, time?.minute ?? 0);
		// "later today" after the target hour has passed means the next hour, not
		// a time already behind us.
		return candidate.getTime() > now.getTime() ? candidate : new Date(now.getTime() + HOUR);
	}

	// "next week"
	if (/\bnext\s+week\b/.test(phrase)) {
		const base = new Date(now.getTime() + 7 * DAY);
		return atHour(base, time?.hour ?? DEFAULT_REMINDER_HOUR, time?.minute ?? 0);
	}

	// A named weekday: "thursday", "next thursday", "on friday".
	const dayIndex = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}\\b`).test(phrase));
	if (dayIndex >= 0) {
		let delta = (dayIndex - now.getDay() + 7) % 7;
		const explicitlyNext = /\bnext\b/.test(phrase);
		if (delta === 0) {
			// Naming today's weekday means next week's, not five minutes ago.
			delta = 7;
		} else if (explicitlyNext && delta < 7) {
			// "next friday" said on a Wednesday means the Friday after this one.
			delta += 7;
		}
		const base = new Date(now.getTime() + delta * DAY);
		return atHour(base, time?.hour ?? DEFAULT_REMINDER_HOUR, time?.minute ?? 0);
	}

	// A bare time of day with no day reference: the next occurrence of it.
	if (time) {
		const candidate = atHour(now, time.hour, time.minute);
		return candidate.getTime() > now.getTime() ? candidate : new Date(candidate.getTime() + DAY);
	}

	return null;
};

export type ReminderValidation = { ok: true; at: Date } | { ok: false; reason: string };

/**
 * Resolve and sanity-check in one step. The bounds exist to catch mis-parses,
 * not to police the user: a reminder 400 days out is almost always a phrase we
 * read wrongly, and firing it is worse than admitting we did not understand.
 */
export const validateReminderTime = (input: ReminderInput): ReminderValidation => {
	const at = resolveReminderTime(input);
	if (!at) {
		return { ok: false, reason: `I couldn't work out when "${input.when}" is. Try "tomorrow 9am", "in 2 hours", or "Thursday".` };
	}
	const delta = at.getTime() - input.now.getTime();
	if (delta < MIN_REMINDER_MS) {
		return { ok: false, reason: 'That time has already passed — give me a time in the future.' };
	}
	if (delta > MAX_REMINDER_DAYS * DAY) {
		return { ok: false, reason: `That is more than ${MAX_REMINDER_DAYS} days away — I probably misread it. Try an explicit date.` };
	}
	return { ok: true, at };
};

/** Compact, human relative description used when listing reminders. */
export const describeWhen = (at: Date, now: Date): string => {
	const delta = at.getTime() - now.getTime();
	if (delta < 0) {
		return 'overdue';
	}
	if (delta < HOUR) {
		const mins = Math.max(1, Math.round(delta / MINUTE));
		return `in ${mins} minute${mins === 1 ? '' : 's'}`;
	}
	if (delta < DAY) {
		const hours = Math.round(delta / HOUR);
		return `in ${hours} hour${hours === 1 ? '' : 's'}`;
	}
	const days = Math.round(delta / DAY);
	return `in ${days} day${days === 1 ? '' : 's'}`;
};

export type ReminderRecord = {
	_id: string;
	kind: ReminderKind;
	note: string;
	dueAt: Date;
	rid?: string;
	roomLabel?: string;
	messageId?: string;
};

/** One line per reminder for the list tool. */
export const describeReminder = (reminder: ReminderRecord, now: Date, index: number): string => {
	const where = reminder.roomLabel ? ` in ${reminder.roomLabel}` : '';
	const conditional = reminder.kind === 'no-reply' ? ' (only if nobody replies)' : '';
	return `${index + 1}. ${reminder.note || 'Reminder'}${where} — ${describeWhen(reminder.dueAt, now)}${conditional}`;
};
