/**
 * Encrypt-at-rest for the LitBox OIDC credential persisted on the user doc
 * (omnisaiLitbox.{sessionToken,refreshToken}). AES-256-GCM with a key from the
 * LITBOX_TOKEN_ENC_KEY env var (base64-encoded 32 bytes).
 *
 * BACKWARD-COMPATIBLE / NON-BREAKING by design:
 *  - No key configured  -> encryptToken returns plaintext (exactly as before), and
 *    decryptToken returns plaintext unchanged. The feature is a no-op until a key is set.
 *  - Legacy plaintext tokens (no "enc:v1:" prefix) are returned as-is by decryptToken,
 *    so enabling the key does not break credentials stored before it.
 *
 * Stored format: `enc:v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>`.
 */
import crypto from 'crypto';

const ENC_PREFIX = 'enc:v1:';

function getKey(): Buffer | null {
	const raw = (process.env.LITBOX_TOKEN_ENC_KEY || '').trim();
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

/** Encrypt a token for storage. Returns the plaintext unchanged when no key is configured. */
export function encryptToken(plain: string | undefined): string | undefined {
	if (!plain) {
		return plain;
	}
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
 * Decrypt a stored token. Plaintext values (no enc prefix) are returned as-is (legacy).
 * Returns undefined if the value is encrypted but the key is missing/wrong (fail closed —
 * the proxy then 401s and the user re-auths, rather than forwarding a garbage credential).
 */
export function decryptToken(stored: string | undefined): string | undefined {
	if (!stored || !stored.startsWith(ENC_PREFIX)) {
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
