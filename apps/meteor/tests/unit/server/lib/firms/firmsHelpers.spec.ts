import { expect } from 'chai';

import {
	normalizeFirmName,
	partitionEmails,
	resolveInviteLimits,
	slugifyFirmName,
	userMatchesFirmScope,
	FIRM_INVITE_ALLOWED_DAYS,
	FIRM_INVITE_ALLOWED_MAX_USES,
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

	describe('resolveInviteLimits', () => {
		it('parses the string keys select settings store', () => {
			expect(resolveInviteLimits('7', '50')).to.deep.equal({ days: 7, maxUses: 50 });
			expect(resolveInviteLimits('1', '5')).to.deep.equal({ days: 1, maxUses: 5 });
		});
		it('accepts plain numbers', () => {
			expect(resolveInviteLimits(30, 100)).to.deep.equal({ days: 30, maxUses: 100 });
		});
		it('falls back to the hardened defaults for undefined/null', () => {
			expect(resolveInviteLimits(undefined, undefined)).to.deep.equal({
				days: FIRM_INVITE_DEFAULT_DAYS,
				maxUses: FIRM_INVITE_DEFAULT_MAX_USES,
			});
			expect(resolveInviteLimits(null, null)).to.deep.equal({ days: 3, maxUses: 25 });
		});
		it('falls back for out-of-list values (OVERWRITE_SETTING_* junk)', () => {
			expect(resolveInviteLimits('5', '7')).to.deep.equal({ days: 3, maxUses: 25 });
			expect(resolveInviteLimits('9999', '-1')).to.deep.equal({ days: 3, maxUses: 25 });
			expect(resolveInviteLimits('abc', '2.5')).to.deep.equal({ days: 3, maxUses: 25 });
			expect(resolveInviteLimits('', '')).to.deep.equal({ days: 3, maxUses: 25 });
			expect(resolveInviteLimits(true, {})).to.deep.equal({ days: 3, maxUses: 25 });
		});
		it('never resolves to unlimited — 0 is out-of-list for both limits', () => {
			expect(resolveInviteLimits('0', '0')).to.deep.equal({ days: 3, maxUses: 25 });
			expect(resolveInviteLimits(0, 0)).to.deep.equal({ days: 3, maxUses: 25 });
		});
		it('tolerates padded string keys', () => {
			expect(resolveInviteLimits(' 15 ', ' 10 ')).to.deep.equal({ days: 15, maxUses: 10 });
		});
		it('keeps the allowed lists finite and 0-free (guards the settings contract)', () => {
			expect(FIRM_INVITE_ALLOWED_DAYS).to.not.include(0);
			expect(FIRM_INVITE_ALLOWED_MAX_USES).to.not.include(0);
			expect(FIRM_INVITE_ALLOWED_DAYS).to.include(FIRM_INVITE_DEFAULT_DAYS);
			expect(FIRM_INVITE_ALLOWED_MAX_USES).to.include(FIRM_INVITE_DEFAULT_MAX_USES);
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
	});
});
