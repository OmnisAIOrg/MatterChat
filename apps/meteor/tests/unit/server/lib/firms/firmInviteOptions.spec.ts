import { expect } from 'chai';

import {
	FIRM_INVITE_DEFAULT_DAYS,
	FIRM_INVITE_DEFAULT_MAX_USES,
	INVITE_POSSIBLE_DAYS,
	INVITE_POSSIBLE_USES,
	ROCKETCHAT_DEEPLINK_HOST,
	resolveFirmInviteUrl,
	validateInviteOptions,
} from '../../../../../server/lib/firms/firmsHelpers';

describe('firm invite options', () => {
	describe('the whitelists mirror findOrCreateInvite', () => {
		// If either of these drifts, firms would accept a value the invite layer
		// then throws on — the exact failure this validation exists to prevent.
		it('matches possibleDays', () => {
			expect([...INVITE_POSSIBLE_DAYS]).to.deep.equal([0, 1, 7, 15, 30]);
		});
		it('matches possibleUses', () => {
			expect([...INVITE_POSSIBLE_USES]).to.deep.equal([0, 1, 5, 10, 25, 50, 100]);
		});
		it('defaults are themselves legal values', () => {
			expect(INVITE_POSSIBLE_DAYS).to.include(FIRM_INVITE_DEFAULT_DAYS);
			expect(INVITE_POSSIBLE_USES).to.include(FIRM_INVITE_DEFAULT_MAX_USES);
		});
	});

	describe('validateInviteOptions', () => {
		it('defaults both when nothing is given', () => {
			expect(validateInviteOptions(undefined, undefined)).to.deep.equal({
				ok: true,
				days: FIRM_INVITE_DEFAULT_DAYS,
				maxUses: FIRM_INVITE_DEFAULT_MAX_USES,
			});
			expect(validateInviteOptions(null, null)).to.deep.equal({ ok: true, days: 15, maxUses: 0 });
		});

		it('accepts every whitelisted day value', () => {
			for (const days of INVITE_POSSIBLE_DAYS) {
				expect(validateInviteOptions(days, undefined), String(days)).to.deep.equal({ ok: true, days, maxUses: 0 });
			}
		});

		it('accepts every whitelisted use count', () => {
			for (const maxUses of INVITE_POSSIBLE_USES) {
				expect(validateInviteOptions(undefined, maxUses), String(maxUses)).to.deep.equal({ ok: true, days: 15, maxUses });
			}
		});

		it('accepts numeric strings, which is what REST bodies and form fields carry', () => {
			expect(validateInviteOptions('7', '25')).to.deep.equal({ ok: true, days: 7, maxUses: 25 });
			expect(validateInviteOptions(' 30 ', ' 1 ')).to.deep.equal({ ok: true, days: 30, maxUses: 1 });
			expect(validateInviteOptions('0', '0')).to.deep.equal({ ok: true, days: 0, maxUses: 0 });
		});

		it('rejects out-of-whitelist numbers rather than substituting a near one', () => {
			for (const days of [2, 3, 14, 16, 29, 31, 365, -1, -15]) {
				const result = validateInviteOptions(days, undefined);
				expect(result.ok, `days=${days}`).to.be.false;
				expect(result).to.include({ ok: false, field: 'days' });
			}
			for (const maxUses of [2, 3, 4, 6, 99, 101, 1000, -1]) {
				const result = validateInviteOptions(undefined, maxUses);
				expect(result.ok, `maxUses=${maxUses}`).to.be.false;
				expect(result).to.include({ ok: false, field: 'maxUses' });
			}
		});

		it('reports which field was wrong, and reports days first', () => {
			const bothWrong = validateInviteOptions(3, 3);
			expect(bothWrong).to.deep.equal({ ok: false, field: 'days', allowed: INVITE_POSSIBLE_DAYS });

			const usesWrong = validateInviteOptions(7, 3);
			expect(usesWrong).to.deep.equal({ ok: false, field: 'maxUses', allowed: INVITE_POSSIBLE_USES });
		});

		it('rejects non-integer numbers', () => {
			expect(validateInviteOptions(7.5, undefined)).to.include({ ok: false, field: 'days' });
			expect(validateInviteOptions(15.0000001, undefined)).to.include({ ok: false, field: 'days' });
			expect(validateInviteOptions(NaN, undefined)).to.include({ ok: false, field: 'days' });
			expect(validateInviteOptions(Infinity, undefined)).to.include({ ok: false, field: 'days' });
			expect(validateInviteOptions(undefined, 1.5)).to.include({ ok: false, field: 'maxUses' });
		});

		// Number(true) === 1 and Number([]) === 0, both of which are whitelisted.
		// Coercing these would turn a client bug into a live invite link nobody
		// chose the terms of.
		it('rejects booleans, arrays, objects and empty strings that would coerce into the whitelist', () => {
			for (const bad of [true, false, [], [1], {}, '', '   ', ' \n ']) {
				expect(validateInviteOptions(bad, undefined), JSON.stringify(bad)).to.include({ ok: false, field: 'days' });
				expect(validateInviteOptions(undefined, bad), JSON.stringify(bad)).to.include({ ok: false, field: 'maxUses' });
			}
		});

		it('rejects strings that are not plain digits', () => {
			for (const bad of ['15 days', '1e1', '0x0', '+15', '-1', '15.0', 'fifteen']) {
				expect(validateInviteOptions(bad, undefined), bad).to.include({ ok: false, field: 'days' });
			}
		});

		it('exposes the allowed values on rejection so the caller can say what is legal', () => {
			const result = validateInviteOptions(3, undefined);
			expect(result.ok).to.be.false;
			if (!result.ok) {
				expect(result.allowed).to.deep.equal(INVITE_POSSIBLE_DAYS);
			}
		});
	});

	describe('resolveFirmInviteUrl', () => {
		const site = 'https://chat.smithlaw.com';

		it('prefers the canonical URL when it points at the workspace', () => {
			expect(resolveFirmInviteUrl('https://chat.smithlaw.com/invite/abc123', site, 'abc123')).to.equal(
				'https://chat.smithlaw.com/invite/abc123',
			);
		});

		it('prefers a canonical URL on an operator-configured deep-link host', () => {
			expect(resolveFirmInviteUrl('https://go.smithlaw.com/invite?host=chat.smithlaw.com&path=invite/abc123', site, 'abc123')).to.equal(
				'https://go.smithlaw.com/invite?host=chat.smithlaw.com&path=invite/abc123',
			);
		});

		it('falls back to a direct link rather than emailing law-firm clients through go.rocket.chat', () => {
			expect(
				resolveFirmInviteUrl(`https://${ROCKETCHAT_DEEPLINK_HOST}/invite?host=chat.smithlaw.com&path=invite/abc123`, site, 'abc123'),
			).to.equal('https://chat.smithlaw.com/invite/abc123');
			expect(resolveFirmInviteUrl('https://GO.ROCKET.CHAT/invite?path=invite/abc123', site, 'abc123')).to.equal(
				'https://chat.smithlaw.com/invite/abc123',
			);
			expect(resolveFirmInviteUrl('https://eu.go.rocket.chat/invite?path=invite/abc123', site, 'abc123')).to.equal(
				'https://chat.smithlaw.com/invite/abc123',
			);
		});

		it('falls back when the canonical URL is missing, blank or unparseable', () => {
			expect(resolveFirmInviteUrl(undefined, site, 'abc123')).to.equal('https://chat.smithlaw.com/invite/abc123');
			expect(resolveFirmInviteUrl('', site, 'abc123')).to.equal('https://chat.smithlaw.com/invite/abc123');
			expect(resolveFirmInviteUrl('   ', site, 'abc123')).to.equal('https://chat.smithlaw.com/invite/abc123');
			// Relative — what getURL returns with neither `full` nor `cloud`.
			expect(resolveFirmInviteUrl('/invite/abc123', site, 'abc123')).to.equal('https://chat.smithlaw.com/invite/abc123');
			expect(resolveFirmInviteUrl(42, site, 'abc123')).to.equal('https://chat.smithlaw.com/invite/abc123');
		});

		it('trims trailing slashes off the site URL, and copes with it being unset', () => {
			expect(resolveFirmInviteUrl(undefined, 'https://chat.smithlaw.com///', 'abc')).to.equal('https://chat.smithlaw.com/invite/abc');
			expect(resolveFirmInviteUrl(undefined, undefined, 'abc')).to.equal('/invite/abc');
			expect(resolveFirmInviteUrl(undefined, '', 'abc')).to.equal('/invite/abc');
		});

		it('does not fall back for a look-alike host', () => {
			expect(resolveFirmInviteUrl('https://notgo.rocket.chat.example/invite/abc', site, 'abc')).to.equal(
				'https://notgo.rocket.chat.example/invite/abc',
			);
		});
	});
});
