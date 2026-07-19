import { expect } from 'chai';

import {
	normalizeFirmName,
	partitionEmails,
	slugifyFirmName,
	userMatchesFirmScope,
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
