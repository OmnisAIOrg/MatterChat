import { expect } from 'chai';

import {
	clampFirmInviteLimits,
	isFirmScopeExemptUser,
	normalizeFirmName,
	partitionEmails,
	resolveFirmInviteLimits,
	slugifyFirmName,
	userMatchesFirmScope,
	FIRM_INVITE_ALLOWED_DAYS,
	FIRM_INVITE_ALLOWED_USES,
	FIRM_INVITE_DEFAULT_DAYS,
	FIRM_INVITE_DEFAULT_MAX_USES,
	FIRM_NAME_MAX,
} from '../../../../../server/lib/firms/firmsHelpers';

const isValidEmail = (email: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

describe('firms helpers', () => {
	describe('normalizeFirmName', () => {
		it('accepts a plain name and collapses whitespace', () => {
			expect(normalizeFirmName('  Smith   &  Associates ')).to.equal('Smith & Associates');
		});
		it('rejects non-strings and too-short names', () => {
			expect(normalizeFirmName(undefined)).to.be.null;
			expect(normalizeFirmName(42)).to.be.null;
			expect(normalizeFirmName('A')).to.be.null;
			expect(normalizeFirmName('   ')).to.be.null;
		});
		it('rejects names beyond the max length', () => {
			expect(normalizeFirmName('x'.repeat(FIRM_NAME_MAX + 1))).to.be.null;
		});
		it('strips control characters', () => {
			expect(normalizeFirmName('Smith\u0000 Law\u001f')).to.equal('Smith Law');
		});
	});

	describe('slugifyFirmName', () => {
		it('slugifies to lowercase dashes', () => {
			expect(slugifyFirmName('Smith & Associates LLP')).to.equal('smith-associates-llp');
		});
		it('falls back for fully non-alphanumeric names', () => {
			expect(slugifyFirmName('法律事務所')).to.equal('firm');
		});
	});

	describe('partitionEmails', () => {
		it('splits valid and invalid, dedupes, lowercases', () => {
			const { valid, invalid } = partitionEmails(['Jane@Firm.com', 'jane@firm.com', 'nope', '', 'bob@firm.com'], isValidEmail);
			expect(valid).to.deep.equal(['jane@firm.com', 'bob@firm.com']);
			expect(invalid).to.deep.equal(['nope']);
		});
		it('handles a non-array input', () => {
			expect(partitionEmails('jane@firm.com', isValidEmail)).to.deep.equal({ valid: [], invalid: [] });
		});
		it('ignores non-string entries', () => {
			const { valid, invalid } = partitionEmails([42, null, 'a@b.co'], isValidEmail);
			expect(valid).to.deep.equal(['a@b.co']);
			expect(invalid).to.deep.equal([]);
		});
	});

	describe('resolveFirmInviteLimits', () => {
		it('never lists 0 (unlimited / never-expires) as an allowed value', () => {
			expect(FIRM_INVITE_ALLOWED_DAYS).to.not.include(0);
			expect(FIRM_INVITE_ALLOWED_USES).to.not.include(0);
		});
		it('passes exact allowed values through unchanged', () => {
			for (const days of FIRM_INVITE_ALLOWED_DAYS) {
				expect(resolveFirmInviteLimits(days, 25).days).to.equal(days);
			}
			for (const maxUses of FIRM_INVITE_ALLOWED_USES) {
				expect(resolveFirmInviteLimits(7, maxUses).maxUses).to.equal(maxUses);
			}
		});
		it('falls back to the defaults on garbage input', () => {
			const expected = { days: FIRM_INVITE_DEFAULT_DAYS, maxUses: FIRM_INVITE_DEFAULT_MAX_USES };
			expect(resolveFirmInviteLimits(undefined, undefined)).to.deep.equal(expected);
			expect(resolveFirmInviteLimits(null, null)).to.deep.equal(expected);
			expect(resolveFirmInviteLimits('abc', {})).to.deep.equal(expected);
			expect(resolveFirmInviteLimits(NaN, Infinity)).to.deep.equal(expected);
			expect(resolveFirmInviteLimits('', '  ')).to.deep.equal(expected);
			expect(resolveFirmInviteLimits(true, [])).to.deep.equal(expected);
		});
		it('snaps 0 and negatives UP to the smallest allowed value — unlimited can never come back', () => {
			expect(resolveFirmInviteLimits(0, 0)).to.deep.equal({ days: 1, maxUses: 1 });
			expect(resolveFirmInviteLimits(-5, -1)).to.deep.equal({ days: 1, maxUses: 1 });
		});
		it('snaps arbitrary values to the nearest allowed value', () => {
			expect(resolveFirmInviteLimits(3, 2).days).to.equal(1);
			expect(resolveFirmInviteLimits(5, 25).days).to.equal(7);
			expect(resolveFirmInviteLimits(20, 25).days).to.equal(15);
			expect(resolveFirmInviteLimits(7, 8).maxUses).to.equal(10);
			expect(resolveFirmInviteLimits(7, 30).maxUses).to.equal(25);
			expect(resolveFirmInviteLimits(7, 60).maxUses).to.equal(50);
		});
		it('caps huge values at the largest allowed value', () => {
			expect(resolveFirmInviteLimits(1000, 1e9)).to.deep.equal({ days: 30, maxUses: 100 });
		});
		it('breaks ties toward the stricter (smaller) value', () => {
			expect(resolveFirmInviteLimits(4, 3)).to.deep.equal({ days: 1, maxUses: 1 });
			expect(resolveFirmInviteLimits(7, 75).maxUses).to.equal(50);
		});
		it('accepts numeric strings (raw settings values)', () => {
			expect(resolveFirmInviteLimits('30', '100')).to.deep.equal({ days: 30, maxUses: 100 });
			expect(resolveFirmInviteLimits(' 15 ', ' 50 ')).to.deep.equal({ days: 15, maxUses: 50 });
		});
	});

	describe('userMatchesFirmScope', () => {
		it('passes everyone when there is no scope', () => {
			expect(userMatchesFirmScope({ customFields: { firmId: 'x' } }, null)).to.be.true;
			expect(userMatchesFirmScope(null, null)).to.be.true;
		});
		it('matches same-firm users only for a firm scope', () => {
			const scope = { 'customFields.firmId': 'team1' } as never;
			expect(userMatchesFirmScope({ customFields: { firmId: 'team1' } }, scope)).to.be.true;
			expect(userMatchesFirmScope({ customFields: { firmId: 'team2' } }, scope)).to.be.false;
			expect(userMatchesFirmScope({ customFields: {} }, scope)).to.be.false;
			expect(userMatchesFirmScope(null, scope)).to.be.false;
		});
		it('matches only unstamped users for the no-firm cohort scope', () => {
			const scope = { 'customFields.firmId': { $exists: false } } as never;
			expect(userMatchesFirmScope({ customFields: {} }, scope)).to.be.true;
			expect(userMatchesFirmScope({}, scope)).to.be.true;
			expect(userMatchesFirmScope({ customFields: { firmId: 'team1' } }, scope)).to.be.false;
		});
		it('exempts bot/app accounts so firm members can still DM rocket.cat and the assistants', () => {
			const scope = { 'customFields.firmId': 'team1' } as never;
			expect(userMatchesFirmScope({ type: 'bot' }, scope)).to.be.true;
			expect(userMatchesFirmScope({ type: 'app' }, scope)).to.be.true;
			expect(userMatchesFirmScope({ roles: ['bot'] }, scope)).to.be.true;
			expect(userMatchesFirmScope({ roles: ['app', 'user'] }, scope)).to.be.true;
			// a plain user with no firmId is still outside the cohort
			expect(userMatchesFirmScope({ type: 'user', roles: ['user'] }, scope)).to.be.false;
		});
	});

	describe('isFirmScopeExemptUser', () => {
		it('spots bot/app accounts by type or role', () => {
			expect(isFirmScopeExemptUser({ type: 'bot' })).to.be.true;
			expect(isFirmScopeExemptUser({ type: 'app' })).to.be.true;
			expect(isFirmScopeExemptUser({ roles: ['bot'] })).to.be.true;
			expect(isFirmScopeExemptUser({ roles: ['app'] })).to.be.true;
		});
		it('does not exempt regular users', () => {
			expect(isFirmScopeExemptUser({ type: 'user', roles: ['user', 'admin'] })).to.be.false;
			expect(isFirmScopeExemptUser({})).to.be.false;
			expect(isFirmScopeExemptUser(null)).to.be.false;
		});
	});

	describe('clampFirmInviteLimits', () => {
		const caps = { days: 7, maxUses: 25 };
		it('turns the stock "unlimited / never expires" 0 into the cap', () => {
			expect(clampFirmInviteLimits(0, 0, caps)).to.deep.equal({ days: 7, maxUses: 25 });
		});
		it('caps anything looser than the configured limit', () => {
			expect(clampFirmInviteLimits(30, 100, caps)).to.deep.equal({ days: 7, maxUses: 25 });
		});
		it('lets a caller ask for something stricter', () => {
			expect(clampFirmInviteLimits(1, 5, caps)).to.deep.equal({ days: 1, maxUses: 5 });
		});
		it('falls back to the cap for garbage and negatives', () => {
			expect(clampFirmInviteLimits(-1, 'nope', caps)).to.deep.equal({ days: 7, maxUses: 25 });
			expect(clampFirmInviteLimits(undefined, null, caps)).to.deep.equal({ days: 7, maxUses: 25 });
		});
	});
});
