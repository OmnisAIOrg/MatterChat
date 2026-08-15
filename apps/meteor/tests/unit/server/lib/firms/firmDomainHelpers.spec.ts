import { expect } from 'chai';

import {
	PUBLIC_EMAIL_PROVIDERS,
	checkClaimableDomain,
	extractEmailDomain,
	isPublicEmailProvider,
	normalizeDomain,
	pickAdoptableEmail,
} from '../../../../../server/lib/firms/firmDomainHelpers';

describe('firm domain helpers', () => {
	describe('normalizeDomain', () => {
		it('passes a plain domain through unchanged', () => {
			expect(normalizeDomain('smithlaw.com')).to.equal('smithlaw.com');
			expect(normalizeDomain('sub.smithlaw.co.uk')).to.equal('sub.smithlaw.co.uk');
		});

		it('lowercases and trims', () => {
			expect(normalizeDomain('  SmithLaw.COM  ')).to.equal('smithlaw.com');
			expect(normalizeDomain('\tSMITHLAW.COM\n')).to.equal('smithlaw.com');
		});

		it('strips a leading @', () => {
			expect(normalizeDomain('@smithlaw.com')).to.equal('smithlaw.com');
			expect(normalizeDomain(' @SmithLaw.com ')).to.equal('smithlaw.com');
		});

		it('accepts a full email address where a domain was expected', () => {
			expect(normalizeDomain('jane@smithlaw.com')).to.equal('smithlaw.com');
			expect(normalizeDomain('Jane.Doe+tag@Smith-Law.com')).to.equal('smith-law.com');
		});

		it('strips a scheme, path, query and fragment', () => {
			expect(normalizeDomain('https://smithlaw.com')).to.equal('smithlaw.com');
			expect(normalizeDomain('http://smithlaw.com/contact')).to.equal('smithlaw.com');
			expect(normalizeDomain('https://smithlaw.com/a/b?x=1#y')).to.equal('smithlaw.com');
		});

		it('strips a port', () => {
			expect(normalizeDomain('smithlaw.com:443')).to.equal('smithlaw.com');
		});

		it('strips leading and trailing dots (root-anchored FQDNs)', () => {
			expect(normalizeDomain('smithlaw.com.')).to.equal('smithlaw.com');
			expect(normalizeDomain('smithlaw.com...')).to.equal('smithlaw.com');
			expect(normalizeDomain('.smithlaw.com')).to.equal('smithlaw.com');
		});

		it('folds unicode to punycode, so the two forms are one domain', () => {
			expect(normalizeDomain('müller.de')).to.equal('xn--mller-kva.de');
			expect(normalizeDomain('MÜLLER.DE')).to.equal('xn--mller-kva.de');
			expect(normalizeDomain('xn--mller-kva.de')).to.equal('xn--mller-kva.de');
			// The whole point: a claim on either spelling collides with the other.
			expect(normalizeDomain('müller.de')).to.equal(normalizeDomain('xn--mller-kva.de'));
		});

		it('rejects non-strings', () => {
			expect(normalizeDomain(undefined)).to.be.null;
			expect(normalizeDomain(null)).to.be.null;
			expect(normalizeDomain(42)).to.be.null;
			expect(normalizeDomain(['smithlaw.com'])).to.be.null;
			expect(normalizeDomain({ domain: 'smithlaw.com' })).to.be.null;
			expect(normalizeDomain(true)).to.be.null;
		});

		it('rejects empty and whitespace-only input', () => {
			expect(normalizeDomain('')).to.be.null;
			expect(normalizeDomain('   ')).to.be.null;
			expect(normalizeDomain('\t\n')).to.be.null;
			expect(normalizeDomain('@')).to.be.null;
			expect(normalizeDomain('.')).to.be.null;
			expect(normalizeDomain('...')).to.be.null;
		});

		it('rejects a single label (no dot)', () => {
			expect(normalizeDomain('smithlaw')).to.be.null;
			expect(normalizeDomain('localhost')).to.be.null;
			expect(normalizeDomain('com')).to.be.null;
		});

		it('rejects internal whitespace', () => {
			expect(normalizeDomain('smith law.com')).to.be.null;
			expect(normalizeDomain('smithlaw .com')).to.be.null;
			expect(normalizeDomain('smith\tlaw.com')).to.be.null;
		});

		it('rejects empty labels', () => {
			expect(normalizeDomain('smithlaw..com')).to.be.null;
			expect(normalizeDomain('a..b.com')).to.be.null;
		});

		it('rejects labels that start or end with a hyphen', () => {
			expect(normalizeDomain('-smithlaw.com')).to.be.null;
			expect(normalizeDomain('smithlaw-.com')).to.be.null;
			expect(normalizeDomain('sub.-smithlaw.com')).to.be.null;
		});

		it('rejects characters that are not legal in a hostname label', () => {
			expect(normalizeDomain('_dmarc.smithlaw.com')).to.be.null;
			expect(normalizeDomain('smith_law.com')).to.be.null;
			expect(normalizeDomain('smith!law.com')).to.be.null;
		});

		it('rejects a one-character or numeric TLD', () => {
			expect(normalizeDomain('smithlaw.c')).to.be.null;
			expect(normalizeDomain('smithlaw.123')).to.be.null;
		});

		it('rejects IP literals, which are not claimable mail domains', () => {
			expect(normalizeDomain('192.168.1.1')).to.be.null;
			expect(normalizeDomain('8.8.8.8')).to.be.null;
			expect(normalizeDomain('[::1]')).to.be.null;
			expect(normalizeDomain('http://127.0.0.1:8080')).to.be.null;
		});

		it('rejects over-long labels and over-long names', () => {
			expect(normalizeDomain(`${'a'.repeat(63)}.com`)).to.equal(`${'a'.repeat(63)}.com`);
			expect(normalizeDomain(`${'a'.repeat(64)}.com`)).to.be.null;
			// 255+ chars of otherwise-legal labels.
			const long = `${Array.from({ length: 10 }, () => 'a'.repeat(25)).join('.')}.com`;
			expect(long.length).to.be.greaterThan(253);
			expect(normalizeDomain(long)).to.be.null;
		});

		it('is idempotent — normalizing a normalized domain changes nothing', () => {
			for (const input of ['@Smith-Law.COM ', 'https://sub.smithlaw.co.uk/x', 'jane@müller.de']) {
				const once = normalizeDomain(input);
				expect(once).to.not.be.null;
				expect(normalizeDomain(once)).to.equal(once);
			}
		});
	});

	describe('extractEmailDomain', () => {
		it('extracts and normalizes the domain', () => {
			expect(extractEmailDomain('jane@smithlaw.com')).to.equal('smithlaw.com');
			expect(extractEmailDomain('  Jane.Doe+intake@SmithLaw.COM ')).to.equal('smithlaw.com');
			expect(extractEmailDomain('jane@müller.de')).to.equal('xn--mller-kva.de');
		});

		it('rejects a bare domain — a missing local part means the wrong thing was passed', () => {
			expect(extractEmailDomain('smithlaw.com')).to.be.null;
			expect(extractEmailDomain('@smithlaw.com')).to.be.null;
		});

		it('rejects malformed addresses', () => {
			expect(extractEmailDomain('jane@')).to.be.null;
			expect(extractEmailDomain('jane@@smithlaw.com')).to.be.null;
			expect(extractEmailDomain('jane@a@smithlaw.com')).to.be.null;
			expect(extractEmailDomain('jane at smithlaw.com')).to.be.null;
			expect(extractEmailDomain('jane doe@smithlaw.com')).to.be.null;
			expect(extractEmailDomain('jane@smithlaw')).to.be.null;
			expect(extractEmailDomain('jane@.com')).to.be.null;
			expect(extractEmailDomain('')).to.be.null;
			expect(extractEmailDomain('   ')).to.be.null;
		});

		it('rejects non-strings', () => {
			expect(extractEmailDomain(undefined)).to.be.null;
			expect(extractEmailDomain(null)).to.be.null;
			expect(extractEmailDomain(1234)).to.be.null;
			expect(extractEmailDomain(['jane@smithlaw.com'])).to.be.null;
		});
	});

	describe('isPublicEmailProvider', () => {
		it('blocks every provider on the list', () => {
			for (const provider of PUBLIC_EMAIL_PROVIDERS) {
				expect(isPublicEmailProvider(provider), provider).to.be.true;
			}
		});

		it('covers the providers the brief requires', () => {
			for (const provider of [
				'gmail.com',
				'googlemail.com',
				'outlook.com',
				'hotmail.com',
				'live.com',
				'msn.com',
				'yahoo.com',
				'ymail.com',
				'aol.com',
				'icloud.com',
				'me.com',
				'mac.com',
				'proton.me',
				'protonmail.com',
				'pm.me',
				'gmx.com',
				'mail.com',
				'zoho.com',
				'yandex.com',
				'qq.com',
				'163.com',
			]) {
				expect(PUBLIC_EMAIL_PROVIDERS, provider).to.include(provider);
			}
		});

		it('blocks regardless of case, whitespace or leading @', () => {
			expect(isPublicEmailProvider('GMAIL.COM')).to.be.true;
			expect(isPublicEmailProvider('  Gmail.Com  ')).to.be.true;
			expect(isPublicEmailProvider('@gmail.com')).to.be.true;
			expect(isPublicEmailProvider('GmAiL.cOm.')).to.be.true;
		});

		it('blocks when handed a full address at a provider', () => {
			expect(isPublicEmailProvider('jane@gmail.com')).to.be.true;
			expect(isPublicEmailProvider('Jane.Doe@Outlook.com')).to.be.true;
		});

		// Policy: a subdomain of a public provider is under the PROVIDER's control,
		// never the claimant's, so it is blocked too.
		it('blocks subdomains of a blocked provider', () => {
			expect(isPublicEmailProvider('mail.gmail.com')).to.be.true;
			expect(isPublicEmailProvider('a.b.gmail.com')).to.be.true;
			expect(isPublicEmailProvider('MAIL.GMAIL.COM')).to.be.true;
			expect(isPublicEmailProvider('smithlaw.mail.com')).to.be.true;
			expect(isPublicEmailProvider('legal.proton.me')).to.be.true;
		});

		// ...but the rule is one-directional. A registrable domain that merely ENDS
		// with a provider's name is a different domain and blocking it would be theatre.
		it('does not block look-alike domains that only contain a provider name', () => {
			expect(isPublicEmailProvider('gmail.com.evil.example')).to.be.false;
			expect(isPublicEmailProvider('notgmail.com')).to.be.false;
			expect(isPublicEmailProvider('gmail.co')).to.be.false;
			expect(isPublicEmailProvider('mygmail.com')).to.be.false;
			expect(isPublicEmailProvider('gmailer.com')).to.be.false;
		});

		it('allows ordinary firm domains', () => {
			expect(isPublicEmailProvider('smithlaw.com')).to.be.false;
			expect(isPublicEmailProvider('smith-associates.co.uk')).to.be.false;
		});

		it('returns false rather than throwing on junk', () => {
			expect(isPublicEmailProvider(undefined)).to.be.false;
			expect(isPublicEmailProvider(null)).to.be.false;
			expect(isPublicEmailProvider('')).to.be.false;
			expect(isPublicEmailProvider(42)).to.be.false;
			expect(isPublicEmailProvider('not a domain')).to.be.false;
		});
	});

	describe('checkClaimableDomain', () => {
		it('accepts and returns the normalized domain', () => {
			expect(checkClaimableDomain(' @SmithLaw.COM ')).to.deep.equal({ ok: true, domain: 'smithlaw.com' });
			expect(checkClaimableDomain('jane@müller.de')).to.deep.equal({ ok: true, domain: 'xn--mller-kva.de' });
		});

		it('reports invalid input distinctly from a public provider', () => {
			expect(checkClaimableDomain('nope')).to.deep.equal({ ok: false, reason: 'invalid' });
			expect(checkClaimableDomain('')).to.deep.equal({ ok: false, reason: 'invalid' });
			expect(checkClaimableDomain(undefined)).to.deep.equal({ ok: false, reason: 'invalid' });
			expect(checkClaimableDomain('gmail.com')).to.deep.equal({ ok: false, reason: 'public-provider' });
			expect(checkClaimableDomain('mail.gmail.com')).to.deep.equal({ ok: false, reason: 'public-provider' });
		});
	});

	describe('pickAdoptableEmail', () => {
		const verified = { address: 'Jane@SmithLaw.com', verified: true };
		const unverified = { address: 'other@smithlaw.com', verified: false };

		it('prefers a verified address, lowercased and trimmed', () => {
			expect(pickAdoptableEmail([unverified, verified], { requireVerified: true })).to.equal('jane@smithlaw.com');
			expect(pickAdoptableEmail([unverified, verified], { requireVerified: false })).to.equal('jane@smithlaw.com');
			expect(pickAdoptableEmail([{ address: '  Jane@SmithLaw.com  ', verified: true }], { requireVerified: true })).to.equal(
				'jane@smithlaw.com',
			);
		});

		it('refuses an unverified address when the workspace verifies email', () => {
			expect(pickAdoptableEmail([unverified], { requireVerified: true })).to.be.null;
			expect(pickAdoptableEmail([{ address: 'x@y.com' }], { requireVerified: true })).to.be.null;
		});

		it('falls back to the first address when the workspace does not verify email', () => {
			expect(pickAdoptableEmail([unverified], { requireVerified: false })).to.equal('other@smithlaw.com');
			expect(pickAdoptableEmail([{ address: 'x@y.com' }], { requireVerified: false })).to.equal('x@y.com');
		});

		it('handles missing, empty and malformed email arrays', () => {
			expect(pickAdoptableEmail(undefined, { requireVerified: false })).to.be.null;
			expect(pickAdoptableEmail(null, { requireVerified: false })).to.be.null;
			expect(pickAdoptableEmail([], { requireVerified: false })).to.be.null;
			expect(pickAdoptableEmail('jane@smithlaw.com', { requireVerified: false })).to.be.null;
			expect(pickAdoptableEmail([null, undefined, 'nope', 7], { requireVerified: false })).to.be.null;
			expect(pickAdoptableEmail([{ verified: true }], { requireVerified: true })).to.be.null;
			expect(pickAdoptableEmail([{ address: '   ', verified: true }], { requireVerified: false })).to.be.null;
		});

		it('treats a truthy-but-not-true verified flag as unverified', () => {
			expect(pickAdoptableEmail([{ address: 'x@y.com', verified: 'yes' }], { requireVerified: true })).to.be.null;
			expect(pickAdoptableEmail([{ address: 'x@y.com', verified: 1 }], { requireVerified: true })).to.be.null;
		});
	});

	describe('the two modules agree', () => {
		it('normalizes an address and a domain to the same string', () => {
			expect(extractEmailDomain('jane@Smith-Law.com')).to.equal(normalizeDomain('Smith-Law.com'));
		});

		it('never lets a public provider through checkClaimableDomain via an address', () => {
			for (const provider of PUBLIC_EMAIL_PROVIDERS) {
				expect(checkClaimableDomain(`jane@${provider}`), provider).to.deep.equal({ ok: false, reason: 'public-provider' });
			}
		});
	});
});
