/**
 * LitBox API proxy — `/api/litbox/v1/*` → `${LITBOX_API_URL}/api/v1/*`.
 *
 * The embedded LitBox file browser (client/views/litbox) is configured with
 * `apiBaseUrl: '/api/litbox/v1'`, so every LitBox call goes to MatterChat's OWN origin.
 * This server route authenticates the MatterChat user (from the loginToken the component
 * sends as `Authorization: Bearer`), then forwards the request to the real LitBox backend
 * with the user's LitBox credential injected server-side. Two wins: (a) no cross-origin
 * call from the browser, so no LitBox CORS allow-list change is needed; (b) the LitBox
 * credential never reaches the client.
 *
 * SECURITY (hardened per the auth-chain red-team — do not relax without re-review):
 *  - Auth via the Authorization header ONLY (never a cookie) → not CSRF-able cross-site.
 *  - Outbound URL is pinned to the configured LitBox origin and an allow-list of v1
 *    resource prefixes; path-traversal / protocol-relative / control chars are rejected
 *    BEFORE the URL is built. The injected Bearer is attached ONLY after every gate passes
 *    (origin-pin + path allow-list + method allow-list) — fail closed.
 *  - Redirects are NOT followed (the credential must never leave the pinned origin).
 *  - The inbound Cookie/Origin and the MatterChat loginToken are never forwarded; the
 *    Authorization value is never logged.
 *
 * REFRESH-ON-401: the LitBox bearer is a CentralizedAuth OIDC access token that expires. When
 * LitBox returns 401, the proxy transparently refreshes the token once (grant_type=refresh_token
 * against the CentralizedAuth issuer, using the refresh_token persisted at login), rotates the
 * stored credential, and replays the request once. Failure → the original 401 is passed through
 * (graceful degradation). This path needs real-env verification: the refresh grant only resolves
 * against a live CentralizedAuth issuer, not the local mock OIDC (see KNOWN LIMITATION below).
 *
 * KNOWN LIMITATION: in local dev MatterChat logs in via a MOCK OIDC, whose tokens the real
 * staging LitBox/CentralizedAuth will reject — so files only load against a real deploy
 * (alpha). Set LITBOX_API_URL to enable the proxy; unset → 503 not_configured.
 */
import { Users } from '@rocket.chat/models';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';
import { Accounts } from 'meteor/accounts-base';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { encryptToken, decryptToken, getKeyStatus, isEncryptedValue } from './litboxCrypto';
import { SystemLogger } from '../../../server/lib/logger/system';
import { settings } from '../../settings/server';

// Parsed once at boot. Must be an absolute https URL; the proxy pins outbound calls to this origin.
function getLitboxBase(): URL | null {
	const raw = (process.env.LITBOX_API_URL || '').trim().replace(/\/+$/, '');
	if (!raw) {
		return null;
	}
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
			return null;
		}
		return u;
	} catch {
		return null;
	}
}

// CentralizedAuth OIDC token endpoint, used for the refresh-on-401 grant below. Resolves the
// issuer/client_id settings-FIRST with env fallback — EXACTLY the getConfig() order in ./index.ts,
// so the proxy's refresh grant and the login flow can never disagree. Why settings-first matters:
// staging seeds OmnisAI_OIDC_* via OVERWRITE_SETTING_* into Mongo while the pod env may not carry
// the OMNISAI_OIDC_* vars at all (see the getConfig comment) — the previous env-only read left
// refresh-on-401 dead there, so files silently stopped loading once the login token expired.
// Endpoint path follows better-auth's mcp plugin layout: `${issuer}/api/auth/mcp/token`.
// Returns null if not configured.
// NOTE: not runtime-verified here — the refresh grant only resolves against a real
// CentralizedAuth issuer (live/alpha), not the local mock OIDC. See header KNOWN LIMITATION.
function getOidcTokenEndpoint(): { url: string; clientId: string } | null {
	const settingStr = (id: string): string => {
		const v = settings.get(id);
		return typeof v === 'string' ? v.trim() : '';
	};
	const issuer = (settingStr('OmnisAI_OIDC_Issuer') || (process.env.OMNISAI_OIDC_ISSUER || '').trim()).replace(/\/+$/, '');
	const clientId = settingStr('OmnisAI_OIDC_Client_Id') || (process.env.OMNISAI_OIDC_CLIENT_ID || '').trim();
	if (!issuer || !clientId) {
		return null;
	}
	try {
		// Validate the issuer is an absolute http(s) URL so the refresh POST is pinned to a real
		// origin (defence in depth — the refresh call goes to the issuer origin ONLY).
		const u = new URL(issuer);
		if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
			return null;
		}
	} catch {
		return null;
	}
	return { url: `${issuer}/api/auth/mcp/token`, clientId };
}

// The v1 resource prefixes the embedded file browser actually calls. An opaque any-path
// relay is NOT required; anything outside this set is rejected (open-relay defense).
const ALLOWED_PREFIXES = [
	'files',
	'folders',
	'shares',
	'tags',
	'tasks',
	'comments',
	'search',
	'trash',
	'workspaces',
	'organizations',
	'users',
	'auth',
	'classification-categories',
	'file-app-links',
	'audit-logs',
];

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'cookie', 'origin']);

function unauthorized(res: any): void {
	res.writeHead(401, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ success: false, error: 'unauthorized' }));
}

function badRequest(res: any): void {
	res.writeHead(400, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ success: false, error: 'bad_request' }));
}

/**
 * Lazy migration: records written before LITBOX_TOKEN_ENC_KEY was configured hold PLAINTEXT
 * tokens. When a key is configured and a plaintext value is read, opportunistically re-write it
 * encrypted — no big-bang migration script needed. Each update is guarded on the current
 * plaintext value so a concurrent refresh-on-401 rotation is never clobbered by a stale write,
 * and it is fire-and-forget so the request path takes no extra latency and a failed migration
 * never breaks the proxy. Token values are NEVER logged (only userId + field name).
 */
function migrateLegacyPlaintextTokens(userId: string, stored: { sessionToken?: string; refreshToken?: string }): void {
	if (getKeyStatus() !== 'configured') {
		return;
	}
	for (const field of ['sessionToken', 'refreshToken'] as const) {
		const value = stored[field];
		if (!value || isEncryptedValue(value)) {
			continue;
		}
		void Users.updateOne({ _id: userId, [`omnisaiLitbox.${field}`]: value }, { $set: { [`omnisaiLitbox.${field}`]: encryptToken(value) } })
			.then((r) => {
				if (r.modifiedCount) {
					SystemLogger.info({ msg: 'LitBox credential lazily encrypted at rest', userId, field });
				}
			})
			.catch((err) => SystemLogger.error({ msg: 'LitBox credential lazy encryption failed', userId, field, err }));
	}
}

/** Resolve the MatterChat user from the raw resume/login token (bearer), standard hashed lookup. */
async function resolveUser(rawToken: string): Promise<{ _id: string; litbox?: any } | null> {
	const hashedToken = Accounts._hashLoginToken(rawToken);
	const user = await Users.findOne(
		{ 'services.resume.loginTokens.hashedToken': hashedToken },
		{ projection: { _id: 1, omnisaiLitbox: 1, 'services.resume.loginTokens.$': 1 } },
	);
	if (!user) {
		return null;
	}
	// M3 (ported from crossFirmProxy): this proxy re-implements the token lookup, so it must also
	// enforce EXPIRY (RC's normal resume path does). The positional projection returns ONLY the
	// matched token; reject if it is past expiry.
	const tokenEntry = (user as any)?.services?.resume?.loginTokens?.[0];
	const when = tokenEntry?.when ? new Date(tokenEntry.when).getTime() : 0;
	const expDays = Number(settings.get('Accounts_LoginExpiration')) || 90;
	if (!when || Date.now() > when + expDays * 24 * 60 * 60 * 1000) {
		return null;
	}
	// Decrypt the stored credential (no-op for legacy plaintext; see litboxCrypto), and
	// opportunistically re-encrypt legacy plaintext at rest (see migrateLegacyPlaintextTokens).
	const stored = (user as any).omnisaiLitbox;
	if (stored) {
		migrateLegacyPlaintextTokens(user._id, stored);
	}
	const litbox = stored
		? { ...stored, sessionToken: decryptToken(stored.sessionToken), refreshToken: decryptToken(stored.refreshToken) }
		: undefined;
	return { _id: user._id, litbox };
}

/**
 * Refresh-on-401: exchange the stored OIDC refresh_token for a fresh access_token at the
 * CentralizedAuth token endpoint, persist the rotated credential onto the user doc, and return
 * the new access token (or null on any failure → caller degrades gracefully).
 *
 * Mirrors the authorization_code exchange in ./index.ts: form-encoded POST to
 * `${OMNISAI_OIDC_ISSUER}/api/auth/mcp/token` with client_id; here grant_type=refresh_token.
 * The refresh call hits the issuer origin ONLY (validated in getOidcTokenEndpoint). On success
 * the rotated refresh_token + new expiresAt are also persisted so the next expiry can refresh
 * again. SECURITY: token values are NEVER logged (only counts/status), matching this file's
 * existing discipline.
 *
 * NOTE: needs real-env verification — the refresh grant only resolves against a live
 * CentralizedAuth issuer, not the local mock OIDC.
 */
async function refreshLitboxToken(userId: string, refreshToken: string): Promise<string | null> {
	const endpoint = getOidcTokenEndpoint();
	if (!endpoint || !refreshToken) {
		return null;
	}
	try {
		const tokenRes = await fetch(endpoint.url, {
			ignoreSsrfValidation: true,
			followRedirects: false, // issuer is admin-configured; followRedirects:false so a redirect can't carry the refresh_token off-origin
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: endpoint.clientId,
			}).toString(),
			redirect: 'manual', // never follow a redirect carrying the credential off-origin
		} as any);
		if (!tokenRes.ok) {
			SystemLogger.warn({ msg: 'LitBox token refresh rejected', status: tokenRes.status });
			return null;
		}
		const tokens = await tokenRes.json();
		const accessToken: string | undefined = tokens?.access_token;
		if (!accessToken) {
			SystemLogger.warn({ msg: 'LitBox token refresh: no access_token in response' });
			return null;
		}
		// Persist the rotated credential (top-level omnisaiLitbox, same fields loginHandler sets).
		// Keep the existing refresh_token if the server did not rotate one (omit → no overwrite).
		await Users.updateOne(
			{ _id: userId },
			{
				$set: {
					'omnisaiLitbox.sessionToken': encryptToken(accessToken),
					...(tokens.refresh_token ? { 'omnisaiLitbox.refreshToken': encryptToken(tokens.refresh_token) } : {}),
					...(tokens.expires_in ? { 'omnisaiLitbox.expiresAt': Date.now() + tokens.expires_in * 1000 } : {}),
				},
			},
		);
		return accessToken;
	} catch (err) {
		SystemLogger.error({ msg: 'LitBox token refresh error', err });
		return null;
	}
}

/** Read the raw request body as a Buffer (LitBox traffic can be binary uploads). */
function readBody(req: any): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

/**
 * Build the validated outbound LitBox URL from the incoming `/v1/<rest>` path.
 * Returns null on any traversal / origin / prefix / scheme violation (fail closed).
 */
function buildTargetUrl(base: URL, reqUrl: string): URL | null {
	// connect strips the '/api/litbox' mount, so reqUrl starts with '/v1/...'
	const [pathPart, queryPart = ''] = reqUrl.split('?');
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathPart);
	} catch {
		return null;
	}
	// Reject traversal, backslashes, NULs, control chars, protocol-relative.
	if (/\.\.|\\|\0|[ -]/.test(decoded) || decoded.includes('//')) {
		return null;
	}
	const m = decoded.match(/^\/v1\/([a-zA-Z0-9._\-/]+)$/);
	if (!m) {
		return null;
	}
	const rest = m[1];
	const firstSeg = rest.split('/')[0];
	if (!ALLOWED_PREFIXES.includes(firstSeg)) {
		return null;
	}
	// Anchor to a fixed base, then assert origin + pathname (defence in depth).
	let url: URL;
	try {
		url = new URL(`${base.origin}/api/v1/${rest}${queryPart ? `?${queryPart}` : ''}`);
	} catch {
		return null;
	}
	if (url.origin !== base.origin || !url.pathname.startsWith('/api/v1/')) {
		return null;
	}
	return url;
}

async function handle(req: any, res: any): Promise<void> {
	const base = getLitboxBase();
	if (!base) {
		res.writeHead(503, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ success: false, error: 'litbox_not_configured' }));
		return;
	}

	// 1. Auth: Authorization header ONLY (no cookie — CSRF defence).
	const authHeader = String(req.headers.authorization || '');
	if (!authHeader.startsWith('Bearer ')) {
		return unauthorized(res);
	}
	const rawToken = authHeader.slice(7).trim();
	if (!rawToken) {
		return unauthorized(res);
	}
	const user = await resolveUser(rawToken);
	if (!user) {
		return unauthorized(res);
	}

	// 2. The user's LitBox credential (captured at OIDC login). No credential = a regular
	//    username/password login that never went through "Sign in with OmnisAI" — a DIFFERENT
	//    401 from a bad MatterChat token, so say which: `litbox_not_connected` lets the Files
	//    surface render a "Connect your OmnisAI account" CTA instead of a silent empty list.
	//    (Still a 401, still reached only after the Authorization-header auth above — the error
	//    string leaks nothing.) If LitBox later 401s because the token expired, we
	//    refresh-on-401 below (step 4) using the stored refresh_token.
	const litboxToken: string | undefined = user.litbox?.sessionToken;
	if (!litboxToken) {
		res.writeHead(401, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ success: false, error: 'litbox_not_connected' }));
		return;
	}
	const refreshToken: string | undefined = user.litbox?.refreshToken;

	// 3. Method + path gates (build BEFORE attaching the credential).
	const method = String(req.method || 'GET').toUpperCase();
	if (!ALLOWED_METHODS.has(method)) {
		res.writeHead(405, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ success: false, error: 'method_not_allowed' }));
		return;
	}
	const target = buildTargetUrl(base, String(req.url || ''));
	if (!target) {
		return badRequest(res);
	}

	// 4. Forward — credential attached only now that origin/path/method all passed.
	try {
		// Base headers (everything except the bearer, which is supplied per-attempt so the
		// retry can swap in a refreshed token without rebuilding the rest).
		const baseHeaders: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers)) {
			const key = k.toLowerCase();
			// Strip accept-encoding: this proxy buffers the full upstream body and does
			// NOT forward content-encoding, so we must ask LitBox for an identity-encoded
			// response — otherwise the browser receives gzip/br bytes labelled as plain
			// and fails to decode them (blank/broken Files screen).
			if (HOP_BY_HOP.has(key) || key === 'authorization' || key === 'content-length' || key === 'accept-encoding') {
				continue;
			}
			if (typeof v === 'string') {
				baseHeaders[key] = v;
			}
		}
		const hasBody = method !== 'GET' && method !== 'HEAD';
		// Read the body ONCE up front so it can be replayed on the single retry below.
		const body = hasBody ? await readBody(req) : undefined;

		const forward = (bearer: string): Promise<any> =>
			fetch(target.toString(), {
				ignoreSsrfValidation: true,
				followRedirects: false, // origin pinned; followRedirects:false so serverFetch can't chase a redirect re-sending the credential
				method,
				headers: { ...baseHeaders, authorization: `Bearer ${bearer}` },
				...(body?.length ? { body } : {}),
				redirect: 'manual', // never follow a redirect carrying the credential off-origin
			} as any);

		let upstream = await forward(litboxToken);

		// Refresh-on-401: if LitBox rejects the (likely expired) token and we have a refresh
		// token, refresh ONCE and replay the request ONCE with the new bearer. If the refresh
		// fails or the replay still 401s, fall through and pass the response as-is (graceful
		// degradation — the browser shows LitBox's unauth/empty state, same as before).
		// Hard cap at a single retry — never loop.
		if (upstream.status === 401 && refreshToken) {
			const newToken = await refreshLitboxToken(user._id, refreshToken);
			if (newToken) {
				upstream = await forward(newToken);
			}
		}

		const outStatus = upstream.status;
		const passHeaders: Record<string, string> = {};
		for (const h of ['content-type', 'content-disposition', 'cache-control', 'etag']) {
			const val = upstream.headers.get(h);
			if (val) {
				passHeaders[h] = val;
			}
		}
		res.writeHead(outStatus, passHeaders);
		const buf = Buffer.from(await upstream.arrayBuffer());
		res.end(buf);
	} catch (err) {
		SystemLogger.error({ msg: 'LitBox proxy forward error', err });
		res.writeHead(502, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ success: false, error: 'bad_gateway' }));
	}
}

// Boot-time key visibility (ops): the credential store is only encrypted at rest once
// LITBOX_TOKEN_ENC_KEY is set — be LOUD when it isn't, so a deploy without the secret is
// caught in the logs instead of silently persisting plaintext.
{
	const keyStatus = getKeyStatus();
	if (keyStatus === 'unset') {
		SystemLogger.warn({
			msg: 'LITBOX_TOKEN_ENC_KEY is not set — LitBox credentials are stored in PLAINTEXT at rest. Set LITBOX_TOKEN_ENC_KEY (base64-encoded 32 bytes) on this deployment to enable encryption; existing plaintext credentials then migrate lazily on next use.',
		});
	} else if (keyStatus === 'invalid') {
		SystemLogger.error({
			msg: 'LITBOX_TOKEN_ENC_KEY is set but INVALID (must be base64-encoded 32 bytes) — encryption is DISABLED: new LitBox credentials will be stored in PLAINTEXT and previously encrypted ones will fail to decrypt (users must re-link) until the key is fixed.',
		});
	}
}

// Mounted OUTSIDE /api (mirrors /_omnisai) — Rocket.Chat's own /api/* router owns that
// namespace and 404s unknown /api paths before this middleware runs.
RoutePolicy.declare('/_litbox/', 'network');

// String mount: connect strips '/_litbox', so req.url here is '/v1/<rest>'.
WebApp.connectHandlers.use('/_litbox', async (req: any, res: any, next: () => void) => {
	try {
		await handle(req, res);
	} catch (err) {
		SystemLogger.error({ msg: 'LitBox proxy route error', err });
		try {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ success: false, error: 'proxy_error' }));
		} catch {
			next();
		}
	}
});
