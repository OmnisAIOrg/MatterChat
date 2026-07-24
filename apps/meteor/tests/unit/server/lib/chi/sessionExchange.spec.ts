import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	EXCHANGE_TOKEN_LIFETIME_MS,
	identityFromIssuerSession,
	isLocallyVerifiableAlg,
	loginTokenWhenForExpiry,
	parseAllowedClientIds,
	parseJwt,
	pickJwk,
	validateExchangeClaims,
	verifyJwsSignature,
} from '../../../../../server/lib/chi/sessionExchange';
import type { ExchangeClaims, Jwk } from '../../../../../server/lib/chi/sessionExchange';

const b64 = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');

const NOW = 1_800_000_000; // fixed "now" (seconds) for claim checks
const ISSUER = 'https://auth-app.omnisai.io';

const goodClaims = (over: Partial<ExchangeClaims> = {}): ExchangeClaims => ({
	iss: ISSUER,
	sub: 'ca-user-uuid-1',
	exp: NOW + 600,
	...over,
});

const check = (claims: ExchangeClaims, allowedClientIds: string[] = []) =>
	validateExchangeClaims(claims, { issuer: ISSUER, allowedClientIds, nowSeconds: NOW });

describe('chi session exchange — JWT parsing', () => {
	it('returns undefined for a non-JWT (opaque session token → introspection lane)', () => {
		expect(parseJwt('ohsvE9AnJXmthDDIeRRSFAqNbSjXt3lQ')).to.be.undefined;
		expect(parseJwt('a.b')).to.be.undefined;
	});

	it('parses a compact JWS into header/claims/signingInput', () => {
		const parsed = parseJwt(`${b64({ alg: 'EdDSA', kid: 'k1' })}.${b64(goodClaims())}.${Buffer.from('sig').toString('base64url')}`);
		expect(parsed?.header).to.deep.include({ alg: 'EdDSA', kid: 'k1' });
		expect(parsed?.claims.sub).to.equal('ca-user-uuid-1');
		expect(parsed?.signingInput.split('.')).to.have.length(2);
	});

	it('throws on three-segment garbage (JWT-shaped but not a JWT)', () => {
		expect(() => parseJwt('not.actual.jwt')).to.throw('exchange_token_malformed');
	});
});

describe('chi session exchange — alg gate', () => {
	it('accepts only asymmetric algs the issuer publishes public keys for', () => {
		expect(isLocallyVerifiableAlg('EdDSA')).to.be.true;
		expect(isLocallyVerifiableAlg('RS256')).to.be.true;
		expect(isLocallyVerifiableAlg('ES256')).to.be.true;
	});

	it('routes HS* to the introspection lane (we must never hold the issuer HMAC secret)', () => {
		expect(isLocallyVerifiableAlg('HS256')).to.be.false;
		expect(isLocallyVerifiableAlg('HS512')).to.be.false;
		expect(isLocallyVerifiableAlg(undefined)).to.be.false;
	});

	it('rejects alg:none outright — never introspected, never accepted', () => {
		expect(() => isLocallyVerifiableAlg('none')).to.throw('exchange_token_alg_none_rejected');
	});
});

describe('chi session exchange — JWKS key pick + signature verify', () => {
	it('picks by kid, falls back to a sole key only for kid-less tokens', () => {
		const keys: Jwk[] = [
			{ kty: 'OKP', kid: 'a' },
			{ kty: 'RSA', kid: 'b' },
		];
		expect(pickJwk(keys, 'b')?.kid).to.equal('b');
		expect(pickJwk(keys, 'missing')).to.be.undefined;
		expect(pickJwk(keys, undefined)).to.be.undefined;
		expect(pickJwk([keys[0]], undefined)?.kid).to.equal('a');
	});

	it('verifies a real Ed25519 signature and rejects a tampered payload', () => {
		const { publicKey, privateKey } = generateKeyPairSync('ed25519');
		const jwk = publicKey.export({ format: 'jwk' }) as Jwk;
		const signingInput = `${b64({ alg: 'EdDSA' })}.${b64(goodClaims())}`;
		const signature = cryptoSign(null, Buffer.from(signingInput), privateKey);
		expect(verifyJwsSignature(jwk, 'EdDSA', signingInput, signature)).to.be.true;
		expect(verifyJwsSignature(jwk, 'EdDSA', `${signingInput}x`, signature)).to.be.false;
	});

	it('verifies a real RS256 signature and rejects a wrong key', () => {
		const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
		const jwk = publicKey.export({ format: 'jwk' }) as Jwk;
		const otherJwk = other.export({ format: 'jwk' }) as Jwk;
		const signingInput = `${b64({ alg: 'RS256' })}.${b64(goodClaims())}`;
		const signature = cryptoSign('sha256', Buffer.from(signingInput), privateKey);
		expect(verifyJwsSignature(jwk, 'RS256', signingInput, signature)).to.be.true;
		expect(verifyJwsSignature(otherJwk, 'RS256', signingInput, signature)).to.be.false;
	});

	it('never throws on junk key material — a broken JWK is a failed verification', () => {
		expect(verifyJwsSignature({ kty: 'RSA', n: '!!', e: '!!' }, 'RS256', 'a.b', Buffer.from('sig'))).to.be.false;
	});
});

describe('chi session exchange — hard claim validation', () => {
	it('passes a good token and extracts the identity', () => {
		const id = check(goodClaims({ 'email': 'sam@firm.com', 'name': 'Sam Rivera', 'preferred_username': 'sam', 'casepro:org_id': 'org-1', 'casepro:role': 'attorney' }));
		expect(id).to.deep.equal({ sub: 'ca-user-uuid-1', email: 'sam@firm.com', name: 'Sam Rivera', username: 'sam', orgId: 'org-1', role: 'attorney' });
	});

	it('requires sub', () => {
		expect(() => check(goodClaims({ sub: undefined }))).to.throw('exchange_token_no_subject');
		expect(() => check(goodClaims({ sub: '   ' }))).to.throw('exchange_token_no_subject');
	});

	it('requires a numeric future exp — no unexpiring tokens', () => {
		expect(() => check(goodClaims({ exp: undefined }))).to.throw('exchange_token_no_exp');
		expect(() => check(goodClaims({ exp: 'later' }))).to.throw('exchange_token_no_exp');
		expect(() => check(goodClaims({ exp: NOW - 1 }))).to.throw('exchange_token_expired');
		expect(() => check(goodClaims({ exp: NOW }))).to.throw('exchange_token_expired');
	});

	it('REQUIRES iss (stricter than verifyIdToken: this token is caller-supplied, not back-channel)', () => {
		expect(() => check(goodClaims({ iss: undefined }))).to.throw('exchange_token_no_issuer');
		expect(() => check(goodClaims({ iss: '' }))).to.throw('exchange_token_no_issuer');
	});

	it('matches iss by origin — path differences pass, host differences fail', () => {
		expect(check(goodClaims({ iss: `${ISSUER}/api/auth` })).sub).to.equal('ca-user-uuid-1');
		expect(() => check(goodClaims({ iss: 'https://evil.example.com' }))).to.throw('exchange_token_bad_issuer');
		expect(() => check(goodClaims({ iss: 'not a url' }))).to.throw('exchange_token_bad_issuer');
	});

	it('aud present + allowlisted → pass (string or array form)', () => {
		expect(check(goodClaims({ aud: 'chi-desktop' }), ['chi-desktop']).sub).to.equal('ca-user-uuid-1');
		expect(check(goodClaims({ aud: ['other', 'chi-desktop'] }), ['chi-desktop']).sub).to.equal('ca-user-uuid-1');
	});

	it('aud present + not allowlisted → reject (blocks cross-app token replay)', () => {
		expect(() => check(goodClaims({ aud: 'some-other-product' }), ['chi-desktop'])).to.throw('exchange_token_bad_audience');
	});

	it('aud present + NO allowlist configured → reject fail-closed, with a distinct reason for the admin', () => {
		expect(() => check(goodClaims({ aud: 'chi-desktop' }), [])).to.throw('exchange_token_aud_unconfigured');
	});

	it('aud absent → pass (better-auth omits aud; issuer signature + allowlist guard the rest)', () => {
		expect(check(goodClaims(), []).sub).to.equal('ca-user-uuid-1');
	});
});

describe('chi session exchange — issuer introspection identity', () => {
	it('reads every envelope shape better-auth may answer with', () => {
		expect(identityFromIssuerSession({ userId: 'u1' })?.sub).to.equal('u1');
		expect(identityFromIssuerSession({ session: { userId: 'u2' } })?.sub).to.equal('u2');
		expect(identityFromIssuerSession({ user: { id: 'u3', email: 'a@b.c', name: 'A' } })).to.deep.include({ sub: 'u3', email: 'a@b.c', name: 'A' });
		expect(identityFromIssuerSession({ session: { user: { id: 'u4' } } })?.sub).to.equal('u4');
		expect(identityFromIssuerSession({ sub: 'u5' })?.sub).to.equal('u5');
	});

	it('no user id anywhere → undefined (caller rejects)', () => {
		expect(identityFromIssuerSession({})).to.be.undefined;
		expect(identityFromIssuerSession(null)).to.be.undefined;
		expect(identityFromIssuerSession('ok')).to.be.undefined;
		expect(identityFromIssuerSession({ user: { id: 42 } })).to.be.undefined;
	});
});

describe('chi session exchange — ~30-day token lifetime math', () => {
	const DAY = 24 * 60 * 60 * 1000;
	const now = 1_800_000_000_000;

	it('backdates `when` so a 90-day workspace lifetime nets ~30 days', () => {
		expect(loginTokenWhenForExpiry(now, 90 * DAY).getTime()).to.equal(now - 60 * DAY);
	});

	it('a workspace lifetime at or under 30 days wins (never forward-dates)', () => {
		expect(loginTokenWhenForExpiry(now, 20 * DAY).getTime()).to.equal(now);
		expect(loginTokenWhenForExpiry(now, 30 * DAY).getTime()).to.equal(now);
	});

	it('target lifetime constant is ~30 days', () => {
		expect(EXCHANGE_TOKEN_LIFETIME_MS).to.equal(30 * DAY);
	});
});

describe('chi session exchange — client-id allowlist parsing', () => {
	it('splits on commas and whitespace, drops empties', () => {
		expect(parseAllowedClientIds(' chi-desktop, WoqX123 ,,\n other ')).to.deep.equal(['chi-desktop', 'WoqX123', 'other']);
		expect(parseAllowedClientIds('')).to.deep.equal([]);
		expect(parseAllowedClientIds(undefined as unknown as string)).to.deep.equal([]);
	});
});
