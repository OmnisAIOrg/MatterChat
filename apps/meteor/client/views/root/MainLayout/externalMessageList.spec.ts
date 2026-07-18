import { EXTERNAL_GROUP_WINDOW_MS, classifyDay, dayKeyOf, isSameMessageGroup } from './externalMessageList';

/**
 * externalMessageList — the pure grouping/day-separator rules behind the Slack-style message list:
 * same author + ≤5 min + same day collapses into a group; Today/Yesterday/other day labels;
 * everything defensive against the malformed provider timestamps that have crashed this view before.
 */

const msg = (author: string, createdAt: unknown): { author: string; createdAt: unknown } => ({ author, createdAt });

describe('isSameMessageGroup', () => {
	const base = '2026-07-17T10:00:00.000Z';

	it('groups same author within the 5-minute window', () => {
		expect(isSameMessageGroup(msg('amy', base), msg('amy', '2026-07-17T10:04:59.000Z'))).toBe(true);
	});

	it('groups messages with identical timestamps', () => {
		expect(isSameMessageGroup(msg('amy', base), msg('amy', base))).toBe(true);
	});

	it('breaks the group beyond 5 minutes', () => {
		expect(isSameMessageGroup(msg('amy', base), msg('amy', '2026-07-17T10:05:01.000Z'))).toBe(false);
	});

	it('accepts exactly the window boundary', () => {
		const at = new Date(new Date(base).getTime() + EXTERNAL_GROUP_WINDOW_MS).toISOString();
		expect(isSameMessageGroup(msg('amy', base), msg('amy', at))).toBe(true);
	});

	it('breaks the group on a different author', () => {
		expect(isSameMessageGroup(msg('amy', base), msg('bob', base))).toBe(false);
	});

	it('breaks the group when messages are out of order', () => {
		expect(isSameMessageGroup(msg('amy', '2026-07-17T10:04:00.000Z'), msg('amy', base))).toBe(false);
	});

	it('breaks the group across midnight (different local day)', () => {
		// Construct two local-time dates straddling local midnight, 2 minutes apart.
		const beforeMidnight = new Date(2026, 6, 16, 23, 59, 0);
		const afterMidnight = new Date(2026, 6, 17, 0, 1, 0);
		expect(isSameMessageGroup(msg('amy', beforeMidnight), msg('amy', afterMidnight))).toBe(false);
	});

	it('answers false (never throws) on missing/invalid inputs', () => {
		expect(isSameMessageGroup(undefined, msg('amy', base))).toBe(false);
		expect(isSameMessageGroup(msg('amy', base), null)).toBe(false);
		expect(isSameMessageGroup(msg('', base), msg('', base))).toBe(false);
		expect(isSameMessageGroup(msg('amy', 'not-a-date'), msg('amy', base))).toBe(false);
		expect(isSameMessageGroup(msg('amy', base), msg('amy', undefined))).toBe(false);
		expect(isSameMessageGroup(msg('amy', base), msg('amy', {}))).toBe(false);
	});
});

describe('dayKeyOf', () => {
	it('returns a stable key for the same local day and differs across days', () => {
		expect(dayKeyOf(new Date(2026, 6, 17, 1, 0, 0))).toBe(dayKeyOf(new Date(2026, 6, 17, 23, 0, 0)));
		expect(dayKeyOf(new Date(2026, 6, 17))).not.toBe(dayKeyOf(new Date(2026, 6, 16)));
	});

	it('returns null for garbage (→ no separator, no crash)', () => {
		expect(dayKeyOf('1626200000.000200-nope')).toBeNull();
		expect(dayKeyOf(undefined)).toBeNull();
		expect(dayKeyOf({})).toBeNull();
		expect(dayKeyOf('')).toBeNull();
	});
});

describe('classifyDay', () => {
	const now = new Date(2026, 6, 17, 12, 0, 0);

	it('labels today / yesterday / other', () => {
		expect(classifyDay(new Date(2026, 6, 17, 8, 0, 0), now)).toBe('today');
		expect(classifyDay(new Date(2026, 6, 16, 23, 0, 0), now)).toBe('yesterday');
		expect(classifyDay(new Date(2026, 6, 10), now)).toBe('other');
	});

	it('handles yesterday across a month boundary', () => {
		const firstOfMonth = new Date(2026, 6, 1, 9, 0, 0);
		expect(classifyDay(new Date(2026, 5, 30, 22, 0, 0), firstOfMonth)).toBe('yesterday');
	});

	it('returns invalid for unparsable input (never throws)', () => {
		expect(classifyDay('nope', now)).toBe('invalid');
		expect(classifyDay(undefined, now)).toBe('invalid');
	});
});
