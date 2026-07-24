/**
 * Chi session exchange — CentralizedAuth → MatterChat auth bridge (verification core).
 *
 * A standalone Chi client (Chi-Desktop) signs the member in against CentralizedAuth
 * (OAuth2 authorization-code + PKCE) and presents the resulting access/ID token to
 * POST /v1/chi.session-exchange, which trades it for a real MatterChat login token.
 *
 * VERIFICATION IS HARD — deliberately stricter than the existing omnisai-oauth
 * `verifyIdToken.ts`, whose fail-soft posture (warn-and-continue on a bad signature,
 * accept-when-absent iss/aud) was acceptable ONLY because that token arrives over the
 * server's own back-channel TLS call to the issuer's token endpoint, bound to our state
 * cookie + PKCE verifier. Here the token arrives from an UNAUTHENTICATED public client
 * in an Authorization header — it IS attacker-suppliable, so nothing may be taken on
 * trust. Two lanes, both fail-closed:
 *
 *   1. JWS lane — the token is a JWT signed with an asymmetric alg (EdDSA / RS256 /
 *      ES256): verify the signature against the issuer's JWKS (`${issuer}/api/auth/jwks`,
 *      hard-fail on mismatch), then hard-check exp, iss (must be present AND match the
 *      configured issuer origin) and aud (when present, must be in the admin-configured
 *      client-id allowlist — this blocks a token minted for some OTHER OmnisAI product
 *      from being replayed here to mint a MatterChat session).
 *   2. Introspection lane — the token is opaque or HMAC-signed (better-auth's default
 *      access/id tokens are HS256 over the ISSUER's app secret, which we don't hold and
 *      must never hold): ask the issuer itself via `${issuer}/api/auth/mcp/get-session`
 *      with the presented Bearer token over TLS. A 200 + a user id from the issuer is a
 *      hard, real-time proof the token is live; anything else is a rejection.
 *
 * A signature that VERIFIES but yields bad claims (expired / wrong iss / wrong aud) is a
 * terminal rejection — it never falls through to introspection (a cryptographically valid
 * token with wrong claims is a wrong token, not an unverifiable one).
 *
 * This module is Meteor-free on purpose (node:crypto + injected fetch only) so the claim
 * validation, identity extraction and token-lifetime math are unit-testable — see
 * tests/unit/server/lib/chi/sessionExchange.spec.ts. The Meteor-side wiring (settings,
 * Users, Accounts token mint, audit) lives in app/api/server/v1/chi.ts.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export type ExchangeJwtHeader = { alg?: string; kid?: string; typ?: string };

export type ExchangeClaims = {
	'iss'?: unknown;
	'sub'?: unknown;
	'aud'?: unknown;
	'exp'?: unknown;
	'iat'?: unknown;
	'email'?: unknown;
	'name'?: unknown;
	'preferred_username'?: unknown;
	'casepro:org_id'?: unknown;
	'casepro:role'?: unknown;
	[claim: string]: unknown;
};

/** The issuer-verified identity the bridge maps onto a MatterChat account. `sub` is the
 * CentralizedAuth user UUID (== CasePro users.id) — the same subject `loginHandler.ts`
 * persists as `services.omnisai.id`. */
export type VerifiedIdentity = {
	sub: string;
	email?: string;
	name?: string;
	username?: string;
	orgId?: string;
	role?: string;
};

export type Jwk = {
	kty: string;
	kid?: string;
	alg?: string;
	crv?: string;
	x?: string; // OKP (Ed25519)
	y?: string; // EC
	n?: string; // RSA
	e?: string; // RSA
};

/** Signature algorithms the JWS lane will verify. HS* is EXCLUDED by design: verifying an
 * HMAC requires the issuer's shared secret, and a workspace holding that secret could mint
 * arbitrary identities — the bridge must only ever hold PUBLIC key material. `none` is
 * rejected before this list is ever consulted. */
const VERIFIABLE_ALGS = new Set(['EdDSA', 'Ed25519', 'RS256', 'ES256']);

export type ParsedJwt = {
	header: ExchangeJwtHeader;
	claims: ExchangeClaims;
	signingInput: string;
	signature: Buffer;
};

/** Decode a compact JWS. Returns undefined when the input is not JWT-shaped at all (an
 * opaque session token — the introspection lane's job). Throws on a malformed JWT. */
export function parseJwt(token: string): ParsedJwt | undefined {
	const parts = token.split('.');
	if (parts.length !== 3) {
		return undefined;
	}
	const [headerB64, payloadB64, signatureB64] = parts;
	let header: ExchangeJwtHeader;
	let claims: ExchangeClaims;
	try {
		header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as ExchangeJwtHeader;
		claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as ExchangeClaims;
	} catch {
		throw new Error('exchange_token_malformed');
	}
	if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') {
		throw new Error('exchange_token_malformed');
	}
	return { header, claims, signingInput: `${headerB64}.${payloadB64}`, signature: Buffer.from(signatureB64, 'base64url') };
}

/** Is this a JWS the bridge can verify locally? (asymmetric alg with issuer-published
 * public keys). HS256/HS384/HS512 and a missing alg → false (introspection lane). An
 * explicit `alg: "none"` is a forgery attempt and throws. */
export function isLocallyVerifiableAlg(alg: string | undefined): boolean {
	if (alg === 'none') {
		throw new Error('exchange_token_alg_none_rejected');
	}
	return typeof alg === 'string' && VERIFIABLE_ALGS.has(alg);
}

/** Pick the JWKS key for a token: kid match wins; a single published key may serve a
 * kid-less token; anything else is a miss. */
export function pickJwk(keys: Jwk[], kid: string | undefined): Jwk | undefined {
	if (kid) {
		return keys.find((k) => k.kid === kid);
	}
	return keys.length === 1 ? keys[0] : undefined;
}

function publicKeyFromJwk(jwk: Jwk) {
	if (jwk.kty === 'OKP') {
		return createPublicKey({ key: { kty: 'OKP', crv: jwk.crv, x: jwk.x }, format: 'jwk' });
	}
	if (jwk.kty === 'EC') {
		return createPublicKey({ key: { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
	}
	return createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
}

/** Verify a JWS signature against one JWK. Hard boolean — the caller throws on false. */
export function verifyJwsSignature(jwk: Jwk, alg: string, signingInput: string, signature: Buffer): boolean {
	try {
		const key = publicKeyFromJwk(jwk);
		if (jwk.kty === 'OKP') {
			// Ed25519 verifies with a null digest (no external prehash).
			return cryptoVerify(null, Buffer.from(signingInput), key, signature);
		}
		if (jwk.kty === 'EC' || alg === 'ES256') {
			return cryptoVerify('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' }, signature);
		}
		return cryptoVerify('sha256', Buffer.from(signingInput), key, signature);
	} catch {
		return false;
	}
}

export type ClaimCheckOptions = {
	/** Configured issuer base URL (origin comparison). */
	issuer: string;
	/** Admin-configured OAuth client ids allowed to exchange here (empty = none configured). */
	allowedClientIds: string[];
	/** Seconds since epoch "now" — injected for tests. */
	nowSeconds: number;
};

/**
 * Hard claim validation for a signature-verified JWT. Every check throws on failure:
 *  - `sub` required (the identity — nothing to map without it);
 *  - `exp` required, numeric, in the future (no unexpiring tokens accepted here);
 *  - `iss` REQUIRED and must match the configured issuer origin — unlike verifyIdToken's
 *    accept-when-absent, because this token was not fetched over our own back-channel;
 *  - `aud`, when present, must intersect the configured client-id allowlist. When aud is
 *    present but NO allowlist is configured we reject (fail-closed): accepting an audience
 *    we cannot recognize would let tokens minted for other apps be replayed here.
 *    An absent aud is tolerated (better-auth omits it) because the signature already pins
 *    the issuer and the sub pins the member; the allowlist is the extra cross-app guard.
 */
export function validateExchangeClaims(claims: ExchangeClaims, opts: ClaimCheckOptions): VerifiedIdentity {
	const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
	if (!sub) {
		throw new Error('exchange_token_no_subject');
	}

	if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
		throw new Error('exchange_token_no_exp');
	}
	if (claims.exp <= opts.nowSeconds) {
		throw new Error('exchange_token_expired');
	}

	const iss = typeof claims.iss === 'string' ? claims.iss : '';
	if (!iss) {
		throw new Error('exchange_token_no_issuer');
	}
	let issuerOk = false;
	try {
		issuerOk = new URL(iss).origin === new URL(opts.issuer).origin;
	} catch {
		issuerOk = false;
	}
	if (!issuerOk) {
		throw new Error('exchange_token_bad_issuer');
	}

	const audiences = Array.isArray(claims.aud) ? claims.aud.filter((a): a is string => typeof a === 'string') : typeof claims.aud === 'string' && claims.aud ? [claims.aud] : [];
	if (audiences.length) {
		if (!opts.allowedClientIds.length) {
			throw new Error('exchange_token_aud_unconfigured');
		}
		if (!audiences.some((a) => opts.allowedClientIds.includes(a))) {
			throw new Error('exchange_token_bad_audience');
		}
	}

	return identityFromClaims(sub, claims);
}

function optionalString(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function identityFromClaims(sub: string, claims: ExchangeClaims): VerifiedIdentity {
	return {
		sub,
		email: optionalString(claims.email),
		name: optionalString(claims.name),
		username: optionalString(claims.preferred_username),
		orgId: optionalString(claims['casepro:org_id']),
		role: optionalString(claims['casepro:role']),
	};
}

/**
 * Identity extraction for the INTROSPECTION lane: the issuer's `get-session` answered 200
 * for the presented Bearer token; pull the user out of whichever envelope shape better-auth
 * used ({userId}, {session:{userId}}, {user:{id,email,name}}, or a flat session record).
 * Returns undefined when no user id can be found — the caller rejects.
 */
export function identityFromIssuerSession(body: unknown): VerifiedIdentity | undefined {
	if (!body || typeof body !== 'object') {
		return undefined;
	}
	const root = body as Record<string, unknown>;
	const session = (root.session && typeof root.session === 'object' ? root.session : root) as Record<string, unknown>;
	const user = (root.user && typeof root.user === 'object' ? root.user : session.user && typeof session.user === 'object' ? session.user : undefined) as
		| Record<string, unknown>
		| undefined;

	const sub = optionalString(user?.id) ?? optionalString(session.userId) ?? optionalString(root.userId) ?? optionalString(session.sub) ?? optionalString(root.sub);
	if (!sub) {
		return undefined;
	}
	return {
		sub,
		email: optionalString(user?.email) ?? optionalString(session.email),
		name: optionalString(user?.name) ?? optionalString(session.name),
		username: optionalString(user?.username) ?? optionalString(session.username),
	};
}

/** Sessions minted by the bridge target this lifetime. */
export const EXCHANGE_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

/**
 * Meteor expires a resume token `loginExpiration` after its `when` stamp, and the
 * workspace's configured lifetime (default 90 days) is longer than the ~30 days a
 * bridge-minted session should live. Rather than fork the expiry mechanism, backdate
 * `when` so the standard sweep retires the token ~30 days from now:
 *   when = now - max(0, workspaceLifetime - 30d)
 * A workspace lifetime SHORTER than 30 days wins (no forward-dating — a bridge token must
 * never outlive a normal login). Pure math, unit-tested.
 */
export function loginTokenWhenForExpiry(nowMs: number, workspaceLifetimeMs: number, targetLifetimeMs = EXCHANGE_TOKEN_LIFETIME_MS): Date {
	const backdate = Math.max(0, workspaceLifetimeMs - targetLifetimeMs);
	return new Date(nowMs - backdate);
}

/** Parse the admin's comma/space-separated client-id allowlist setting. */
export function parseAllowedClientIds(raw: string): string[] {
	return String(raw || '')
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}
