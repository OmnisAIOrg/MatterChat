import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	DEFAULT_REMINDER_HOUR,
	MAX_REMINDER_DAYS,
	describeReminder,
	describeWhen,
	parseTimeOfDay,
	resolveReminderTime,
	validateReminderTime,
} from '../../../../../../server/lib/chi/reminders/reminderHelpers';

// A fixed clock: Wednesday 2026-08-12, 14:30 local.
const NOW = new Date(2026, 7, 12, 14, 30, 0, 0);

const resolve = (when: string, now: Date = NOW): Date | null => resolveReminderTime({ when, now });

describe('reminderHelpers', () => {
	describe('parseTimeOfDay', () => {
		it('reads 12-hour times with a meridiem', () => {
			expect(parseTimeOfDay('9am')).to.deep.equal({ hour: 9, minute: 0 });
			expect(parseTimeOfDay('9:30 pm')).to.deep.equal({ hour: 21, minute: 30 });
			expect(parseTimeOfDay('at 5 PM please')).to.deep.equal({ hour: 17, minute: 0 });
		});

		it('handles the two times a day the +12 rule gets wrong', () => {
			expect(parseTimeOfDay('12am')).to.deep.equal({ hour: 0, minute: 0 });
			expect(parseTimeOfDay('12pm')).to.deep.equal({ hour: 12, minute: 0 });
			expect(parseTimeOfDay('12:15am')).to.deep.equal({ hour: 0, minute: 15 });
		});

		it('reads 24-hour times', () => {
			expect(parseTimeOfDay('17:00')).to.deep.equal({ hour: 17, minute: 0 });
			expect(parseTimeOfDay('08:45')).to.deep.equal({ hour: 8, minute: 45 });
		});

		it('rejects impossible clock values instead of wrapping them', () => {
			expect(parseTimeOfDay('25:00')).to.be.null;
			expect(parseTimeOfDay('10:75')).to.be.null;
			expect(parseTimeOfDay('13pm')).to.be.null;
			expect(parseTimeOfDay('0am')).to.be.null;
		});

		it('returns null when there is no time of day', () => {
			expect(parseTimeOfDay('thursday')).to.be.null;
			expect(parseTimeOfDay('')).to.be.null;
		});
	});

	describe('resolveReminderTime — relative offsets', () => {
		it('handles minutes, hours, days and weeks', () => {
			expect(resolve('in 20 minutes')?.getTime()).to.equal(NOW.getTime() + 20 * 60_000);
			expect(resolve('in 2 hours')?.getTime()).to.equal(NOW.getTime() + 2 * 3_600_000);
			expect(resolve('in 3 days')?.getTime()).to.equal(NOW.getTime() + 3 * 86_400_000);
			expect(resolve('in 1 week')?.getTime()).to.equal(NOW.getTime() + 7 * 86_400_000);
		});

		it('accepts abbreviated units', () => {
			expect(resolve('in 5 min')?.getTime()).to.equal(NOW.getTime() + 5 * 60_000);
			expect(resolve('in 1 hr')?.getTime()).to.equal(NOW.getTime() + 3_600_000);
		});
	});

	describe('resolveReminderTime — day references', () => {
		it('defaults a bare day to the default hour', () => {
			const tomorrow = resolve('tomorrow');
			expect(tomorrow?.getDate()).to.equal(13);
			expect(tomorrow?.getHours()).to.equal(DEFAULT_REMINDER_HOUR);
			expect(tomorrow?.getMinutes()).to.equal(0);
		});

		it('honours an explicit time alongside the day', () => {
			const t = resolve('tomorrow at 4:15pm');
			expect(t?.getDate()).to.equal(13);
			expect(t?.getHours()).to.equal(16);
			expect(t?.getMinutes()).to.equal(15);
		});

		it('resolves a named weekday forward from today', () => {
			// NOW is Wednesday; Friday is 2 days away.
			const friday = resolve('friday');
			expect(friday?.getDay()).to.equal(5);
			expect(friday?.getDate()).to.equal(14);
		});

		it("reads today's own weekday as next week, not the past", () => {
			// NOW is Wednesday 14:30. "wednesday" must not resolve to this morning.
			const wednesday = resolve('wednesday');
			expect(wednesday?.getDay()).to.equal(3);
			expect(wednesday?.getTime()).to.be.greaterThan(NOW.getTime());
			expect(wednesday?.getDate()).to.equal(19);
		});

		it('treats "next <weekday>" as the one after this week\'s', () => {
			const nextFriday = resolve('next friday');
			expect(nextFriday?.getDay()).to.equal(5);
			expect(nextFriday?.getDate()).to.equal(21);
		});

		it('handles "next week"', () => {
			const t = resolve('next week');
			expect(t?.getDate()).to.equal(19);
			expect(t?.getHours()).to.equal(DEFAULT_REMINDER_HOUR);
		});

		it('puts "tonight" in the evening', () => {
			const t = resolve('tonight');
			expect(t?.getDate()).to.equal(12);
			expect(t?.getHours()).to.equal(19);
		});
	});

	describe('resolveReminderTime — bare times', () => {
		it('uses today when the time is still ahead', () => {
			const t = resolve('at 4pm');
			expect(t?.getDate()).to.equal(12);
			expect(t?.getHours()).to.equal(16);
		});

		it('rolls to tomorrow when the time has already passed today', () => {
			// NOW is 14:30, so 9am today is behind us.
			const t = resolve('9am');
			expect(t?.getDate()).to.equal(13);
			expect(t?.getHours()).to.equal(9);
		});

		it('never returns a past instant for "later today"', () => {
			const t = resolve('later today');
			expect(t?.getTime()).to.be.greaterThan(NOW.getTime());
		});
	});

	describe('resolveReminderTime — unparseable input', () => {
		it('returns null rather than guessing', () => {
			for (const phrase of ['', '   ', 'sometime', 'when the case settles', 'asap', 'xyzzy']) {
				expect(resolve(phrase), `phrase "${phrase}"`).to.be.null;
			}
		});
	});

	describe('validateReminderTime', () => {
		it('accepts a sensible future time', () => {
			const result = validateReminderTime({ when: 'in 2 hours', now: NOW });
			expect(result.ok).to.be.true;
			if (result.ok) {
				expect(result.at.getTime()).to.equal(NOW.getTime() + 2 * 3_600_000);
			}
		});

		it('explains an unparseable phrase instead of failing silently', () => {
			const result = validateReminderTime({ when: 'whenever', now: NOW });
			expect(result.ok).to.be.false;
			if (!result.ok) {
				expect(result.reason).to.contain("couldn't work out");
			}
		});

		it('rejects a time essentially in the present', () => {
			const result = validateReminderTime({ when: 'in 0 minutes', now: NOW });
			expect(result.ok).to.be.false;
		});

		it('rejects an absurdly distant time as a likely mis-parse', () => {
			const result = validateReminderTime({ when: `in ${MAX_REMINDER_DAYS + 30} days`, now: NOW });
			expect(result.ok).to.be.false;
			if (!result.ok) {
				expect(result.reason).to.contain('misread');
			}
		});

		it('accepts the far edge of the allowed window', () => {
			expect(validateReminderTime({ when: `in ${MAX_REMINDER_DAYS - 1} days`, now: NOW }).ok).to.be.true;
		});
	});

	describe('describeWhen', () => {
		it('describes minutes, hours and days', () => {
			expect(describeWhen(new Date(NOW.getTime() + 5 * 60_000), NOW)).to.equal('in 5 minutes');
			expect(describeWhen(new Date(NOW.getTime() + 60_000), NOW)).to.equal('in 1 minute');
			expect(describeWhen(new Date(NOW.getTime() + 3 * 3_600_000), NOW)).to.equal('in 3 hours');
			expect(describeWhen(new Date(NOW.getTime() + 2 * 86_400_000), NOW)).to.equal('in 2 days');
		});

		it('calls a past reminder overdue', () => {
			expect(describeWhen(new Date(NOW.getTime() - 60_000), NOW)).to.equal('overdue');
		});

		it('never says "in 0 minutes"', () => {
			expect(describeWhen(new Date(NOW.getTime() + 1_000), NOW)).to.equal('in 1 minute');
		});
	});

	describe('describeReminder', () => {
		it('numbers the entry and states where and when', () => {
			const line = describeReminder(
				{ _id: 'a', kind: 'timer', note: 'chase the adjuster', dueAt: new Date(NOW.getTime() + 86_400_000), roomLabel: '#intake' },
				NOW,
				0,
			);
			expect(line).to.equal('1. chase the adjuster in #intake — in 1 day');
		});

		it('flags a conditional follow-up', () => {
			const line = describeReminder(
				{ _id: 'b', kind: 'no-reply', note: 'opposing counsel', dueAt: new Date(NOW.getTime() + 2 * 86_400_000) },
				NOW,
				1,
			);
			expect(line).to.contain('(only if nobody replies)');
			expect(line.startsWith('2. ')).to.be.true;
		});

		it('falls back to a generic label when the note is empty', () => {
			const line = describeReminder({ _id: 'c', kind: 'timer', note: '', dueAt: new Date(NOW.getTime() + 3_600_000) }, NOW, 0);
			expect(line).to.contain('Reminder');
		});
	});
});
