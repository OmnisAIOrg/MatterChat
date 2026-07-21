import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	BULK_CREATE_MAX,
	DEFAULT_SOUND_IDS,
	auditArgs,
	deriveUsername,
	isCancelText,
	isConfirmText,
	isSecretSetting,
	isSettingReadable,
	isSettingWritable,
	maskSecret,
	matchSound,
	normalizeSoundKey,
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

	describe('sound matching (per-user notification preference tools)', () => {
		const options = [
			...DEFAULT_SOUND_IDS.map((id) => ({ _id: id, name: id })),
			{ _id: 'custom-abc123', name: 'Notification' },
			{ _id: 'custom-def456', name: 'Team Chime 2' },
		];

		it('normalizes file names, case and separators onto one key', () => {
			expect(normalizeSoundKey('Notification.wav')).to.equal('notification');
			expect(normalizeSoundKey('  High-Bell.MP3 ')).to.equal('highbell');
			expect(normalizeSoundKey('Team Chime 2')).to.equal('teamchime2');
			expect(normalizeSoundKey('')).to.equal('');
		});
		it('matches stock sound ids case-insensitively', () => {
			expect(matchSound('Chime', options)?._id).to.equal('chime');
			expect(matchSound('HIGHBELL', options)?._id).to.equal('highbell');
		});
		it('matches custom sounds by display name, extension tolerated', () => {
			expect(matchSound('Notification.wav', options)?._id).to.equal('custom-abc123');
			expect(matchSound('team chime 2', options)?._id).to.equal('custom-def456');
		});
		it('prefers an id match over a name match and rejects unknowns', () => {
			expect(matchSound('chime', [...options, { _id: 'x', name: 'chime' }])?._id).to.equal('chime');
			expect(matchSound('does-not-exist', options)).to.equal(undefined);
			expect(matchSound('', options)).to.equal(undefined);
		});
	});
});
