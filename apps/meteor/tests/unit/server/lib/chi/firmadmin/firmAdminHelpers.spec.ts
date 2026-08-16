import { expect } from 'chai';
import { describe, it } from 'mocha';

import type { FirmActor, FirmMemberRow } from '../../../../../../server/lib/chi/firmadmin/firmAdminHelpers';
import {
	DEFAULT_INACTIVITY_DAYS,
	MAX_INACTIVITY_DAYS,
	authorizeFirmAction,
	channelLabel,
	checkFirmOwnerFloor,
	daysSince,
	formatChannelExport,
	formatFirmActivityReport,
	formatFirmMemberList,
	formatLastLogin,
	formatMembershipChange,
	formatRoleChange,
	matchesChannelQuery,
	outOfFirmMessage,
	parseExportFormat,
	parseFirmRole,
	parseSinceCutoff,
	previewList,
	summarizeChannelAddition,
	summarizeChannelExport,
} from '../../../../../../server/lib/chi/firmadmin/firmAdminHelpers';

const FIRM_A = 'firmA';
const FIRM_B = 'firmB';

const admin = (over: Partial<FirmActor> = {}): FirmActor => ({
	userId: 'u-admin',
	username: 'root',
	isWorkspaceAdmin: true,
	firmId: null,
	firmRole: null,
	...over,
});
const owner = (over: Partial<FirmActor> = {}): FirmActor => ({
	userId: 'u-owner',
	username: 'jane',
	isWorkspaceAdmin: false,
	firmId: FIRM_A,
	firmRole: 'owner',
	...over,
});
const member = (over: Partial<FirmActor> = {}): FirmActor => ({
	userId: 'u-member',
	username: 'bob',
	isWorkspaceAdmin: false,
	firmId: FIRM_A,
	firmRole: 'member',
	...over,
});
const stranger = (over: Partial<FirmActor> = {}): FirmActor => ({
	userId: 'u-nobody',
	username: 'drifter',
	isWorkspaceAdmin: false,
	firmId: null,
	firmRole: null,
	...over,
});

describe('chi firm-admin helpers', () => {
	describe('parseFirmRole', () => {
		it('accepts the two firm roles in any casing', () => {
			expect(parseFirmRole('owner')).to.equal('owner');
			expect(parseFirmRole(' Member ')).to.equal('member');
			expect(parseFirmRole('OWNER')).to.equal('owner');
		});
		it('rejects anything else', () => {
			expect(parseFirmRole('admin')).to.be.null;
			expect(parseFirmRole('')).to.be.null;
			expect(parseFirmRole(undefined)).to.be.null;
			expect(parseFirmRole(7)).to.be.null;
			expect(parseFirmRole({ role: 'owner' })).to.be.null;
		});
	});

	/* ── the property this whole feature exists for ─────────────────────────── */

	describe('authorizeFirmAction — workspace admin', () => {
		it('may read and administer their own-less workspace when they name a firm', () => {
			for (const action of ['read', 'administer'] as const) {
				const d = authorizeFirmAction({ actor: admin(), action, firmId: FIRM_B });
				expect(d.allowed, action).to.be.true;
				if (d.allowed) {
					expect(d.scope).to.equal('workspace-admin');
					expect(d.firmId).to.equal(FIRM_B);
				}
			}
		});
		it('may act in a firm that is not their own', () => {
			const d = authorizeFirmAction({ actor: admin({ firmId: FIRM_A, firmRole: 'member' }), action: 'administer', firmId: FIRM_B });
			expect(d.allowed).to.be.true;
		});
		it('may act on a target inside the firm they named', () => {
			const d = authorizeFirmAction({
				actor: admin(),
				action: 'administer',
				firmId: FIRM_B,
				target: { username: 'zoe', firmId: FIRM_B },
			});
			expect(d.allowed).to.be.true;
		});
		it('may NOT mix two firms in one call — the target must live in the scoped firm', () => {
			const d = authorizeFirmAction({
				actor: admin(),
				action: 'administer',
				firmId: FIRM_A,
				target: { username: 'zoe', firmId: FIRM_B },
			});
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.code).to.equal('out-of-firm');
			}
		});
		it('is asked which firm when they belong to none and name none', () => {
			const d = authorizeFirmAction({ actor: admin(), action: 'read' });
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.code).to.equal('no-firm-scope');
			}
		});
		it('falls back to their own firm when they belong to one and name none', () => {
			const d = authorizeFirmAction({ actor: admin({ firmId: FIRM_A }), action: 'administer' });
			expect(d.allowed).to.be.true;
			if (d.allowed) {
				expect(d.firmId).to.equal(FIRM_A);
			}
		});
	});

	describe('authorizeFirmAction — firm owner', () => {
		it('may read and administer inside their own firm', () => {
			for (const action of ['read', 'administer'] as const) {
				const d = authorizeFirmAction({ actor: owner(), action });
				expect(d.allowed, action).to.be.true;
				if (d.allowed) {
					expect(d.scope).to.equal('firm-owner');
					expect(d.firmId).to.equal(FIRM_A);
				}
			}
		});
		it('may act on a target inside their own firm', () => {
			const d = authorizeFirmAction({ actor: owner(), action: 'administer', target: { username: 'bob', firmId: FIRM_A } });
			expect(d.allowed).to.be.true;
		});
		it('naming their own firm explicitly is still allowed', () => {
			const d = authorizeFirmAction({ actor: owner(), action: 'administer', firmId: FIRM_A });
			expect(d.allowed).to.be.true;
		});

		it('is REFUSED when scoping the call to another firm', () => {
			for (const action of ['read', 'administer'] as const) {
				const d = authorizeFirmAction({ actor: owner(), action, firmId: FIRM_B });
				expect(d.allowed, action).to.be.false;
				if (!d.allowed) {
					expect(d.code).to.equal('out-of-firm');
				}
			}
		});
		it('is REFUSED for a target who belongs to another firm', () => {
			const d = authorizeFirmAction({ actor: owner(), action: 'administer', target: { username: 'zoe', firmId: FIRM_B } });
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.code).to.equal('out-of-firm');
			}
		});
		it('is REFUSED for a target with no firm at all', () => {
			for (const firmId of [null, undefined]) {
				const d = authorizeFirmAction({ actor: owner(), action: 'administer', target: { username: 'zoe', firmId } });
				expect(d.allowed, String(firmId)).to.be.false;
				if (!d.allowed) {
					expect(d.code).to.equal('out-of-firm');
				}
			}
		});
		it("is REFUSED even for a READ of another firm's member", () => {
			const d = authorizeFirmAction({ actor: owner(), action: 'read', target: { username: 'zoe', firmId: FIRM_B } });
			expect(d.allowed).to.be.false;
		});
		it('leaks nothing about the other firm: "another firm" and "no firm" are byte-identical refusals', () => {
			const other = authorizeFirmAction({ actor: owner(), action: 'administer', target: { username: 'zoe', firmId: FIRM_B } });
			const none = authorizeFirmAction({ actor: owner(), action: 'administer', target: { username: 'zoe', firmId: null } });
			expect(other.allowed).to.be.false;
			expect(none.allowed).to.be.false;
			if (!other.allowed && !none.allowed) {
				expect(other.code).to.equal(none.code);
				expect(other.reason).to.equal(none.reason);
				expect(other.reason).to.not.contain(FIRM_B);
			}
		});
		it('never echoes the scoped firm id back when refusing a cross-firm scope', () => {
			const d = authorizeFirmAction({ actor: owner(), action: 'read', firmId: FIRM_B });
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.reason).to.not.contain(FIRM_B);
			}
		});
	});

	describe('authorizeFirmAction — plain firm member', () => {
		it('may READ their own firm', () => {
			const d = authorizeFirmAction({ actor: member(), action: 'read' });
			expect(d.allowed).to.be.true;
			if (d.allowed) {
				expect(d.scope).to.equal('firm-member');
			}
		});
		it('may NOT administer, even inside their own firm', () => {
			const d = authorizeFirmAction({ actor: member(), action: 'administer', target: { username: 'bob', firmId: FIRM_A } });
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.code).to.equal('not-firm-owner');
			}
		});
		it('may NOT administer with no firm role at all', () => {
			const d = authorizeFirmAction({ actor: member({ firmRole: null }), action: 'administer' });
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.code).to.equal('not-firm-owner');
			}
		});
		it('is still refused cross-firm on a read', () => {
			const d = authorizeFirmAction({ actor: member(), action: 'read', firmId: FIRM_B });
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.code).to.equal('out-of-firm');
			}
		});
	});

	describe('authorizeFirmAction — actor with no firm', () => {
		it('is refused for read and administer alike', () => {
			for (const action of ['read', 'administer'] as const) {
				const d = authorizeFirmAction({ actor: stranger(), action });
				expect(d.allowed, action).to.be.false;
				if (!d.allowed) {
					expect(d.code).to.equal('actor-no-firm');
				}
			}
		});
		it('cannot reach a firm by naming it', () => {
			const d = authorizeFirmAction({ actor: stranger(), action: 'read', firmId: FIRM_A });
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.code).to.equal('actor-no-firm');
			}
		});
		it('cannot reach a firm by naming one of its members', () => {
			const d = authorizeFirmAction({ actor: stranger(), action: 'read', target: { username: 'jane', firmId: FIRM_A } });
			expect(d.allowed).to.be.false;
		});
		it('a claimed owner role with no firm buys nothing', () => {
			const d = authorizeFirmAction({ actor: stranger({ firmRole: 'owner' }), action: 'administer', firmId: FIRM_A });
			expect(d.allowed).to.be.false;
			if (!d.allowed) {
				expect(d.code).to.equal('actor-no-firm');
			}
		});
	});

	describe('authorizeFirmAction — exhaustive cross-firm reachability sweep', () => {
		it('no non-workspace-admin can reach firm B in ANY combination', () => {
			const actors = [owner(), member(), stranger(), owner({ firmRole: null }), stranger({ firmRole: 'owner' })];
			const scopes = [undefined, null, FIRM_A, FIRM_B];
			const targets = [undefined, { username: 'zoe', firmId: FIRM_B }, { username: 'zoe', firmId: null }];
			for (const actor of actors) {
				for (const firmId of scopes) {
					for (const target of targets) {
						for (const action of ['read', 'administer'] as const) {
							const d = authorizeFirmAction({ actor, action, firmId, target });
							if (d.allowed) {
								// The only grants allowed here are firm-A grants with no out-of-firm target.
								expect(d.firmId, JSON.stringify({ actor, firmId, target, action })).to.equal(FIRM_A);
								expect(target, JSON.stringify({ actor, firmId, target, action })).to.equal(undefined);
								expect(d.scope).to.be.oneOf(['firm-owner', 'firm-member']);
							}
						}
					}
				}
			}
		});
	});

	describe('outOfFirmMessage', () => {
		it('names the person but never a firm', () => {
			expect(outOfFirmMessage('zoe')).to.contain('@zoe');
			expect(outOfFirmMessage('@zoe')).to.contain('@zoe').and.to.not.contain('@@');
			expect(outOfFirmMessage()).to.contain('not part of your firm');
		});
	});

	/* ── the last-owner floor ───────────────────────────────────────────────── */

	describe('checkFirmOwnerFloor', () => {
		it('refuses to demote the only owner', () => {
			const r = checkFirmOwnerFloor({ activeOwnerIds: ['u1'], targetUserId: 'u1', targetUsername: 'jane', change: 'demote' });
			expect(r.ok).to.be.false;
			if (!r.ok) {
				expect(r.reason).to.contain('only owner').and.to.contain('@jane');
			}
		});
		it('refuses to deactivate the only owner (including yourself)', () => {
			const r = checkFirmOwnerFloor({ activeOwnerIds: ['u1'], targetUserId: 'u1', change: 'deactivate' });
			expect(r.ok).to.be.false;
			if (!r.ok) {
				expect(r.reason).to.contain('deactivate');
			}
		});
		it('allows demoting one of two owners', () => {
			expect(checkFirmOwnerFloor({ activeOwnerIds: ['u1', 'u2'], targetUserId: 'u1', change: 'demote' }).ok).to.be.true;
		});
		it('allows demoting a plain member (not in the owner set)', () => {
			expect(checkFirmOwnerFloor({ activeOwnerIds: ['u1'], targetUserId: 'u2', change: 'demote' }).ok).to.be.true;
		});
		it('is not fooled by a duplicated owner id', () => {
			const r = checkFirmOwnerFloor({ activeOwnerIds: ['u1', 'u1'], targetUserId: 'u1', change: 'demote' });
			expect(r.ok).to.be.false;
		});
		it('ignores empty ids in the owner set', () => {
			const r = checkFirmOwnerFloor({ activeOwnerIds: ['u1', ''], targetUserId: 'u1', change: 'demote' });
			expect(r.ok).to.be.false;
		});
		it('an ownerless firm cannot be made worse', () => {
			expect(checkFirmOwnerFloor({ activeOwnerIds: [], targetUserId: 'u1', change: 'deactivate' }).ok).to.be.true;
		});
	});

	/* ── cutoff parsing ─────────────────────────────────────────────────────── */

	describe('parseSinceCutoff', () => {
		// A Wednesday.
		const now = new Date('2026-08-12T15:30:00.000Z');
		const iso = (v: unknown): string => {
			const r = parseSinceCutoff(v, now);
			expect(r.ok, `expected ${JSON.stringify(v)} to parse`).to.be.true;
			return r.ok ? r.cutoff.toISOString() : '';
		};

		it('defaults to 30 days when nothing is given', () => {
			for (const empty of [undefined, null, '', '   ']) {
				const r = parseSinceCutoff(empty, now);
				expect(r.ok).to.be.true;
				if (r.ok) {
					expect(r.days).to.equal(DEFAULT_INACTIVITY_DAYS);
					expect(r.cutoff.toISOString()).to.equal('2026-07-13T15:30:00.000Z');
				}
			}
		});
		it('reads plain day counts, as number or string', () => {
			expect(iso(7)).to.equal('2026-08-05T15:30:00.000Z');
			expect(iso('7')).to.equal('2026-08-05T15:30:00.000Z');
			expect(iso('7 days')).to.equal('2026-08-05T15:30:00.000Z');
			expect(iso('7d')).to.equal('2026-08-05T15:30:00.000Z');
			expect(iso(' 7 Days ')).to.equal('2026-08-05T15:30:00.000Z');
		});
		it('reads the conversational wrappers around a span', () => {
			expect(iso('in the last 7 days'.replace('last ', ''))).to.equal('2026-08-05T15:30:00.000Z');
			expect(iso('within 7 days')).to.equal('2026-08-05T15:30:00.000Z');
			expect(iso('7 days ago')).to.equal('2026-08-05T15:30:00.000Z');
		});
		it('reads weeks and months', () => {
			expect(iso('2 weeks')).to.equal('2026-07-29T15:30:00.000Z');
			expect(iso('2w')).to.equal('2026-07-29T15:30:00.000Z');
			expect(iso('1 month')).to.equal('2026-07-13T15:30:00.000Z');
			expect(iso('3 months')).to.equal('2026-05-14T15:30:00.000Z');
		});
		it('reads the calendar phrases in UTC, independent of the server timezone', () => {
			expect(iso('today')).to.equal('2026-08-12T00:00:00.000Z');
			expect(iso('this week')).to.equal('2026-08-10T00:00:00.000Z'); // the Monday
			expect(iso('this month')).to.equal('2026-08-01T00:00:00.000Z');
			expect(iso('this year')).to.equal('2026-01-01T00:00:00.000Z');
		});
		it('starts the week on Monday even when "now" IS a Sunday or a Monday', () => {
			const sunday = new Date('2026-08-16T09:00:00.000Z');
			const r1 = parseSinceCutoff('this week', sunday);
			expect(r1.ok && r1.cutoff.toISOString()).to.equal('2026-08-10T00:00:00.000Z');
			const monday = new Date('2026-08-10T09:00:00.000Z');
			const r2 = parseSinceCutoff('this week', monday);
			expect(r2.ok && r2.cutoff.toISOString()).to.equal('2026-08-10T00:00:00.000Z');
		});
		it('is deterministic — the SAME input with the same now gives the same answer', () => {
			expect(iso('30 days')).to.equal(iso('30 days'));
		});
		it('honours the lower boundary: 1 day passes, 0 days does not', () => {
			const one = parseSinceCutoff('1 day', now);
			expect(one.ok).to.be.true;
			if (one.ok) {
				expect(one.days).to.equal(1);
				expect(one.label).to.equal('1 day');
			}
			const zero = parseSinceCutoff('0 days', now);
			expect(zero.ok).to.be.false;
			if (!zero.ok) {
				expect(zero.error).to.contain('at least 1 day');
			}
			expect(parseSinceCutoff(0, now).ok).to.be.false;
		});
		it('honours the upper boundary: 365 days passes, 366 does not', () => {
			expect(parseSinceCutoff(MAX_INACTIVITY_DAYS, now).ok).to.be.true;
			expect(parseSinceCutoff(`${MAX_INACTIVITY_DAYS} days`, now).ok).to.be.true;
			const over = parseSinceCutoff(MAX_INACTIVITY_DAYS + 1, now);
			expect(over.ok).to.be.false;
			if (!over.ok) {
				expect(over.error).to.contain(String(MAX_INACTIVITY_DAYS));
			}
			// 13 months = 390 days, over the cap once multiplied out.
			expect(parseSinceCutoff('13 months', now).ok).to.be.false;
		});
		it('rejects negatives, fractions and junk', () => {
			for (const bad of [-1, 1.5, 'last tuesday', 'soon', 'NaN', {}, [], true]) {
				expect(parseSinceCutoff(bad, now).ok, JSON.stringify(bad)).to.be.false;
			}
			expect(parseSinceCutoff(Number.NaN, now).ok).to.be.false;
			expect(parseSinceCutoff(Number.POSITIVE_INFINITY, now).ok).to.be.false;
		});
		it('never reads the real clock — a "now" in the past yields a cutoff in the past', () => {
			const longAgo = new Date('2001-01-01T00:00:00.000Z');
			const r = parseSinceCutoff('30 days', longAgo);
			expect(r.ok).to.be.true;
			if (r.ok) {
				expect(r.cutoff.toISOString()).to.equal('2000-12-02T00:00:00.000Z');
			}
		});
	});

	describe('daysSince / formatLastLogin', () => {
		const now = new Date('2026-08-12T12:00:00.000Z');
		it('counts whole days and clamps the future to 0', () => {
			expect(daysSince(new Date('2026-08-12T11:00:00.000Z'), now)).to.equal(0);
			expect(daysSince(new Date('2026-08-11T11:00:00.000Z'), now)).to.equal(1);
			expect(daysSince(new Date('2026-07-13T12:00:00.000Z'), now)).to.equal(30);
			expect(daysSince(new Date('2026-09-01T00:00:00.000Z'), now)).to.equal(0);
		});
		it('returns null for absent or unparseable dates', () => {
			expect(daysSince(null, now)).to.be.null;
			expect(daysSince(undefined, now)).to.be.null;
			expect(daysSince('not a date', now)).to.be.null;
		});
		it('renders the human phrasing', () => {
			expect(formatLastLogin(null, now)).to.equal('never logged in');
			expect(formatLastLogin(new Date('2026-08-12T01:00:00.000Z'), now)).to.equal('last login today');
			expect(formatLastLogin(new Date('2026-08-11T01:00:00.000Z'), now)).to.equal('last login yesterday');
			expect(formatLastLogin(new Date('2026-07-13T12:00:00.000Z'), now)).to.equal('last login 30 days ago');
		});
	});

	/* ── channel matching ───────────────────────────────────────────────────── */

	describe('matchesChannelQuery', () => {
		const room = { _id: 'r1', name: 'acme-litigation-smith', fname: 'Litigation — Smith', topic: 'Active case work' };
		it('matches on slug, display name and topic', () => {
			expect(matchesChannelQuery(room, 'litigation')).to.be.true;
			expect(matchesChannelQuery(room, 'smith')).to.be.true;
			expect(matchesChannelQuery(room, 'active case')).to.be.true;
		});
		it('strips the filler words a human sentence carries', () => {
			expect(matchesChannelQuery(room, 'every litigation channel')).to.be.true;
			expect(matchesChannelQuery(room, 'all the channels')).to.be.true; // no signal left ⇒ everything
		});
		it('requires EVERY meaningful word to appear', () => {
			expect(matchesChannelQuery(room, 'litigation jones')).to.be.false;
		});
		it('an empty query matches everything', () => {
			expect(matchesChannelQuery(room, '')).to.be.true;
			expect(matchesChannelQuery({}, '')).to.be.true;
		});
		it('is case- and punctuation-insensitive', () => {
			expect(matchesChannelQuery(room, 'LITIGATION, Smith!')).to.be.true;
		});
		it('does not match a room with nothing to match on', () => {
			expect(matchesChannelQuery({ _id: 'r2' }, 'litigation')).to.be.false;
		});
		it('labels channels by display name, falling back to the slug', () => {
			expect(channelLabel(room)).to.equal('#Litigation — Smith');
			expect(channelLabel({ name: 'intake' })).to.equal('#intake');
			expect(channelLabel({})).to.equal('#channel');
		});
	});

	/* ── formatters ─────────────────────────────────────────────────────────── */

	describe('previewList', () => {
		it('handles empty, short and long lists', () => {
			expect(previewList([])).to.equal('none');
			expect(previewList(['a', 'b'])).to.equal('a, b');
			expect(previewList(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).to.equal('a, b, c, d, e +2 more');
		});
	});

	describe('formatFirmMemberList', () => {
		const now = new Date('2026-08-12T12:00:00.000Z');
		const rows: FirmMemberRow[] = [
			{
				username: 'jane',
				name: 'Jane Doe',
				email: 'jane@acme.test',
				role: 'owner',
				active: true,
				lastLogin: new Date('2026-08-12T08:00:00.000Z'),
			},
			{ username: 'bob', name: 'Bob Roe', role: 'member', active: true, lastLogin: new Date('2026-07-01T08:00:00.000Z') },
			{ username: 'sue', role: null, active: false, lastLogin: null },
		];
		it('renders one line per member with role, email and last login', () => {
			const out = formatFirmMemberList('Acme Law', rows, now);
			expect(out).to.contain('**Acme Law** — 3 members (1 owner)');
			expect(out).to.contain('- **@jane** — Jane Doe — owner — jane@acme.test — last login today');
			expect(out).to.contain('- **@bob** — Bob Roe — member — no email — last login 42 days ago');
			expect(out).to.contain('- **@sue** — (no name) — no firm role — no email — never logged in — **DEACTIVATED**');
			expect(out.split('\n')).to.have.lengthOf(4);
		});
		it('pluralizes a single member correctly', () => {
			expect(formatFirmMemberList('Acme Law', [rows[0]], now)).to.contain('1 member (1 owner)');
		});
		it('handles EMPTY input without inventing a roster', () => {
			expect(formatFirmMemberList('Acme Law', [], now)).to.equal('**Acme Law** has no members on the roster yet.');
		});
	});

	describe('formatFirmActivityReport', () => {
		const now = new Date('2026-08-12T12:00:00.000Z');
		it('lists the quiet members', () => {
			const out = formatFirmActivityReport(
				'Acme Law',
				[
					{ username: 'sue', role: 'member', lastLogin: null },
					{ username: 'bob', name: 'Bob Roe', role: 'member', lastLogin: new Date('2026-07-01T08:00:00.000Z') },
				],
				{ label: '30 days', checked: 5 },
				now,
			);
			expect(out).to.contain('2 of 5 members have not logged in within 30 days');
			expect(out).to.contain('- **@sue** — (no name) — member — never logged in');
			expect(out).to.contain('- **@bob** — Bob Roe — member — last login 42 days ago');
		});
		it('says so plainly when nobody is stale (EMPTY rows, non-empty firm)', () => {
			const out = formatFirmActivityReport('Acme Law', [], { label: 'this month', checked: 4 }, now);
			expect(out).to.equal('Everyone in **Acme Law** has logged in within this month — all 4 members accounted for.');
		});
		it('handles an EMPTY firm', () => {
			const out = formatFirmActivityReport('Acme Law', [], { label: '30 days', checked: 0 }, now);
			expect(out).to.contain('no members on the roster yet');
		});
	});

	describe('formatMembershipChange', () => {
		it('summarizes adds, no-ops and failures', () => {
			const out = formatMembershipChange({
				username: 'bob',
				added: ['#a', '#b'],
				alreadyIn: ['#c'],
				failed: [{ channel: '#d', error: 'boom' }],
			});
			expect(out).to.contain('**@bob**: added to 2 channels — #a, #b.');
			expect(out).to.contain('Already a member of 1: #c.');
			expect(out).to.contain('Failed on 1:\n- #d: boom');
		});
		it('pluralizes a single add', () => {
			expect(formatMembershipChange({ username: 'bob', added: ['#a'], alreadyIn: [], failed: [] })).to.contain('added to 1 channel — #a.');
		});
		it('handles EMPTY input — nothing matched, so nothing is claimed', () => {
			const out = formatMembershipChange({ username: 'bob', added: [], alreadyIn: [], failed: [] });
			expect(out).to.equal('Nothing to do — no channels in your firm matched, so **@bob** was not added anywhere.');
		});
	});

	describe('summarizeChannelAddition', () => {
		it('names the user and the exact count when the channels are listed', () => {
			expect(summarizeChannelAddition('bob', '', ['#a', '#b'])).to.equal('Add @bob to 2 channels in your firm: #a, #b');
			expect(summarizeChannelAddition('@bob', '', ['#a'])).to.equal('Add @bob to 1 channel in your firm: #a');
		});
		it('names the filter when the count cannot be known synchronously', () => {
			expect(summarizeChannelAddition('bob', 'litigation', null)).to.contain('matching "litigation"');
			expect(summarizeChannelAddition('bob', '', null)).to.contain('EVERY channel in the firm');
		});
		it('handles an EMPTY explicit list', () => {
			expect(summarizeChannelAddition('bob', '', [])).to.equal('Add @bob to 0 channels in your firm: none');
		});
	});

	describe('formatRoleChange', () => {
		it('renders a promotion and a demotion', () => {
			expect(formatRoleChange('Acme Law', 'bob', 'member', 'owner')).to.contain('promoted to OWNER of **Acme Law**');
			expect(formatRoleChange('Acme Law', '@jane', 'owner', 'member')).to.contain('set back to MEMBER of **Acme Law**');
		});
		it('is a no-op line when the role is unchanged', () => {
			expect(formatRoleChange('Acme Law', 'bob', 'owner', 'owner')).to.contain('already an owner');
			expect(formatRoleChange('Acme Law', 'bob', 'member', 'member')).to.contain('already a member');
		});
		it('reports an unset previous role honestly', () => {
			expect(formatRoleChange('Acme Law', 'bob', null, 'owner')).to.contain('(was unset)');
		});
	});
});

describe('channel export (F7)', () => {
	describe('parseExportFormat', () => {
		it('defaults to html — the person asking wants to read it', () => {
			expect(parseExportFormat(undefined)).to.equal('html');
			expect(parseExportFormat('')).to.equal('html');
			expect(parseExportFormat('html')).to.equal('html');
			expect(parseExportFormat('HTML')).to.equal('html');
		});

		it('accepts the words people use for a machine-readable copy', () => {
			expect(parseExportFormat('json')).to.equal('json');
			expect(parseExportFormat(' JSON ')).to.equal('json');
			expect(parseExportFormat('data')).to.equal('json');
			expect(parseExportFormat('raw')).to.equal('json');
		});

		it('falls back rather than erroring on a word it does not know', () => {
			expect(parseExportFormat('pdf')).to.equal('html');
			expect(parseExportFormat(42)).to.equal('html');
			expect(parseExportFormat(null)).to.equal('html');
		});
	});

	describe('formatChannelExport', () => {
		const base = { channel: '#hernandez', firmName: 'Smith Law', url: 'https://mc.example/data-export/abc', format: 'html' as const };

		it('leads with the link', () => {
			const text = formatChannelExport({ ...base, messages: 412 });
			expect(text).to.include('[download the archive](https://mc.example/data-export/abc)');
			expect(text).to.include('#hernandez');
			expect(text).to.include('Smith Law');
			expect(text).to.include('412 messages');
		});

		it('says the link is login-gated, because that is what makes it safe to share', () => {
			expect(formatChannelExport({ ...base, messages: 1 })).to.include('needs a MatterChat login');
		});

		it('gets the singular right', () => {
			expect(formatChannelExport({ ...base, messages: 1 })).to.include('1 message,');
		});

		it('names the range only when there is one', () => {
			expect(formatChannelExport({ ...base, messages: 5 })).to.not.include('from the last');
			expect(formatChannelExport({ ...base, messages: 5, rangeLabel: '30 days' })).to.include('from the last 30 days');
		});

		it('names the format', () => {
			expect(formatChannelExport({ ...base, messages: 5 })).to.include('as HTML');
			expect(formatChannelExport({ ...base, messages: 5, format: 'json' })).to.include('as JSON');
		});
	});

	describe('summarizeChannelExport', () => {
		it('states the whole history when no range is given, so confirming is informed', () => {
			expect(summarizeChannelExport('#intake')).to.include('whole history');
			expect(summarizeChannelExport('#intake')).to.include('#intake');
		});

		it('states the range when there is one', () => {
			expect(summarizeChannelExport('#intake', '30 days')).to.include('covering the last 30 days');
		});

		it('warns that files come too', () => {
			expect(summarizeChannelExport('#intake')).to.include('including files shared in it');
		});
	});
});
