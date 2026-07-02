import crypto from 'crypto';

import { expect } from 'chai';

import { encryptToken, decryptToken, getKeyStatus, isEncryptedValue } from '../../../../../app/omnisai-oauth/server/litboxCrypto';

// Test keys are generated per-run — no fixed secret is ever committed.
const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('base64');

describe('litboxCrypto (LITBOX_TOKEN_ENC_KEY encrypt-at-rest)', () => {
	const originalKey = process.env.LITBOX_TOKEN_ENC_KEY;

	afterEach(() => {
		if (originalKey === undefined) {
			delete process.env.LITBOX_TOKEN_ENC_KEY;
		} else {
			process.env.LITBOX_TOKEN_ENC_KEY = originalKey;
		}
	});

	describe('with a configured key', () => {
		beforeEach(() => {
			process.env.LITBOX_TOKEN_ENC_KEY = KEY_A;
		});

		it('reports the key as configured', () => {
			expect(getKeyStatus()).to.equal('configured');
		});

		it('round-trips a token', () => {
			const stored = encryptToken('my-secret-token');
			expect(decryptToken(stored)).to.equal('my-secret-token');
		});

		it('produces the versioned enc:v1: format (iv:tag:ciphertext, all base64)', () => {
			const stored = encryptToken('my-secret-token') as string;
			expect(stored.startsWith('enc:v1:')).to.be.true;
			const parts = stored.slice('enc:v1:'.length).split(':');
			expect(parts).to.have.lengthOf(3);
			expect(Buffer.from(parts[0], 'base64')).to.have.lengthOf(12); // GCM IV
			expect(Buffer.from(parts[1], 'base64')).to.have.lengthOf(16); // GCM auth tag
		});

		it('never leaks the plaintext into the stored value', () => {
			const stored = encryptToken('my-secret-token') as string;
			expect(stored).to.not.include('my-secret-token');
		});

		it('uses a random IV per encryption (same plaintext, different ciphertexts)', () => {
			expect(encryptToken('same-token')).to.not.equal(encryptToken('same-token'));
		});

		it('returns legacy plaintext values as-is on decrypt (lazy-migration compatibility)', () => {
			expect(decryptToken('legacy-plaintext-token')).to.equal('legacy-plaintext-token');
		});

		it('fails closed (undefined) when decrypting with the WRONG key', () => {
			const stored = encryptToken('my-secret-token');
			process.env.LITBOX_TOKEN_ENC_KEY = KEY_B;
			expect(decryptToken(stored)).to.be.undefined;
		});

		it('fails closed (undefined) on a tampered ciphertext', () => {
			const stored = encryptToken('my-secret-token') as string;
			const parts = stored.slice('enc:v1:'.length).split(':');
			const ct = Buffer.from(parts[2], 'base64');
			ct[0] ^= 0xff;
			expect(decryptToken(`enc:v1:${parts[0]}:${parts[1]}:${ct.toString('base64')}`)).to.be.undefined;
		});

		it('fails closed (undefined) on a malformed enc:v1: blob', () => {
			expect(decryptToken('enc:v1:not-a-valid-blob')).to.be.undefined;
			expect(decryptToken('enc:v1:a:b')).to.be.undefined;
		});

		it('passes undefined/empty through encryptToken unchanged', () => {
			expect(encryptToken(undefined)).to.be.undefined;
			expect(encryptToken('')).to.equal('');
		});
	});

	describe('with NO key configured (fail-safe plaintext fallback)', () => {
		beforeEach(() => {
			delete process.env.LITBOX_TOKEN_ENC_KEY;
		});

		it('reports the key as unset', () => {
			expect(getKeyStatus()).to.equal('unset');
		});

		it('encrypt is a no-op (plaintext stored, exactly the pre-key behavior)', () => {
			expect(encryptToken('my-secret-token')).to.equal('my-secret-token');
		});

		it('decrypt passes plaintext through unchanged', () => {
			expect(decryptToken('my-secret-token')).to.equal('my-secret-token');
		});

		it('fails closed (undefined) on an encrypted value it can no longer decrypt', () => {
			process.env.LITBOX_TOKEN_ENC_KEY = KEY_A;
			const stored = encryptToken('my-secret-token');
			delete process.env.LITBOX_TOKEN_ENC_KEY;
			expect(decryptToken(stored)).to.be.undefined;
		});
	});

	describe('with an INVALID key (wrong length / not base64-32-bytes)', () => {
		it('reports the key as invalid and degrades to the no-key behavior', () => {
			process.env.LITBOX_TOKEN_ENC_KEY = 'too-short';
			expect(getKeyStatus()).to.equal('invalid');
			expect(encryptToken('my-secret-token')).to.equal('my-secret-token');
		});
	});

	describe('isEncryptedValue', () => {
		it('detects encrypted vs legacy-plaintext vs missing values', () => {
			process.env.LITBOX_TOKEN_ENC_KEY = KEY_A;
			expect(isEncryptedValue(encryptToken('tok'))).to.be.true;
			expect(isEncryptedValue('legacy-plaintext-token')).to.be.false;
			expect(isEncryptedValue('')).to.be.false;
			expect(isEncryptedValue(undefined)).to.be.false;
		});
	});
});
