import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	BULK_CREATE_MAX,
	auditArgs,
	deriveUsername,
	isCancelText,
	isConfirmText,
	isSecretSetting,
	isSettingReadable,
	isSettingWritable,
	maskSecret,
	parseBulkUsers,
} from '../../../../../../server/lib/chi/admin/helpers';

describe('chi admin helpers', () => {
	describe('deriveUsername', () => {
		it('lowercases and strips the tag and specials', () => {
			expect(deriveUsername("Jane.O'Brien+intake@firm.com")).to.equal('jane.obrien');
		});
		it('collapses runs of separators and trims edges', () => {
			expect(deriveUsername('__a..b--c__@x.com')).to.equal('a.b.c');
		});
		it('falls back for an all-junk local part', () => {
			expect(deriveUsername('!!!@x.com')).to.equal('user');
		});
	});

	describe('parseBulkUsers', () => {
		it('parses email / email,name / email,name,username lines incl. bullets and semicolons', () => {
			const { rows, errors } = parseBulkUsers(['a@x.com', '- b@x.com, Bee Person', 'c@x.com; Cee Person; ceec', '', '   '].join('\n'));
			expect(errors).to.be.empty;
			expect(rows).to.deep.equal([
				{ email: 'a@x.com', name: undefined, username: 'a' },
				{ email: 'b@x.com', name: 'Bee Person', username: 'b' },
				{ email: 'c@x.com', name: 'Cee Person', username: 'ceec' },
			]);
		});
		it('rejects non-emails and dedupes repeated emails', () => {
			const { rows, errors } = parseBulkUsers('nope\na@x.com\nA@X.com');
			expect(rows).to.have.length(1);
			expect(errors).to.have.length(2);
		});
		it('de-collides usernames against taken names with numeric suffixes', () => {
			const { rows } = parseBulkUsers('jane@a.com\njane@b.com', new Set(['jane2']));
			expect(rows[0].username).to.equal('jane');
			expect(rows[1].username).to.equal('jane3'); // jane taken by row 1, jane2 pre-taken
		});
		it('exports a sane bulk cap', () => {
			expect(BULK_CREATE_MAX).to.be.greaterThan(1);
		});
	});

	describe('confirm/cancel detection', () => {
		it('accepts confirm variants and rejects prose', () => {
			expect(isConfirmText(' Confirm.')).to.be.true;
			expect(isConfirmText('yes')).to.be.true;
			expect(isConfirmText('confirm the thing')).to.be.false;
		});
		it('accepts cancel variants', () => {
			expect(isCancelText('CANCEL')).to.be.true;
			expect(isCancelText('never mind')).to.be.false;
		});
	});

	describe('settings access + masking (widened 2026-07-20: any setting, secrets masked)', () => {
		it('reads allow any non-empty id', () => {
			expect(isSettingReadable('Slack_Enabled')).to.be.true;
			expect(isSettingReadable('LDAP_Password')).to.be.true;
			expect(isSettingReadable('  ')).to.be.false;
		});
		it('writes allow any non-empty id (double-gated + confirmed at the tool layer)', () => {
			expect(isSettingWritable('Slack_Enabled')).to.be.true;
			expect(isSettingWritable('Site_Url')).to.be.true;
			expect(isSettingWritable('')).to.be.false;
		});
		it('flags secret ids and masks values without leaking them', () => {
			expect(isSecretSetting('Slack_OAuth_Client_Secret')).to.be.true;
			const masked = maskSecret('sk-ant-api03-abcdefghijklmnop');
			expect(masked).to.not.include('abcdefghijk');
			expect(masked).to.include('chars');
			expect(maskSecret('')).to.equal('(empty)');
			expect(maskSecret('abc')).to.equal('••••');
		});
		it('auditArgs masks secret-looking keys and truncates', () => {
			const line = auditArgs({ client_secret: 'super-secret-value-123456', name: 'ok' });
			expect(line).to.not.include('super-secret-value');
			expect(line).to.include('"name":"ok"');
			expect(auditArgs({ blob: 'x'.repeat(1000) }).length).to.be.lessThan(450);
		});
	});
});
