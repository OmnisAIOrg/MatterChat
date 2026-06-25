/**
 * Encrypt-at-rest for external-workspace connection credentials (Slack/Teams OAuth tokens).
 *
 * Generalized from apps/meteor/app/omnisai-oauth/server/litboxCrypto.ts (same AES-256-GCM
 * scheme), keyed by its OWN env var `EXTERNAL_TOKEN_ENC_KEY` (base64-encoded 32 bytes) so the
 * connector store has an independent key from the LitBox credential store.
 *
 * Produces an IEncryptedTokenRef = { encryptedBlob, keyId } for storage on the connection doc
 * (IExternalWorkspaceConnection.credentials). Raw tokens are NEVER persisted in plaintext.
 *
 * BACKWARD-COMPATIBLE / NON-BREAKING by design (matches litboxCrypto):
 *  - No key configured  -> encrypt returns the plaintext blob (keyId `plain`), and decrypt
 *    returns it unchanged. The feature is a no-op until a key is set (dev-friendly).
 *  - Legacy plaintext blobs (no `enc:v1:` prefix) are returned as-is by decrypt.
 *  - Encrypted blob present but key missing/wrong -> decrypt returns undefined (fail closed),
 *    so the caller re-auths rather than forwarding a garbage credential.
 *
 * Stored blob format: `enc:v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>`.
 */
import crypto from 'crypto';

import type { IEncryptedTokenRef } from '@rocket.chat/core-typings';

const ENC_PREFIX = 'enc:v1:';
/** keyId stamped when a real key encrypted the blob. Bump (`v2`, …) when rotating keys. */
const ACTIVE_KEY_ID = 'v1';
/** keyId stamped when NO key is configured (the blob is plaintext). */
const PLAINTEXT_KEY_ID = 'plain';

function getKey(): Buffer | null {
	const raw = (process.env.EXTERNAL_TOKEN_ENC_KEY || '').trim();
	if (!raw) {
		return null;
	}
	try {
		const key = Buffer.from(raw, 'base64');
		// AES-256 needs exactly 32 bytes; anything else is a misconfiguration -> no-op.
		return key.length === 32 ? key : null;
	} catch {
		return null;
	}
}

/** True when a usable 32-byte key is configured (prod should enforce this). */
export function isEncryptionConfigured(): boolean {
	return getKey() !== null;
}

/** Low-level: encrypt a string. Returns plaintext unchanged when no key is configured. */
function encryptString(plain: string): string {
	const key = getKey();
	if (!key) {
		return plain;
	}
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Low-level: decrypt a stored blob. Plaintext values (no enc prefix) returned as-is (legacy/dev).
 * Returns undefined if the blob is encrypted but the key is missing/wrong (fail closed).
 */
function decryptString(stored: string): string | undefined {
	if (!stored.startsWith(ENC_PREFIX)) {
		return stored;
	}
	const key = getKey();
	if (!key) {
		return undefined;
	}
	try {
		const parts = stored.slice(ENC_PREFIX.length).split(':');
		if (parts.length !== 3) {
			return undefined;
		}
		const [ivB64, tagB64, ctB64] = parts;
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
		decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
	} catch {
		return undefined;
	}
}

/**
 * Encrypt a credentials object into an IEncryptedTokenRef for storage on a connection doc.
 * The object is JSON-serialized before encryption so any provider-shaped credential blob fits.
 */
export function encryptCredentials(credentials: Record<string, unknown>): IEncryptedTokenRef {
	const json = JSON.stringify(credentials);
	const configured = isEncryptionConfigured();
	return {
		encryptedBlob: encryptString(json),
		keyId: configured ? ACTIVE_KEY_ID : PLAINTEXT_KEY_ID,
	};
}

/**
 * Decrypt an IEncryptedTokenRef back into a credentials object. Returns undefined when the blob
 * cannot be decrypted (missing/wrong key) so callers fail closed and force a reconnect.
 */
export function decryptCredentials<T = Record<string, unknown>>(ref: IEncryptedTokenRef | undefined): T | undefined {
	if (!ref?.encryptedBlob) {
		return undefined;
	}
	const json = decryptString(ref.encryptedBlob);
	if (json === undefined) {
		return undefined;
	}
	try {
		return JSON.parse(json) as T;
	} catch {
		return undefined;
	}
}
