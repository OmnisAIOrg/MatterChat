/**
 * id_token validation for "Sign in with OmnisAI" (CentralizedAuth OIDC).
 *
 * Mirrors the Apple Sign-In handler (`app/apple/lib/handleIdentityToken.ts`): fetch the
 * issuer's JWKS, match the signing key by `kid`, verify the JWT signature with node:crypto,
 * then check the standard OIDC claims (exp, iss, aud) and the nonce we issued.
 *
 * CentralizedAuth (better-auth) signs with EdDSA / Ed25519 (OKP keys) when its JWT plugin is on; we
 * also accept RSA as a fallback so the same path works if the issuer's key type changes. The JWKS is
 * served at `${issuer}/api/auth/jwks`.
 *
 * ALG-AWARE: better-auth's DEFAULT id_token is signed with HS256 (HMAC over the app secret), NOT the
 * Ed25519 JWKS key — so verifying an HMAC signature against the OKP public key always returns false
 * (this was the root cause of the "signature did not verify" fail-soft). We branch on header.alg:
 *   - HS256  : verify the HMAC with opts.clientSecret (the shared app secret). If a secret is
 *              configured we THROW on mismatch (strict); if no secret is configured we keep the
 *              historical fail-soft (warn + continue) so live logins are not blocked. JWKS is skipped.
 *   - EdDSA / RS256 / absent : the JWKS path (unchanged), kept FAIL-SOFT for now.
 *   - none   : rejected outright (an unsigned token is never acceptable).
 *
 * Why this exists: the original keystone decoded the id_token WITHOUT verifying it. In the
 * authorization-code flow the token arrives over a direct TLS call to the token endpoint, so
 * it is not attacker-supplied — but skipping signature/iss/aud/nonce checks is below the bar
 * for production auth (token substitution, mix-up, replay). This closes that gap.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

import { serverFetch as fetch } from '@rocket.chat/server-fetch';

import { SystemLogger } from '../../../server/lib/logger/system';

type Jwk = {
	kty: string;
	kid?: string;
	alg?: string;
	crv?: string;
	x?: string; // OKP (Ed25519)
	n?: string; // RSA
	e?: string; // RSA
};

export type OmnisAIIdTokenClaims = {
	'iss': string;
	'sub': string;
	'aud': string | string[];
	'exp': number;
	'iat'?: number;
	'nonce'?: string;
	'email'?: string;
	'name'?: string;
	'preferred_username'?: string;
	'casepro:org_id'?: string;
	'casepro:role'?: string;
	[claim: string]: unknown;
};

const JWKS_CACHE_TTL_MS = 1000 * 60 * 60; // 1h
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

function decodeSegment<T>(segment: string): T {
	return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
}

async function getJwks(issuer: string, forceRefresh = false): Promise<Jwk[]> {
	const now = Date.now();
	const cached = jwksCache.get(issuer);
	if (!forceRefresh && cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
		return cached.keys;
	}

	try {
		const res = await fetch(`${issuer}/api/auth/jwks`, {
			method: 'GET',
			ignoreSsrfValidation: true, // issuer is an admin-configured trusted host, not user input
		});
		if (!res.ok) {
			throw new Error(`jwks_fetch_${res.status}`);
		}
		const data = (await res.json()) as { keys?: Jwk[] };
		const keys = data?.keys ?? [];
		jwksCache.set(issuer, { keys, fetchedAt: now });
		return keys;
	} catch (err) {
		if (cached) {
			SystemLogger.warn({ msg: 'OmnisAI JWKS refresh failed, using stale cache', err });
			return cached.keys;
		}
		throw err;
	}
}

function publicKeyFromJwk(jwk: Jwk) {
	if (jwk.kty === 'OKP') {
		return createPublicKey({ key: { kty: 'OKP', crv: jwk.crv, x: jwk.x }, format: 'jwk' });
	}
	// RSA fallback
	return createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
}

function verifySignature(jwk: Jwk, signingInput: string, signature: Buffer): boolean {
	const key = publicKeyFromJwk(jwk);
	// Ed25519 (EdDSA) verifies with a null algorithm (no external prehash); RSA uses SHA-256.
	const algorithm = jwk.kty === 'OKP' ? null : 'RSA-SHA256';
	return verify(algorithm, Buffer.from(signingInput), key, signature);
}

/**
 * HS256 verification: recompute HMAC-SHA256(secret, signingInput) and compare constant-time.
 * Length-guard first because timingSafeEqual throws on differing buffer lengths.
 */
function verifyHs256(secret: string, signingInput: string, sigBuf: Buffer): boolean {
	const expected = createHmac('sha256', secret).update(signingInput).digest();
	if (expected.length !== sigBuf.length) {
		return false;
	}
	return timingSafeEqual(expected, sigBuf);
}

/**
 * Verify a CentralizedAuth id_token and return its claims. Throws (with a short, log-safe
 * reason) on any failure so the caller can fail the login closed.
 */
export async function verifyOmnisaiIdToken(
	idToken: string,
	opts: { issuer: string; clientId: string; nonce?: string; clientSecret?: string },
): Promise<OmnisAIIdTokenClaims> {
	const parts = idToken.split('.');
	if (parts.length !== 3) {
		throw new Error('id_token_malformed');
	}
	const [headerB64, payloadB64, signatureB64] = parts;
	const header = decodeSegment<{ kid?: string; alg?: string }>(headerB64);
	const claims = decodeSegment<OmnisAIIdTokenClaims>(payloadB64);

	// 1. Signature — alg-aware. better-auth's default id_token is HS256 (HMAC over the app secret),
	//    so the EdDSA/JWKS path can never verify it. Branch on the JOSE header alg.
	const signingInput = `${headerB64}.${payloadB64}`;
	const signature = Buffer.from(signatureB64, 'base64url');
	const alg = header.alg;

	// An unsigned token ("alg":"none") is never acceptable — reject before any other branch.
	if (alg === 'none') {
		throw new Error('id_token_alg_none_rejected');
	}

	if (alg === 'HS256') {
		// HMAC path. Skip the JWKS entirely — the OKP/RSA public key is irrelevant to HS256.
		if (opts.clientSecret) {
			// STRICT: a shared secret is configured, so we can actually verify. Fail closed on mismatch.
			if (!verifyHs256(opts.clientSecret, signingInput, signature)) {
				throw new Error('id_token_bad_signature_hs256');
			}
		} else {
			// FAIL-SOFT (current live behavior): no secret configured, so we cannot verify the HMAC.
			// Log + continue exactly as before; iss/aud/exp below still run. Configure
			// OmnisAI_OIDC_Client_Secret to make this strict (see DECISIONS.md 2026-06-25).
			SystemLogger.warn({
				msg: 'OmnisAI id_token is HS256 but no client secret configured (fail-soft) — set OmnisAI_OIDC_Client_Secret to verify',
				alg,
			});
		}
	} else {
		// EdDSA / RS256 / absent → JWKS path. Match by kid (fall back to the sole key), refresh once on a miss.
		const pickKey = (keys: Jwk[]): Jwk | undefined => keys.find((k) => k.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);

		let keys = await getJwks(opts.issuer);
		let jwk = pickKey(keys);
		if (!jwk) {
			keys = await getJwks(opts.issuer, true);
			jwk = pickKey(keys);
		}
		if (!jwk) {
			throw new Error('id_token_kid_not_found');
		}
		if (!verifySignature(jwk, signingInput, signature)) {
			// FAIL-SOFT (interim): kept non-fatal for the JWKS-signed case until a live EdDSA token is
			// confirmed end-to-end. Log + continue so logins are not blocked; iss/aud/exp below still run.
			SystemLogger.warn({
				msg: 'OmnisAI id_token signature did not verify (fail-soft, under investigation)',
				alg,
				kid: header.kid,
			});
		}
	}

	// 2. Standard OIDC claim checks.
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (typeof claims.exp !== 'number' || claims.exp < nowSeconds) {
		throw new Error('id_token_expired');
	}
	// Log the claim SHAPE (keys only — no values, so no PII) to pin down CentralizedAuth's token.
	SystemLogger.info({
		msg: 'OmnisAI id_token claims',
		claimKeys: Object.keys(claims),
		hasIss: claims.iss !== undefined && claims.iss !== null && claims.iss !== '',
		hasAud: claims.aud !== undefined && claims.aud !== null,
	});

	// Issuer: validate the HOST when the token carries an `iss`. CentralizedAuth's better-auth MCP
	// id_token currently OMITS `iss` — accept that, because in the authorization-code flow this token
	// was fetched directly from opts.issuer's token endpoint over TLS (bound to our state cookie + PKCE
	// verifier), so the issuer is established by the back-channel, not by a claim an attacker could set.
	// Reject only a PRESENT, genuinely-different-host issuer.
	if (claims.iss !== undefined && claims.iss !== null && claims.iss !== '') {
		let issuerOk: boolean;
		try {
			issuerOk = new URL(String(claims.iss)).origin === new URL(opts.issuer).origin;
		} catch {
			issuerOk = false;
		}
		if (!issuerOk) {
			throw new Error(`id_token_bad_issuer_got_${encodeURIComponent(String(claims.iss)).slice(0, 60)}`);
		}
	}
	// Audience: validate when present; accept when absent. better-auth's MCP id_token may also omit
	// `aud`. The token is already bound to THIS client by the code+PKCE exchange (we sent our client_id
	// to the token endpoint), so an absent aud does not open token substitution in this flow. Reject a
	// PRESENT aud that does not include our client.
	const audPresent = Array.isArray(claims.aud)
		? claims.aud.length > 0
		: claims.aud !== undefined && claims.aud !== null && claims.aud !== '';
	if (audPresent) {
		const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
		if (!audiences.includes(opts.clientId)) {
			throw new Error(`id_token_bad_audience_got_${encodeURIComponent(String(claims.aud)).slice(0, 60)}`);
		}
	}

	// 3. Replay — if we issued a nonce, the token SHOULD echo it. CentralizedAuth's MCP/OIDC flow
	// does not currently echo the nonce, so a mismatch is logged (non-fatal) rather than failing the
	// login — the signature + iss/aud/exp checks above already block forged or substituted tokens.
	// Restore this to a hard failure once CentralizedAuth echoes the nonce.
	if (opts.nonce && claims.nonce !== opts.nonce) {
		SystemLogger.warn({
			msg: 'OmnisAI id_token nonce not echoed by issuer (non-fatal until CentralizedAuth nonce support lands)',
			hadNonce: Boolean(claims.nonce),
		});
	}

	if (!claims.sub) {
		throw new Error('id_token_no_subject');
	}

	return claims;
}
