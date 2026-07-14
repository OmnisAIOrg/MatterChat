import crypto from 'crypto';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { decryptCredentials, encryptCredentials, isEncryptionConfigured } from '../../../../../../app/connectors/server/tokenCrypto';

/**
 * The Boards calendar connection REUSES the connector AES-256-GCM token crypto (EXTERNAL_TOKEN_ENC_KEY)
 * to store OAuth tokens encrypted at rest — no new crypto is introduced. This proves the same
 * encrypt/decrypt round-trip holds for the calendar credential shape (access + refresh + expiry).
 */
const KEY = crypto.randomBytes(32).toString('base64');
const CREDS = { accessToken: 'ya29.google-access', refreshToken: '1//refresh', expiresAt: Date.now() + 3600_000 };

describe('boards calendar token encrypt-at-rest (reuses connector tokenCrypto)', () => {
	const original = process.env.EXTERNAL_TOKEN_ENC_KEY;
	afterEach(() => {
		if (original === undefined) {
			delete process.env.EXTERNAL_TOKEN_ENC_KEY;
		} else {
			process.env.EXTERNAL_TOKEN_ENC_KEY = original;
		}
	});

	it('round-trips calendar credentials with a configured key (ciphertext is not plaintext)', () => {
		process.env.EXTERNAL_TOKEN_ENC_KEY = KEY;
		expect(isEncryptionConfigured()).to.be.true;
		const ref = encryptCredentials(CREDS);
		expect(ref.keyId).to.equal('v1');
		expect(ref.encryptedBlob).to.match(/^enc:v1:/);
		expect(ref.encryptedBlob).to.not.contain('google-access');
		expect(decryptCredentials(ref)).to.deep.equal(CREDS);
	});

	it('fails closed (undefined) when the key is missing for an encrypted blob', () => {
		process.env.EXTERNAL_TOKEN_ENC_KEY = KEY;
		const ref = encryptCredentials(CREDS);
		delete process.env.EXTERNAL_TOKEN_ENC_KEY;
		expect(decryptCredentials(ref)).to.equal(undefined);
	});

	it('is a dev no-op (plaintext) when no key is configured', () => {
		delete process.env.EXTERNAL_TOKEN_ENC_KEY;
		expect(isEncryptionConfigured()).to.be.false;
		const ref = encryptCredentials(CREDS);
		expect(ref.keyId).to.equal('plain');
		expect(decryptCredentials(ref)).to.deep.equal(CREDS);
	});
});
