/**
 * Cross-Firm (CFCS / "Omnis Counsel") API proxy — `/_crossfirm/*` → `${CFCS base}/*`.
 *
 * The cross-firm panel (client/views/cross-firm) talks to MatterChat's OWN origin at `/_crossfirm/...`.
 * This server route authenticates the MatterChat user (from the loginToken the client sends as
 * `Authorization: Bearer`), resolves their SERVER-VERIFIED OmnisAI subject (services.omnisai.id — which
 * Rocket.Chat never publishes to the browser), and forwards the request to the internal CFCS service
 * with that subject stamped onto an UNFORGEABLE trusted-caller header (x-cfcs-caller).
 *
 * WHY THIS EXISTS — it is the security boundary of the cross-firm trust layer:
 *  - CFCS is an internal, ClusterIP-only service: the browser cannot reach it directly.
 *  - CFCS (POC) trusts the acting attorney from the request body/query. If the browser called CFCS
 *    directly (as the pre-proxy client did, sending an X-Omnisai-Id header), ANY user could claim to be
 *    ANY attorney. This proxy is the choke point that replaces client-claimed identity with the
 *    server-verified subject; CFCS then binds every actor action to it (see server.js CALLER_FIELDS).
 *
 * SECURITY (mirrors the hardened /_litbox proxy — do not relax without re-review):
 *  - Auth via the Authorization header ONLY (never a cookie) → not CSRF-able cross-site.
 *  - Any inbound `x-cfcs-*` header is STRIPPED; the proxy sets x-cfcs-caller itself (a client can never
 *    forge the verified identity). x-cfcs-firm is set from the CrossFirm_Firm_Name setting.
 *  - The outbound URL is pinned to the configured CFCS origin and an EXPLICIT route allow-list (only the
 *    user-facing CFCS endpoints — never the bootstrap POST /firms|/attorneys or the test route). Traversal
 *    / protocol-relative / control chars are rejected BEFORE the URL is built; the trusted headers are
 *    attached ONLY after every gate passes (enabled + origin-pin + route allow-list + method) — fail closed.
 *  - Redirects are NOT followed (the identity must never leave the pinned origin).
 *  - The inbound Cookie/Origin and the MatterChat loginToken are never forwarded; the subject is never logged.
 *
 * CONFIG: the CFCS base URL is read from the CrossFirm_CFCS_URL setting (server-side) or the CFCS_API_URL
 * env; in staging that is the in-cluster `http://cfcs:9200`. Cross-firm must also be enabled
 * (CrossFirm_Enabled) — off → 503 (standalone principle: a fresh MatterChat is fully self-contained).
 */
import { Users } from '@rocket.chat/models';
import { serverFetch as fetch } from '@rocket.chat/server-fetch';
import { Accounts } from 'meteor/accounts-base';
import { RoutePolicy } from 'meteor/routepolicy';
import { WebApp } from 'meteor/webapp';

import { SystemLogger } from '../../../server/lib/logger/system';
import { settings } from '../../settings/server';

// CFCS base: server-side setting first (admin-configurable, hot), else env. The in-cluster service DNS
// (e.g. "cfcs" / "cfcs.staging.svc.cluster.local") may be http; any host with a public-looking domain
// must be https. Returns null (→ 503) when unset or invalid.
function getCfcsBase(): URL | null {
	const raw = String(settings.get('CrossFirm_CFCS_URL') || process.env.CFCS_API_URL || '')
		.trim()
		.replace(/\/+$/, '');
	if (!raw) {
		return null;
	}
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') {
			return null;
		}
		const internal =
			u.hostname === 'localhost' ||
			u.hostname === '127.0.0.1' ||
			!u.hostname.includes('.') || // bare in-cluster service name, e.g. "cfcs"
			u.hostname.endsWith('.cluster.local') ||
			u.hostname.endsWith('.svc');
		if (u.protocol !== 'https:' && !internal) {
			return null;
		}
		return u;
	} catch {
		return null;
	}
}

// The user-facing CFCS routes — explicit allow-list (closed by default). EXCLUDES the bootstrap
// POST /firms + POST /attorneys (seed-only) and the test tamper route. Mirrors server.js handlers.
const ALLOWED_ROUTES: Array<{ method: string; re: RegExp }> = [
	{ method: 'GET', re: /^\/health$/ },
	{ method: 'POST', re: /^\/whoami$/ },
	{ method: 'GET', re: /^\/directory$/ },
	{ method: 'GET', re: /^\/matter-rooms$/ },
	{ method: 'POST', re: /^\/matter-rooms$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/invite$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/accept$/ },
	{ method: 'GET', re: /^\/matter-rooms\/[^/]+\/messages$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/messages$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/messages\/[^/]+\/delete$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/hold$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/hold\/release$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/export$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/screen$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/unscreen$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/retention$/ },
	{ method: 'POST', re: /^\/matter-rooms\/[^/]+\/link$/ },
	{ method: 'POST', re: /^\/firms\/[^/]+\/conflicts$/ },
	{ method: 'GET', re: /^\/firms\/[^/]+\/conflicts$/ },
	{ method: 'GET', re: /^\/audit$/ },
	{ method: 'GET', re: /^\/audit\/verify$/ },
];

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'cookie', 'origin']);

function json(res: any, code: number, obj: unknown): void {
	res.writeHead(code, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(obj));
}

/** Resolve the MatterChat user from the raw login token; derive the verified OmnisAI subject. */
async function resolveCaller(rawToken: string): Promise<{ _id: string; subject: string } | null> {
	const hashedToken = Accounts._hashLoginToken(rawToken);
	const user = await Users.findOne(
		{ 'services.resume.loginTokens.hashedToken': hashedToken },
		{ projection: { _id: 1, 'services.omnisai.id': 1, 'services.resume.loginTokens.$': 1 } },
	);
	if (!user) {
		return null;
	}
	// M3: this proxy re-implements the token lookup, so it must also enforce EXPIRY (RC's normal resume
	// path does). The positional projection returns ONLY the matched token; reject if it is past expiry.
	const tokenEntry = (user as any)?.services?.resume?.loginTokens?.[0];
	const when = tokenEntry?.when ? new Date(tokenEntry.when).getTime() : 0;
	const expDays = Number(settings.get('Accounts_LoginExpiration')) || 90;
	if (!when || Date.now() > when + expDays * 24 * 60 * 60 * 1000) {
		return null;
	}
	// Cross-firm REQUIRES a verified OmnisAI identity (the durable CentralizedAuth subject == CFCS
	// caUserId). No omnisai id (e.g. a local-only admin) is NOT a cross-firm principal — reject rather
	// than fabricate a fallback. N2: charset-guard the value before it becomes a header.
	const omnisaiId = (user as any)?.services?.omnisai?.id;
	if (typeof omnisaiId !== 'string' || !omnisaiId || !/^[A-Za-z0-9:_.@-]+$/.test(omnisaiId)) {
		return null;
	}
	return { _id: user._id, subject: omnisaiId };
}

/** Validate the inbound path against the allow-list and build the pinned outbound URL (fail closed). */
function buildTargetUrl(base: URL, reqUrl: string, method: string): URL | null {
	const [pathPart, queryPart = ''] = reqUrl.split('?');
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathPart);
	} catch {
		return null;
	}
	// Reject traversal, backslashes, NULs, control chars, protocol-relative / double-slash.
	// eslint-disable-next-line no-control-regex
	if (/\.\.|\\|\0|[\x00-\x1f]/.test(decoded) || decoded.includes('//')) {
		return null;
	}
	if (!decoded.startsWith('/')) {
		return null;
	}
	if (!ALLOWED_ROUTES.some((r) => r.method === method && r.re.test(decoded))) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(`${base.origin}${decoded}${queryPart ? `?${queryPart}` : ''}`);
	} catch {
		return null;
	}
	if (url.origin !== base.origin) {
		return null;
	}
	// N1: re-assert the FINAL parsed pathname against the allow-list (defends against any %3F/%23 desync
	// between the path we validated and the path CFCS actually routes on).
	if (!ALLOWED_ROUTES.some((r) => r.method === method && r.re.test(url.pathname))) {
		return null;
	}
	return url;
}

function readBody(req: any): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

async function handle(req: any, res: any): Promise<void> {
	if (!settings.get('CrossFirm_Enabled')) {
		return json(res, 503, { success: false, error: 'crossfirm_not_enabled' });
	}
	const base = getCfcsBase();
	if (!base) {
		return json(res, 503, { success: false, error: 'crossfirm_not_configured' });
	}

	// 1. Auth: Authorization header ONLY (no cookie — CSRF defence).
	const authHeader = String(req.headers['authorization'] || '');
	if (!authHeader.startsWith('Bearer ')) {
		return json(res, 401, { success: false, error: 'unauthorized' });
	}
	const rawToken = authHeader.slice(7).trim();
	if (!rawToken) {
		return json(res, 401, { success: false, error: 'unauthorized' });
	}
	const caller = await resolveCaller(rawToken);
	if (!caller) {
		return json(res, 401, { success: false, error: 'unauthorized' });
	}

	// 2. Method + route allow-list (validate BEFORE attaching identity).
	const method = String(req.method || 'GET').toUpperCase();
	if (method !== 'GET' && method !== 'POST') {
		return json(res, 405, { success: false, error: 'method_not_allowed' });
	}
	const target = buildTargetUrl(base, String(req.url || ''), method);
	if (!target) {
		return json(res, 400, { success: false, error: 'bad_request' });
	}

	// 3. Forward — verified identity stamped ONLY now that enabled/origin/route/method all passed.
	try {
		const outHeaders: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers)) {
			const key = k.toLowerCase();
			// Strip hop-by-hop, inbound auth, content-length (re-derived), accept-encoding (we buffer),
			// and CRUCIALLY any inbound x-cfcs-* (the client must never supply the trusted identity).
			if (
				HOP_BY_HOP.has(key) ||
				key === 'authorization' ||
				key === 'content-length' ||
				key === 'accept-encoding' ||
				key.startsWith('x-cfcs-')
			) {
				continue;
			}
			if (typeof v === 'string') {
				outHeaders[key] = v;
			}
		}
		// The unforgeable trusted-caller identity (CFCS binds every actor action to this).
		outHeaders['x-cfcs-caller'] = caller.subject;
		// M2: ALWAYS stamp the firm from the verified server setting (even when empty) so the browser
		// body can never assert it; CFCS rejects an empty firm in strict mode (fail closed).
		outHeaders['x-cfcs-firm'] = String(settings.get('CrossFirm_Firm_Name') || '').trim();
		outHeaders['content-type'] = outHeaders['content-type'] || 'application/json';

		const body = method === 'POST' ? await readBody(req) : undefined;

		const upstream = await fetch(target.toString(), {
			ignoreSsrfValidation: true, // origin is pinned to the configured internal CFCS host above
			followRedirects: false,
			method,
			headers: outHeaders,
			...(body && body.length ? { body } : {}),
			redirect: 'manual', // never follow a redirect carrying the identity off-origin
		} as any);

		const passHeaders: Record<string, string> = {};
		for (const h of ['content-type', 'cache-control']) {
			const val = upstream.headers.get(h);
			if (val) {
				passHeaders[h] = val;
			}
		}
		res.writeHead(upstream.status, passHeaders);
		const buf = Buffer.from(await upstream.arrayBuffer());
		res.end(buf);
	} catch (err) {
		SystemLogger.error({ msg: 'Cross-firm proxy forward error', err });
		json(res, 502, { success: false, error: 'bad_gateway' });
	}
}

// Mounted OUTSIDE /api (mirrors /_litbox + /_omnisai) — RC's own /api/* router owns that namespace.
RoutePolicy.declare('/_crossfirm/', 'network');

// String mount: connect strips '/_crossfirm', so req.url here is '/<cfcs-path>'.
WebApp.connectHandlers.use('/_crossfirm', async (req: any, res: any, next: () => void) => {
	try {
		await handle(req, res);
	} catch (err) {
		SystemLogger.error({ msg: 'Cross-firm proxy route error', err });
		try {
			json(res, 500, { success: false, error: 'proxy_error' });
		} catch {
			next();
		}
	}
});
