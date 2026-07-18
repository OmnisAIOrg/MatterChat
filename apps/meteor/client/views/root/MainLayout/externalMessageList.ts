/**
 * externalMessageList — pure list-shaping helpers for the external channel message list.
 *
 * Slack-style presentation rules, kept OUT of the component so they are trivially unit-testable:
 *  - consecutive messages from the SAME author within 5 minutes (and the same day) collapse into one
 *    group — avatar + name render once, the rest are dense continuation rows;
 *  - a light day-separator line (Today / Yesterday / date) precedes the first message of each day.
 *
 * Everything is defensive: a missing author or an unparsable timestamp simply breaks the group /
 * skips the separator — never throws (provider timestamps have crashed this view before).
 */

export const EXTERNAL_GROUP_WINDOW_MS = 5 * 60 * 1000;

type Groupable = { author?: string; createdAt?: unknown } | undefined | null;

const toTime = (value: unknown): number | null => {
	if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
		return null;
	}
	const t = new Date(value).getTime();
	return Number.isNaN(t) ? null : t;
};

/** Local calendar-day key for a timestamp, or null when it can't be parsed (→ no separator). */
export const dayKeyOf = (value: unknown): string | null => {
	const t = toTime(value);
	return t === null ? null : new Date(t).toDateString();
};

/**
 * Should `next` render as a dense continuation of `prev` (same author, ≤ 5 min apart, same day)?
 * Any missing/invalid field answers false — a full author row is always the safe fallback.
 */
export const isSameMessageGroup = (prev: Groupable, next: Groupable): boolean => {
	if (!prev || !next || !prev.author || !next.author || prev.author !== next.author) {
		return false;
	}
	const a = toTime(prev.createdAt);
	const b = toTime(next.createdAt);
	if (a === null || b === null) {
		return false;
	}
	if (new Date(a).toDateString() !== new Date(b).toDateString()) {
		return false;
	}
	const diff = b - a;
	return diff >= 0 && diff <= EXTERNAL_GROUP_WINDOW_MS;
};

/**
 * Bucket a timestamp for the day-separator label. 'invalid' means "don't show a separator";
 * 'other' means "let the caller format the date". `now` is injectable for tests.
 */
export const classifyDay = (value: unknown, now: Date = new Date()): 'today' | 'yesterday' | 'other' | 'invalid' => {
	const key = dayKeyOf(value);
	if (key === null) {
		return 'invalid';
	}
	if (key === now.toDateString()) {
		return 'today';
	}
	const yesterday = new Date(now.getTime());
	yesterday.setDate(yesterday.getDate() - 1);
	if (key === yesterday.toDateString()) {
		return 'yesterday';
	}
	return 'other';
};
