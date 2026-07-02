import crypto from 'crypto';

import { expect } from 'chai';

import { encryptCredentials, decryptCredentials, isEncryptionConfigured } from '../../../../../app/connectors/server/tokenCrypto';

// Test keys are generated per-run — no fixed secret is ever committed.
const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('base64');

const CREDS = { accessToken: 'xoxb-secret', refreshToken: 'xoxe-refresh', expiresAt: 1234567890 };

describe('tokenCrypto (EXTERNAL_TOKEN_ENC_KEY connector-credential encrypt-at-rest)', () => {
	const originalKey = process.env.EXTERNAL_TOKEN_ENC_KEY;

	afterEach(() => {
		if (originalKey === undefined) {
			delete process.env.EXTERNAL_TOKEN_ENC_KEY;
		} else {
			process.env.EXTERNAL_TOKEN_ENC_KEY = originalKey;
		}
	});

	describe('with a configured key', () => {
		beforeEach(() => {
			process.env.EXTERNAL_TOKEN_ENC_KEY = KEY_A;
		});

		it('reports encryption as configured', () => {
			expect(isEncryptionConfigured()).to.be.true;
		});

		it('round-trips a credentials object and stamps keyId v1', () => {
			const ref = encryptCredentials(CREDS);
			expect(ref.keyId).to.equal('v1');
			expect(ref.encryptedBlob.startsWith('enc:v1:')).to.be.true;
			expect(decryptCredentials(ref)).to.deep.equal(CREDS);
		});

		it('never leaks token material into the stored blob', () => {
			const ref = encryptCredentials(CREDS);
			expect(ref.encryptedBlob).to.not.include('xoxb-secret');
			expect(ref.encryptedBlob).to.not.include('xoxe-refresh');
		});

		it('uses a random IV per encryption (same credentials, different blobs)', () => {
			expect(encryptCredentials(CREDS).encryptedBlob).to.not.equal(encryptCredentials(CREDS).encryptedBlob);
		});

		it('fails closed (undefined) when decrypting with the WRONG key', () => {
			const ref = encryptCredentials(CREDS);
			process.env.EXTERNAL_TOKEN_ENC_KEY = KEY_B;
			expect(decryptCredentials(ref)).to.be.undefined;
		});

		it('returns legacy plaintext blobs as-is (keyId plain records written before the key existed)', () => {
			const legacy = { encryptedBlob: JSON.stringify(CREDS), keyId: 'plain' };
			expect(decryptCredentials(legacy)).to.deep.equal(CREDS);
		});
	});

	describe('with NO key configured (fail-safe plaintext fallback)', () => {
		beforeEach(() => {
			delete process.env.EXTERNAL_TOKEN_ENC_KEY;
		});

		it('reports encryption as not configured', () => {
			expect(isEncryptionConfigured()).to.be.false;
		});

		it('stores plaintext stamped keyId plain, and round-trips it', () => {
			const ref = encryptCredentials(CREDS);
			expect(ref.keyId).to.equal('plain');
			expect(ref.encryptedBlob).to.equal(JSON.stringify(CREDS));
			expect(decryptCredentials(ref)).to.deep.equal(CREDS);
		});

		it('fails closed (undefined) on an encrypted blob it can no longer decrypt', () => {
			process.env.EXTERNAL_TOKEN_ENC_KEY = KEY_A;
			const ref = encryptCredentials(CREDS);
			delete process.env.EXTERNAL_TOKEN_ENC_KEY;
			expect(decryptCredentials(ref)).to.be.undefined;
		});

		it('handles a missing ref (undefined) without crashing', () => {
			expect(decryptCredentials(undefined)).to.be.undefined;
		});
	});

	describe('with an INVALID key (wrong length)', () => {
		it('degrades to the no-key behavior (keyId plain)', () => {
			process.env.EXTERNAL_TOKEN_ENC_KEY = 'too-short';
			expect(isEncryptionConfigured()).to.be.false;
			expect(encryptCredentials(CREDS).keyId).to.equal('plain');
		});
	});
});
