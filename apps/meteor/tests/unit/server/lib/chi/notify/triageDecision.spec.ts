import { expect } from 'chai';
import { describe, it } from 'mocha';

import type { NotificationEvent, NotificationRule } from '../../../../../../server/lib/chi/notify/notificationRules';
import {
	TRIAGE_PASS,
	isSilenced,
	readNotificationRules,
	rulesReferenceSenderRoles,
	triage,
	tzOffsetMinutes,
} from '../../../../../../server/lib/chi/notify/triageDecision';

const rule = (overrides: Partial<NotificationRule> & Pick<NotificationRule, 'action'>): NotificationRule => ({
	id: overrides.id ?? `r-${overrides.action}-${Math.random().toString(36).slice(2, 8)}`,
	...overrides,
});

const event = (overrides: Partial<NotificationEvent> = {}): NotificationEvent => ({
	roomId: 'room-1',
	roomName: 'litigation',
	roomType: 'c',
	senderUsername: 'jane',
	text: 'the Hernandez deposition moved to Thursday',
	isMention: false,
	isDM: false,
	at: new Date('2026-08-15T15:00:00.000Z'),
	tzOffsetMinutes: 0,
	...overrides,
});

describe('chi notification triage decision', () => {
	describe('the safety property: subtractive, and only on a real match', () => {
		it('has no opinion when the user has no rules', () => {
			expect(triage([], event())).to.deep.equal(TRIAGE_PASS);
		});

		it('has no opinion when the user has rules but none match', () => {
			const rules = [rule({ action: 'silence', channel: 'random' })];
			expect(triage(rules, event({ roomName: 'litigation' }))).to.deep.equal(TRIAGE_PASS);
		});

		it('does not downgrade ordinary channel traffic just because a rule exists elsewhere', () => {
			// The engine's own baseline for a non-mention is `digest`. That must NOT become a
			// delivery decision, or one narrow rule would quieten the whole workspace for a user.
			const rules = [rule({ action: 'silence', channel: 'random' })];
			const outcome = triage(rules, event({ roomName: 'general', isMention: false }));
			expect(outcome.action).to.equal('none');
			expect(outcome.suppressDesktop).to.equal(false);
			expect(outcome.suppressMobile).to.equal(false);
			expect(outcome.suppressEmail).to.equal(false);
		});

		it('never suppresses on an interrupt verdict', () => {
			const rules = [rule({ action: 'interrupt', keyword: 'Hernandez' })];
			const outcome = triage(rules, event());
			expect(outcome.action).to.equal('interrupt');
			expect(outcome.suppressDesktop).to.equal(false);
			expect(outcome.suppressMobile).to.equal(false);
			expect(outcome.suppressEmail).to.equal(false);
		});
	});

	describe('suppression', () => {
		it('holds back all three channels on a matching digest rule', () => {
			const rules = [rule({ action: 'digest', channel: 'litigation' })];
			const outcome = triage(rules, event());
			expect(outcome.action).to.equal('digest');
			expect(outcome.suppressDesktop).to.equal(true);
			expect(outcome.suppressMobile).to.equal(true);
			expect(outcome.suppressEmail).to.equal(true);
		});

		it('holds back all three channels on a matching silence rule', () => {
			const rules = [rule({ action: 'silence', channel: 'litigation' })];
			const outcome = triage(rules, event());
			expect(outcome.action).to.equal('silence');
			expect(outcome.suppressDesktop).to.equal(true);
		});

		it('carries the deciding rule and a reason', () => {
			const rules = [rule({ id: 'quiet-litigation', action: 'digest', channel: 'litigation' })];
			const outcome = triage(rules, event());
			expect(outcome.ruleId).to.equal('quiet-litigation');
			expect(outcome.reason).to.be.a('string').and.not.empty;
		});
	});

	describe('a broad rule is how a user opts into broad quieting', () => {
		it('an everything:true digest rule covers everything', () => {
			const rules = [rule({ action: 'digest', everything: true })];
			expect(triage(rules, event()).action).to.equal('digest');
		});

		it('but a rule with no conditions at all is still refused', () => {
			// An empty rule is what a half-built rule looks like; "everything" is something
			// you only ever mean on purpose.
			expect(triage([rule({ action: 'digest' })], event()).action).to.equal('none');
		});

		it('and a narrow interrupt rule still wins over it, in either authoring order', () => {
			const broad = rule({ id: 'broad', action: 'digest', everything: true });
			const narrow = rule({ id: 'narrow', action: 'interrupt', keyword: 'Hernandez' });
			expect(triage([broad, narrow], event()).action).to.equal('interrupt');
			expect(triage([narrow, broad], event()).action).to.equal('interrupt');
		});

		it('leaves mentions alone unless the broad rule opted them in', () => {
			// Mention protection: the broad rule matched, but is skipped for a direct mention,
			// so the message still interrupts. What matters is that nothing is suppressed.
			const broad = rule({ action: 'digest', everything: true });
			const mentioned = triage([broad], event({ isMention: true }));
			expect(mentioned.suppressDesktop).to.equal(false);
			expect(mentioned.suppressMobile).to.equal(false);
			expect(mentioned.suppressEmail).to.equal(false);

			const optedIn = rule({ action: 'digest', everything: true, includeMentions: true });
			expect(triage([optedIn], event({ isMention: true })).action).to.equal('digest');
		});

		it('honours a silence rule even on a mention — silencing is deliberate', () => {
			const rules = [rule({ action: 'silence', channel: 'litigation' })];
			expect(triage(rules, event({ isMention: true })).action).to.equal('silence');
		});
	});

	describe('isSilenced', () => {
		it('is true only for silence, not for digest', () => {
			expect(isSilenced([rule({ action: 'silence', channel: 'litigation' })], event())).to.equal(true);
			expect(isSilenced([rule({ action: 'digest', channel: 'litigation' })], event())).to.equal(false);
			expect(isSilenced([], event())).to.equal(false);
		});
	});

	describe('readNotificationRules', () => {
		it('reads rules off a user document', () => {
			const user = { settings: { chi: { notificationRules: [{ id: 'a', action: 'digest', channel: 'random' }] } } };
			expect(readNotificationRules(user)).to.have.lengthOf(1);
		});

		it('degrades to no rules rather than throwing', () => {
			expect(readNotificationRules(undefined)).to.deep.equal([]);
			expect(readNotificationRules(null)).to.deep.equal([]);
			expect(readNotificationRules({})).to.deep.equal([]);
			expect(readNotificationRules({ settings: {} })).to.deep.equal([]);
			expect(readNotificationRules({ settings: { chi: { notificationRules: 'nonsense' } } })).to.deep.equal([]);
		});

		it('drops individual unreadable rows and keeps the rest', () => {
			const user = {
				settings: { chi: { notificationRules: [{ id: 'a', action: 'digest', channel: 'random' }, { nope: true }, null] } },
			};
			expect(readNotificationRules(user)).to.have.lengthOf(1);
		});
	});

	describe('rulesReferenceSenderRoles', () => {
		it('is false for the common case, so no roles query is paid for', () => {
			expect(rulesReferenceSenderRoles([])).to.equal(false);
			expect(rulesReferenceSenderRoles([rule({ action: 'digest', channel: 'random' })])).to.equal(false);
			expect(rulesReferenceSenderRoles([rule({ action: 'digest', senderRole: '  ' })])).to.equal(false);
		});

		it('is true when any rule names a role', () => {
			expect(rulesReferenceSenderRoles([rule({ action: 'digest' }), rule({ action: 'interrupt', senderRole: 'partner' })])).to.equal(true);
		});
	});

	describe('tzOffsetMinutes', () => {
		it('converts hours to minutes', () => {
			expect(tzOffsetMinutes(-5)).to.equal(-300);
			expect(tzOffsetMinutes(0)).to.equal(0);
			expect(tzOffsetMinutes(1)).to.equal(60);
		});

		it('keeps the half- and quarter-hour zones intact', () => {
			expect(tzOffsetMinutes(5.5)).to.equal(330);
			expect(tzOffsetMinutes(5.75)).to.equal(345);
			expect(tzOffsetMinutes(-3.5)).to.equal(-210);
		});

		it('rejects nonsense rather than producing a wrong clock', () => {
			expect(tzOffsetMinutes(undefined)).to.equal(undefined);
			expect(tzOffsetMinutes('-5')).to.equal(undefined);
			expect(tzOffsetMinutes(NaN)).to.equal(undefined);
			expect(tzOffsetMinutes(99)).to.equal(undefined);
		});
	});

	describe('a worked example: "nothing after 7pm unless it is from a partner"', () => {
		const quietHours = rule({ id: 'quiet', action: 'digest', window: { from: '19:00', to: '08:00' } });
		const partners = rule({ id: 'partners', action: 'interrupt', senderRole: 'partner', window: { from: '19:00', to: '08:00' } });

		it('quietens an evening message from a colleague', () => {
			const at = new Date('2026-08-15T20:00:00.000Z');
			expect(triage([quietHours, partners], event({ at, senderRoles: ['user'] })).action).to.equal('digest');
		});

		it('lets a partner through at the same hour', () => {
			const at = new Date('2026-08-15T20:00:00.000Z');
			expect(triage([quietHours, partners], event({ at, senderRoles: ['user', 'partner'] })).action).to.equal('interrupt');
		});

		it('does nothing during the day', () => {
			const at = new Date('2026-08-15T14:00:00.000Z');
			expect(triage([quietHours, partners], event({ at, senderRoles: ['user'] })).action).to.equal('none');
		});

		it('reads the window on the user own clock, not the server', () => {
			// 20:00 UTC is 16:00 in New York — inside working hours, so nothing is quietened.
			const at = new Date('2026-08-15T20:00:00.000Z');
			expect(triage([quietHours, partners], event({ at, tzOffsetMinutes: -240, senderRoles: ['user'] })).action).to.equal('none');
			// 00:00 UTC is 20:00 the previous evening in New York — quiet hours.
			const late = new Date('2026-08-16T00:00:00.000Z');
			expect(triage([quietHours, partners], event({ at: late, tzOffsetMinutes: -240, senderRoles: ['user'] })).action).to.equal('digest');
		});
	});
});
