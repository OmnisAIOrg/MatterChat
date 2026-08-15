import { expect } from 'chai';
import { describe, it } from 'mocha';

import type { NotificationEvent, NotificationRule } from '../../../../../../server/lib/chi/notify/notificationRules';
import {
	MAX_RULES_PER_USER,
	appendRule,
	buildRule,
	crossesMidnight,
	describeRule,
	describeRules,
	evaluateRules,
	eventMinutesOfDay,
	inWindow,
	isValidRule,
	keywordMatches,
	matchesRule,
	parseTimeOfDay,
	removeRule,
	specificity,
	validRules,
} from '../../../../../../server/lib/chi/notify/notificationRules';

/** A rule with a generated id, so tests only state the part that matters. */
let seq = 0;
const rule = (r: Partial<NotificationRule> & { action: NotificationRule['action'] }): NotificationRule => ({
	...r,
	id: r.id || `r${++seq}`,
});

/** UTC clock time for an event; tests pass tzOffsetMinutes explicitly when they care. */
const at = (hh: number, mm = 0): Date => new Date(Date.UTC(2026, 7, 14, hh, mm, 0));

const event = (e: Partial<NotificationEvent> = {}): NotificationEvent => ({
	roomId: 'room1',
	roomName: 'general',
	roomType: 'c',
	senderUsername: 'dana',
	senderRoles: ['user'],
	text: 'a perfectly ordinary message',
	at: at(12),
	tzOffsetMinutes: 0,
	...e,
});

describe('chi/notify/notificationRules', () => {
	/* ───────────────────────── conservative defaults ───────────────────────── */

	describe('baseline with no rules (the hard floor)', () => {
		it('interrupts on a direct mention', () => {
			const d = evaluateRules([], event({ isMention: true }));
			expect(d.action).to.equal('interrupt');
			expect(d.ruleId).to.equal(undefined);
			expect(d.matchedRuleIds).to.deep.equal([]);
			expect(d.reason).to.contain('mentioned directly');
		});

		it('interrupts on a DM flagged with isDM', () => {
			expect(evaluateRules([], event({ isDM: true })).action).to.equal('interrupt');
		});

		it('interrupts on a DM inferred from roomType "d"', () => {
			const d = evaluateRules([], event({ roomType: 'd', roomName: 'dana' }));
			expect(d.action).to.equal('interrupt');
			expect(d.reason).to.contain('direct message');
		});

		it('sends ordinary channel traffic to the digest', () => {
			const d = evaluateRules([], event());
			expect(d.action).to.equal('digest');
			expect(d.reason).to.contain('No rule matched');
		});

		it('never throws on a missing / malformed rules value', () => {
			for (const bad of [undefined, null, 'nope', 42, {}, [null], [undefined]]) {
				expect(evaluateRules(bad, event({ isMention: true })).action, JSON.stringify(bad)).to.equal('interrupt');
				expect(evaluateRules(bad, event()).action, JSON.stringify(bad)).to.equal('digest');
			}
		});

		it('does not need an `at` to decide (defaults to now)', () => {
			const e = event();
			delete e.at;
			expect(evaluateRules([], e).action).to.equal('digest');
			expect(eventMinutesOfDay(e)).to.be.at.least(0).and.at.most(1439);
		});
	});

	/* ───────────────────────── mention protection ───────────────────────── */

	describe('mention protection (a digest rule may not swallow a mention)', () => {
		const quietRandom = rule({ action: 'digest', channel: 'random' });

		it('ignores a matching digest rule when the user was mentioned', () => {
			const d = evaluateRules([quietRandom], event({ roomName: 'random', isMention: true }));
			expect(d.action).to.equal('interrupt');
			expect(d.matchedRuleIds).to.deep.equal([quietRandom.id]); // it matched...
			expect(d.ruleId).to.equal(undefined); // ...but it did not decide
			expect(d.reason).to.contain('never downgrades');
		});

		it('ignores a matching digest rule in a DM', () => {
			const quiet = rule({ action: 'digest', sender: 'dana' });
			expect(evaluateRules([quiet], event({ isDM: true })).action).to.equal('interrupt');
		});

		it('honours a digest rule that explicitly opts in with includeMentions', () => {
			const quiet = rule({ action: 'digest', channel: 'random', includeMentions: true });
			const d = evaluateRules([quiet], event({ roomName: 'random', isMention: true }));
			expect(d.action).to.equal('digest');
			expect(d.ruleId).to.equal(quiet.id);
		});

		it('lets an explicit silence rule suppress a direct mention (the deliberate escape hatch)', () => {
			const never = rule({ action: 'silence', keyword: 'Wilson' });
			const d = evaluateRules([never], event({ text: 'Wilson filed today', isMention: true }));
			expect(d.action).to.equal('silence');
			expect(d.ruleId).to.equal(never.id);
		});

		it('lets an explicit silence rule suppress a DM', () => {
			const never = rule({ action: 'silence', sender: 'noisybot' });
			expect(evaluateRules([never], event({ isDM: true, senderUsername: 'noisybot' })).action).to.equal('silence');
		});

		it('applies a digest rule normally when there is no mention', () => {
			const d = evaluateRules([quietRandom], event({ roomName: 'random' }));
			expect(d.action).to.equal('digest');
			expect(d.ruleId).to.equal(quietRandom.id);
		});
	});

	/* ───────────────────────── matching ───────────────────────── */

	describe('channel / room matching', () => {
		it('matches the room name case-insensitively', () => {
			expect(matchesRule(rule({ action: 'interrupt', channel: 'HERNANDEZ' }), event({ roomName: 'hernandez' }))).to.equal(true);
		});

		it('matches a channel name as a substring of the room name', () => {
			expect(matchesRule(rule({ action: 'interrupt', channel: 'hernandez' }), event({ roomName: 'hernandez-v-state' }))).to.equal(true);
		});

		it('tolerates a leading # on the rule', () => {
			expect(matchesRule(rule({ action: 'interrupt', channel: '#ops' }), event({ roomName: 'ops' }))).to.equal(true);
		});

		it('does not match an unrelated room', () => {
			expect(matchesRule(rule({ action: 'interrupt', channel: 'hernandez' }), event({ roomName: 'general' }))).to.equal(false);
		});

		it('does not match when the event has no room name', () => {
			expect(matchesRule(rule({ action: 'interrupt', channel: 'ops' }), event({ roomName: undefined }))).to.equal(false);
		});

		it('matches an exact roomId and rejects a different one', () => {
			expect(matchesRule(rule({ action: 'interrupt', roomId: 'room1' }), event())).to.equal(true);
			expect(matchesRule(rule({ action: 'interrupt', roomId: 'room2' }), event())).to.equal(false);
		});
	});

	describe('sender and role matching', () => {
		it('matches a username case-insensitively and ignores a leading @', () => {
			expect(matchesRule(rule({ action: 'interrupt', sender: '@Dana' }), event({ senderUsername: 'dana' }))).to.equal(true);
		});

		it('rejects a different sender', () => {
			expect(matchesRule(rule({ action: 'interrupt', sender: 'sam' }), event({ senderUsername: 'dana' }))).to.equal(false);
		});

		it('matches a role the sender holds, case-insensitively', () => {
			expect(matchesRule(rule({ action: 'interrupt', senderRole: 'Partner' }), event({ senderRoles: ['user', 'partner'] }))).to.equal(true);
		});

		it('rejects a role the sender does not hold, and a missing roles list', () => {
			expect(matchesRule(rule({ action: 'interrupt', senderRole: 'partner' }), event({ senderRoles: ['user'] }))).to.equal(false);
			expect(matchesRule(rule({ action: 'interrupt', senderRole: 'partner' }), event({ senderRoles: undefined }))).to.equal(false);
		});
	});

	describe('keyword matching', () => {
		it('is case-insensitive', () => {
			expect(keywordMatches('sol', 'The SOL date is Friday')).to.equal(true);
			expect(keywordMatches('SOL', 'the sol date')).to.equal(true);
		});

		it('matches whole words only — not substrings of unrelated words', () => {
			expect(keywordMatches('SOL', 'solution')).to.equal(false);
			expect(keywordMatches('SOL', 'resolve the issue')).to.equal(false);
			expect(keywordMatches('SOL', 'unresolved')).to.equal(false);
		});

		it('matches next to punctuation', () => {
			expect(keywordMatches('SOL', 'what about the SOL?')).to.equal(true);
			expect(keywordMatches('SOL', '(SOL)')).to.equal(true);
			expect(keywordMatches('offer', 'their offer, finally')).to.equal(true);
		});

		it('matches multi-word phrases', () => {
			expect(keywordMatches('settlement offer', 'we got a Settlement Offer today')).to.equal(true);
			expect(keywordMatches('settlement offer', 'we got a settlement, and an offer')).to.equal(false);
		});

		it('does not require word boundaries around non-word edges', () => {
			expect(keywordMatches(':fire:', 'ship it :fire:')).to.equal(true);
			expect(keywordMatches('$5,000', 'they offered $5,000 flat')).to.equal(true);
		});

		it('escapes regex metacharacters instead of interpreting them', () => {
			expect(keywordMatches('c++', 'we use c++ here')).to.equal(true);
			expect(keywordMatches('a.c', 'abc')).to.equal(false);
		});

		it('returns false for empty text or an empty keyword', () => {
			expect(keywordMatches('sol', '')).to.equal(false);
			expect(keywordMatches('sol', undefined)).to.equal(false);
			expect(keywordMatches('   ', 'anything')).to.equal(false);
		});

		it('is wired into matchesRule', () => {
			const r = rule({ action: 'interrupt', keyword: 'Hernandez' });
			expect(matchesRule(r, event({ text: 'Hernandez v. State was continued' }))).to.equal(true);
			expect(matchesRule(r, event({ text: 'nothing relevant' }))).to.equal(false);
		});
	});

	describe('conditions AND together', () => {
		it('requires every declared condition to hold', () => {
			const r = rule({ action: 'digest', channel: 'ops', sender: 'dana' });
			expect(matchesRule(r, event({ roomName: 'ops', senderUsername: 'dana' }))).to.equal(true);
			expect(matchesRule(r, event({ roomName: 'ops', senderUsername: 'sam' }))).to.equal(false);
			expect(matchesRule(r, event({ roomName: 'general', senderUsername: 'dana' }))).to.equal(false);
		});
	});

	/* ───────────────────────── time windows ───────────────────────── */

	describe('time-of-day windows', () => {
		const day = { from: '09:00', to: '17:00' };
		const night = { from: '19:00', to: '08:00' };

		it('treats `from` as inclusive and `to` as exclusive within one day', () => {
			expect(inWindow(9 * 60, day)).to.equal(true); // 09:00 exactly — in
			expect(inWindow(9 * 60 - 1, day)).to.equal(false); // 08:59 — out
			expect(inWindow(17 * 60 - 1, day)).to.equal(true); // 16:59 — in
			expect(inWindow(17 * 60, day)).to.equal(false); // 17:00 exactly — out
		});

		it('wraps a window whose end is before its start (the midnight case)', () => {
			expect(crossesMidnight(night)).to.equal(true);
			expect(crossesMidnight(day)).to.equal(false);
			expect(inWindow(19 * 60, night)).to.equal(true); // 19:00 exactly — in
			expect(inWindow(19 * 60 - 1, night)).to.equal(false); // 18:59 — out
			expect(inWindow(23 * 60 + 59, night)).to.equal(true); // 23:59 — in
			expect(inWindow(0, night)).to.equal(true); // 00:00 — in
			expect(inWindow(7 * 60 + 59, night)).to.equal(true); // 07:59 — in
			expect(inWindow(8 * 60, night)).to.equal(false); // 08:00 exactly — out
			expect(inWindow(12 * 60, night)).to.equal(false); // midday — out
		});

		it('never matches a zero-length or unreadable window', () => {
			expect(inWindow(9 * 60, { from: '09:00', to: '09:00' })).to.equal(false);
			expect(inWindow(9 * 60, { from: 'nonsense', to: '17:00' })).to.equal(false);
		});

		it('reads the clock in the user\'s timezone, not UTC', () => {
			// 02:00 UTC is 21:00 the previous evening in UTC-5 — inside quiet hours.
			const e = event({ at: at(2), tzOffsetMinutes: -300 });
			expect(eventMinutesOfDay(e)).to.equal(21 * 60);
			expect(matchesRule(rule({ action: 'digest', window: night }), e)).to.equal(true);
			// The same instant in UTC+0 is 02:00 — also inside the overnight window.
			expect(eventMinutesOfDay(event({ at: at(2) }))).to.equal(2 * 60);
			// ...but 14:00 UTC in UTC+0 is not.
			expect(matchesRule(rule({ action: 'digest', window: night }), event({ at: at(14) }))).to.equal(false);
		});

		it('wraps the offset past midnight in both directions', () => {
			expect(eventMinutesOfDay(event({ at: at(23), tzOffsetMinutes: 120 }))).to.equal(60); // 23:00 UTC +2h → 01:00
			expect(eventMinutesOfDay(event({ at: at(1), tzOffsetMinutes: -180 }))).to.equal(22 * 60); // 01:00 UTC -3h → 22:00
		});

		it('applies the window through evaluateRules', () => {
			const quietHours = rule({ action: 'digest', window: night });
			expect(evaluateRules([quietHours], event({ at: at(20) })).action).to.equal('digest');
			expect(evaluateRules([quietHours], event({ at: at(20) })).ruleId).to.equal(quietHours.id);
			expect(evaluateRules([quietHours], event({ at: at(10) })).matchedRuleIds).to.deep.equal([]);
		});
	});

	/* ───────────────────────── precedence ───────────────────────── */

	describe('precedence', () => {
		it('lets the MORE SPECIFIC rule win, in either authoring order', () => {
			// "nothing after 7pm unless it's from a partner"
			const quiet = rule({ action: 'digest', window: { from: '19:00', to: '08:00' } });
			const partner = rule({ action: 'interrupt', window: { from: '19:00', to: '08:00' }, senderRole: 'partner' });
			const evening = event({ at: at(20), senderRoles: ['user', 'partner'] });

			expect(specificity(quiet)).to.equal(1);
			expect(specificity(partner)).to.equal(2);

			for (const order of [[quiet, partner], [partner, quiet]]) {
				const d = evaluateRules(order, evening);
				expect(d.action).to.equal('interrupt');
				expect(d.ruleId).to.equal(partner.id);
				expect(d.matchedRuleIds).to.have.members([quiet.id, partner.id]);
			}
		});

		it('still applies the broad rule when the specific one does not match', () => {
			const quiet = rule({ action: 'digest', window: { from: '19:00', to: '08:00' } });
			const partner = rule({ action: 'interrupt', window: { from: '19:00', to: '08:00' }, senderRole: 'partner' });
			const d = evaluateRules([quiet, partner], event({ at: at(20), senderRoles: ['user'] }));
			expect(d.action).to.equal('digest');
			expect(d.ruleId).to.equal(quiet.id);
		});

		it('breaks a specificity tie toward the MORE PERMISSIVE action (interrupt > digest > silence)', () => {
			const loud = rule({ action: 'interrupt', channel: 'ops' });
			const quiet = rule({ action: 'digest', channel: 'ops' });
			const off = rule({ action: 'silence', channel: 'ops' });
			const e = event({ roomName: 'ops' });

			expect(evaluateRules([quiet, loud], e).action).to.equal('interrupt');
			expect(evaluateRules([loud, quiet], e).action).to.equal('interrupt');
			expect(evaluateRules([off, quiet], e).action).to.equal('digest');
			expect(evaluateRules([quiet, off], e).action).to.equal('digest');
			expect(evaluateRules([off, loud], e).action).to.equal('interrupt');
			expect(evaluateRules([off, quiet, loud], e).action).to.equal('interrupt');
		});

		it('reports the LATER rule when specificity and action are both equal', () => {
			const first = rule({ action: 'digest', channel: 'ops' });
			const second = rule({ action: 'digest', channel: 'op' });
			const d = evaluateRules([first, second], event({ roomName: 'ops' }));
			expect(d.action).to.equal('digest');
			expect(d.ruleId).to.equal(second.id);
		});

		it('does not let a later BROADER rule override an earlier specific one', () => {
			const specific = rule({ action: 'interrupt', channel: 'hernandez', keyword: 'hearing' });
			const broad = rule({ action: 'silence', channel: 'hernandez' });
			const d = evaluateRules([specific, broad], event({ roomName: 'hernandez', text: 'the hearing moved to 9am' }));
			expect(d.action).to.equal('interrupt');
			expect(d.ruleId).to.equal(specific.id);
		});

		it('reports every matching rule, including ones that did not decide', () => {
			const a = rule({ action: 'digest', channel: 'ops' });
			const b = rule({ action: 'interrupt', channel: 'ops', keyword: 'urgent' });
			const d = evaluateRules([a, b], event({ roomName: 'ops', text: 'urgent: server down' }));
			expect(d.matchedRuleIds).to.have.members([a.id, b.id]);
			expect(d.ruleId).to.equal(b.id);
			expect(d.reason).to.contain('Your rule:');
		});
	});

	/* ───────────────────────── malformed input ───────────────────────── */

	describe('malformed and partial rules are ignored, never thrown on', () => {
		const bad: unknown[] = [
			null,
			undefined,
			'a string',
			42,
			[],
			{}, // no id, no action
			{ id: 'x' }, // no action
			{ id: 'x', action: 'panic', channel: 'ops' }, // unknown action
			{ id: '', action: 'digest', channel: 'ops' }, // empty id
			{ id: 'x', action: 'digest' }, // no conditions at all
			{ id: 'x', action: 'digest', channel: '' }, // empty condition
			{ id: 'x', action: 'digest', channel: 12 }, // wrong type
			{ id: 'x', action: 'digest', window: { from: '19:00' } }, // half a window
			{ id: 'x', action: 'digest', window: { from: '25:00', to: '08:00' } }, // impossible time
			{ id: 'x', action: 'digest', window: { from: '7pm', to: '08:00' } }, // not canonicalised
			{ id: 'x', action: 'digest', window: { from: '09:00', to: '09:00' } }, // zero length
			{ id: 'x', action: 'digest', channel: 'ops', includeMentions: 'yes' }, // wrong type
		];

		it('rejects each of them in isValidRule', () => {
			for (const b of bad) {
				expect(isValidRule(b), JSON.stringify(b)).to.equal(false);
			}
		});

		it('filters them out of a stored list', () => {
			const good = rule({ action: 'digest', channel: 'ops' });
			expect(validRules([...bad, good])).to.deep.equal([good]);
		});

		it('evaluates the surviving rules and leaves the defaults intact', () => {
			const good = rule({ action: 'digest', channel: 'ops' });
			const list = [...bad, good];
			expect(evaluateRules(list, event({ roomName: 'ops' })).action).to.equal('digest');
			expect(evaluateRules(list, event({ roomName: 'ops', isMention: true })).action).to.equal('interrupt');
			expect(evaluateRules(bad, event({ roomName: 'ops' })).action).to.equal('digest');
			expect(evaluateRules(bad, event({ isMention: true })).action).to.equal('interrupt');
		});

		it('never matches an invalid rule directly either', () => {
			expect(matchesRule({ id: 'x', action: 'panic' } as unknown as NotificationRule, event())).to.equal(false);
		});
	});

	/* ───────────────────────── buildRule (what the tool hands in) ───────────────────────── */

	describe('buildRule', () => {
		it('builds a minimal valid rule', () => {
			const r = buildRule({ id: 'abc', action: 'interrupt', channel: 'hernandez' });
			expect(r.ok).to.equal(true);
			if (r.ok) {
				expect(r.rule).to.include({ id: 'abc', action: 'interrupt', channel: 'hernandez' });
				expect(r.rule.window).to.equal(undefined);
			}
		});

		it('strips a leading # or @ from channel and sender', () => {
			const r = buildRule({ id: 'abc', action: 'digest', channel: '#ops', sender: '@dana' });
			expect(r.ok && r.rule.channel).to.equal('ops');
			expect(r.ok && r.rule.sender).to.equal('dana');
		});

		it('canonicalises times, including 12-hour input', () => {
			const r = buildRule({ id: 'abc', action: 'digest', from: '7pm', to: '8 AM' });
			expect(r.ok && r.rule.window).to.deep.equal({ from: '19:00', to: '08:00' });
		});

		it('rejects a missing or unknown action', () => {
			expect(buildRule({ id: 'a', channel: 'ops' }).ok).to.equal(false);
			const r = buildRule({ id: 'a', action: 'panic', channel: 'ops' });
			expect(r.ok).to.equal(false);
			expect(!r.ok && r.error).to.contain('interrupt');
		});

		it('rejects a rule with no conditions', () => {
			const r = buildRule({ id: 'a', action: 'digest' });
			expect(r.ok).to.equal(false);
			expect(!r.ok && r.error).to.contain('at least one condition');
		});

		it('rejects half a time window', () => {
			expect(buildRule({ id: 'a', action: 'digest', from: '19:00' }).ok).to.equal(false);
			expect(buildRule({ id: 'a', action: 'digest', to: '08:00' }).ok).to.equal(false);
		});

		it('rejects an unreadable time', () => {
			const r = buildRule({ id: 'a', action: 'digest', from: 'sometime later', to: '08:00' });
			expect(r.ok).to.equal(false);
			expect(!r.ok && r.error).to.contain('sometime later');
		});

		it('rejects a zero-length window', () => {
			const r = buildRule({ id: 'a', action: 'digest', from: '09:00', to: '9am' });
			expect(r.ok).to.equal(false);
			expect(!r.ok && r.error).to.contain('same time');
		});

		it('rejects over-long text and non-text fields', () => {
			expect(buildRule({ id: 'a', action: 'digest', keyword: 'x'.repeat(121) }).ok).to.equal(false);
			expect(buildRule({ id: 'a', action: 'digest', channel: 'y'.repeat(101) }).ok).to.equal(false);
			expect(buildRule({ id: 'a', action: 'digest', channel: { name: 'ops' } }).ok).to.equal(false);
		});

		it('only stores includeMentions when it is exactly true, and rejects non-booleans', () => {
			expect(buildRule({ id: 'a', action: 'digest', channel: 'ops', includeMentions: false }).ok).to.equal(true);
			const off = buildRule({ id: 'a', action: 'digest', channel: 'ops', includeMentions: false });
			expect(off.ok && 'includeMentions' in off.rule).to.equal(false);
			const on = buildRule({ id: 'a', action: 'digest', channel: 'ops', includeMentions: true });
			expect(on.ok && on.rule.includeMentions).to.equal(true);
			expect(buildRule({ id: 'a', action: 'digest', channel: 'ops', includeMentions: 'yes' }).ok).to.equal(false);
		});

		it('treats blank optional fields as absent rather than as conditions', () => {
			const r = buildRule({ id: 'a', action: 'digest', channel: '   ', sender: '', keyword: 'ops' });
			expect(r.ok && r.rule.channel).to.equal(undefined);
			expect(r.ok && specificity(r.rule)).to.equal(1);
			expect(buildRule({ id: 'a', action: 'digest', channel: '  ' }).ok).to.equal(false);
		});
	});

	describe('parseTimeOfDay', () => {
		it('accepts the forms a model is likely to emit', () => {
			expect(parseTimeOfDay('19:00')).to.equal('19:00');
			expect(parseTimeOfDay('7:30')).to.equal('07:30');
			expect(parseTimeOfDay('07:30')).to.equal('07:30');
			expect(parseTimeOfDay('7pm')).to.equal('19:00');
			expect(parseTimeOfDay('7 PM')).to.equal('19:00');
			expect(parseTimeOfDay('7:15 p.m.')).to.equal('19:15');
			expect(parseTimeOfDay('12am')).to.equal('00:00');
			expect(parseTimeOfDay('12pm')).to.equal('12:00');
			expect(parseTimeOfDay('noon')).to.equal('12:00');
			expect(parseTimeOfDay('midnight')).to.equal('00:00');
			expect(parseTimeOfDay('19')).to.equal('19:00');
			expect(parseTimeOfDay('00:00')).to.equal('00:00');
			expect(parseTimeOfDay('23:59')).to.equal('23:59');
		});

		it('rejects everything else', () => {
			for (const bad of ['', '   ', '24:00', '23:60', '25', '13pm', '0pm', 'later', 'half past six', undefined, null, 19]) {
				expect(parseTimeOfDay(bad), String(bad)).to.equal(undefined);
			}
		});
	});

	/* ───────────────────────── the per-user cap ───────────────────────── */

	describe('appendRule and the per-user cap', () => {
		const fill = (n: number): NotificationRule[] => Array.from({ length: n }, (_, i) => rule({ action: 'digest', channel: `c${i}` }));

		it('caps at MAX_RULES_PER_USER', () => {
			expect(MAX_RULES_PER_USER).to.equal(20);
			const full = fill(MAX_RULES_PER_USER);
			const r = appendRule(full, rule({ action: 'digest', channel: 'one-too-many' }));
			expect(r.ok).to.equal(false);
			expect(!r.ok && r.error).to.contain(String(MAX_RULES_PER_USER));
			expect(!r.ok && r.error).to.contain('Remove one first');
		});

		it('accepts the rule that lands exactly on the cap', () => {
			const r = appendRule(fill(MAX_RULES_PER_USER - 1), rule({ action: 'digest', channel: 'last' }));
			expect(r.ok).to.equal(true);
			expect(r.ok && r.rules).to.have.length(MAX_RULES_PER_USER);
		});

		it('does not count unreadable rows toward the cap', () => {
			const junk = Array.from({ length: 5 }, () => ({ id: '', action: 'nope' }));
			const r = appendRule([...fill(MAX_RULES_PER_USER - 1), ...junk], rule({ action: 'digest', channel: 'last' }));
			expect(r.ok).to.equal(true);
			expect(r.ok && r.rules).to.have.length(MAX_RULES_PER_USER);
		});

		it('appends to the end and leaves the existing rules untouched', () => {
			const existing = fill(2);
			const added = rule({ action: 'interrupt', keyword: 'urgent' });
			const r = appendRule(existing, added);
			expect(r.ok && r.rules).to.deep.equal([...existing, added]);
		});

		it('rejects an exact duplicate, whatever its id', () => {
			const existing = [rule({ id: 'first', action: 'digest', channel: 'ops' })];
			const r = appendRule(existing, rule({ id: 'second', action: 'digest', channel: 'OPS' }));
			expect(r.ok).to.equal(false);
			expect(!r.ok && r.error).to.contain('already have that rule');
		});

		it('allows a same-condition rule with a different action', () => {
			const existing = [rule({ action: 'digest', channel: 'ops' })];
			expect(appendRule(existing, rule({ action: 'interrupt', channel: 'ops' })).ok).to.equal(true);
		});

		it('starts from an empty list for a garbage stored value', () => {
			const r = appendRule('not an array', rule({ action: 'digest', channel: 'ops' }));
			expect(r.ok && r.rules).to.have.length(1);
		});
	});

	/* ───────────────────────── removal ───────────────────────── */

	describe('removeRule', () => {
		const list = (): NotificationRule[] => [
			rule({ id: 'aaa', action: 'digest', channel: 'ops' }),
			rule({ id: 'bbb', action: 'interrupt', keyword: 'urgent' }),
			rule({ id: 'ccc', action: 'silence', sender: 'bot' }),
		];

		it('removes by 1-based position', () => {
			const r = removeRule(list(), '2');
			expect(r.ok && r.removed.id).to.equal('bbb');
			expect(r.ok && r.rules.map((x) => x.id)).to.deep.equal(['aaa', 'ccc']);
		});

		it('removes by id', () => {
			const r = removeRule(list(), 'ccc');
			expect(r.ok && r.removed.id).to.equal('ccc');
			expect(r.ok && r.rules).to.have.length(2);
		});

		it('prefers an id over a position when a rule is literally named "2"', () => {
			const rules = [rule({ id: '2', action: 'digest', channel: 'a' }), rule({ id: 'zzz', action: 'digest', channel: 'b' })];
			const r = removeRule(rules, '2');
			expect(r.ok && r.removed.id).to.equal('2');
			expect(r.ok && r.rules.map((x) => x.id)).to.deep.equal(['zzz']);
		});

		it('rejects an out-of-range position and an unknown id', () => {
			for (const ref of ['0', '4', '99', 'nope']) {
				const r = removeRule(list(), ref);
				expect(r.ok, ref).to.equal(false);
				expect(!r.ok && r.error).to.contain('couldn\'t find');
			}
		});

		it('rejects an empty reference and an empty list', () => {
			expect(removeRule(list(), '  ').ok).to.equal(false);
			expect(removeRule([], '1').ok).to.equal(false);
			expect(removeRule(undefined, '1').ok).to.equal(false);
		});
	});

	/* ───────────────────────── rendering ───────────────────────── */

	describe('describeRule', () => {
		it('renders each action with its phrase', () => {
			expect(describeRule(rule({ action: 'interrupt', channel: 'hernandez' }))).to.equal('Interrupt me — in #hernandez');
			expect(describeRule(rule({ action: 'digest', channel: 'random' }))).to.equal('Send to digest — in #random');
			expect(describeRule(rule({ action: 'silence', sender: 'bot' }))).to.equal('Silence — from @bot');
		});

		it('normalises names it renders', () => {
			expect(describeRule(rule({ action: 'digest', channel: '#Hernandez-V-State' }))).to.equal('Send to digest — in #hernandez-v-state');
			expect(describeRule(rule({ action: 'digest', sender: '@Dana' }))).to.equal('Send to digest — from @dana');
		});

		it('renders roles, keywords and rooms', () => {
			expect(describeRule(rule({ action: 'interrupt', senderRole: 'partner' }))).to.equal('Interrupt me — from anyone with the "partner" role');
			expect(describeRule(rule({ action: 'interrupt', keyword: 'settlement offer' }))).to.equal('Interrupt me — mentioning "settlement offer"');
			expect(describeRule(rule({ action: 'digest', roomId: 'GENERAL' }))).to.equal('Send to digest — in room GENERAL');
		});

		it('flags an overnight window and leaves a same-day one plain', () => {
			expect(describeRule(rule({ action: 'digest', window: { from: '19:00', to: '08:00' } }))).to.equal(
				'Send to digest — between 19:00 and 08:00 (overnight)',
			);
			expect(describeRule(rule({ action: 'digest', window: { from: '09:00', to: '17:00' } }))).to.equal(
				'Send to digest — between 09:00 and 17:00',
			);
		});

		it('renders every condition in a fixed order, then the mention opt-in', () => {
			const r = rule({
				action: 'digest',
				channel: 'ops',
				roomId: 'R1',
				sender: 'dana',
				senderRole: 'partner',
				keyword: 'deploy',
				window: { from: '19:00', to: '08:00' },
				includeMentions: true,
			});
			expect(describeRule(r)).to.equal(
				'Send to digest — in #ops, in room R1, from @dana, from anyone with the "partner" role, mentioning "deploy", between 19:00 and 08:00 (overnight) (even when you are mentioned directly)',
			);
		});

		it('degrades safely on an unreadable rule', () => {
			expect(describeRule(undefined)).to.equal('Unreadable rule (ignored).');
			expect(describeRule({ id: 'x', action: 'panic' })).to.equal('Unreadable rule (ignored).');
		});

		it('numbers the list and shows each id, skipping unreadable rows', () => {
			const a = rule({ id: 'aaa', action: 'interrupt', channel: 'hernandez' });
			const b = rule({ id: 'bbb', action: 'silence', sender: 'bot' });
			expect(describeRules([a, { nope: true }, b])).to.deep.equal([
				'1. Interrupt me — in #hernandez  `aaa`',
				'2. Silence — from @bot  `bbb`',
			]);
			expect(describeRules(undefined)).to.deep.equal([]);
		});
	});

	/* ───────────────────────── the worked examples from the spec ───────────────────────── */

	describe('the sentences this feature exists for', () => {
		it('"only interrupt me for the Hernandez matter"', () => {
			const rules = [rule({ action: 'interrupt', channel: 'hernandez' })];
			expect(evaluateRules(rules, event({ roomName: 'hernandez-v-state' })).action).to.equal('interrupt');
			expect(evaluateRules(rules, event({ roomName: 'watercooler' })).action).to.equal('digest');
			// ...and it still cannot hide someone tagging them elsewhere.
			expect(evaluateRules(rules, event({ roomName: 'watercooler', isMention: true })).action).to.equal('interrupt');
		});

		it('"nothing after 7pm unless it\'s from a partner"', () => {
			const rules = [
				rule({ action: 'digest', window: { from: '19:00', to: '08:00' } }),
				rule({ action: 'interrupt', window: { from: '19:00', to: '08:00' }, senderRole: 'partner' }),
			];
			const late = { at: at(23, 30) };
			expect(evaluateRules(rules, event({ ...late, senderRoles: ['user'] })).action).to.equal('digest');
			expect(evaluateRules(rules, event({ ...late, senderRoles: ['partner'] })).action).to.equal('interrupt');
			// 07:59 is still "after 7pm"; 08:00 is not.
			expect(evaluateRules(rules, event({ at: at(7, 59), senderRoles: ['user'] })).action).to.equal('digest');
			expect(evaluateRules(rules, event({ at: at(8, 0), senderRoles: ['user'] })).action).to.equal('digest'); // baseline, not the rule
			expect(evaluateRules(rules, event({ at: at(8, 0), senderRoles: ['user'] })).ruleId).to.equal(undefined);
			// a mention at midnight from a non-partner still gets through
			expect(evaluateRules(rules, event({ ...late, senderRoles: ['user'], isMention: true })).action).to.equal('interrupt');
		});
	});
});
