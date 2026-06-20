#!/usr/bin/env node
/*
 * Mock CentralizedAuth OIDC server for verifying MatterChat's "Sign in with OmnisAI"
 * PKCE keystone locally (the real auth-app.stg-omnisai.io is unreachable from this box).
 *
 * Mirrors the better-auth `mcp` OAuth2.1 surface MatterChat will hit:
 *   GET  /.well-known/oauth-authorization-server   discovery
 *   GET  /api/auth/jwks                             (stub)
 *   POST /api/auth/mcp/register                     dynamic client registration (public client)
 *   GET  /api/auth/mcp/authorize                    auto-approves a logged-in+consented user, redirects back with ?code
 *   POST /api/auth/mcp/token                        verifies PKCE S256, returns access_token + id_token
 *   GET  /api/auth/mcp/get-session                  userinfo (Bearer access_token) -> sub + casepro claims
 *
 * The `sub` returned IS the CentralizedAuth UUID == CasePro users.id (the value MatterChat
 * must persist as services.omnisai.id). Run: node mc-mock-oidc.js  (PORT defaults to 9100)
 */
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.MOCK_OIDC_PORT || 9100);
const ISSUER = process.env.MOCK_OIDC_ISSUER || `http://127.0.0.1:${PORT}`;

// The simulated logged-in OmnisAI user. `sub` is a CentralizedAuth UUID (== CasePro users.id).
const MOCK_USER = {
	sub: process.env.MOCK_SUB || '11111111-1111-4111-8111-111111111111',
	email: process.env.MOCK_EMAIL || 'paralegal@omnisai.io',
	name: process.env.MOCK_NAME || 'Pat Paralegal',
	preferred_username: process.env.MOCK_USERNAME || 'pat.paralegal',
	'casepro:org_id': process.env.MOCK_ORG_ID || 'org-22222222-2222-4222-8222-222222222222',
	'casepro:role': process.env.MOCK_ROLE || 'paralegal',
	'casepro:is_global_admin': false,
};

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const authCodes = new Map(); // code -> { code_challenge, redirect_uri, client_id, scope }
const accessTokens = new Map(); // access_token -> sub
const clients = new Map(); // client_id -> { redirect_uris }

// --- provisioning (CentralizedAuth /organizations/invite-multiple) + downstream CasePro sync ---
const invites = []; // { id, email, organizationId, roleId, status, token }
const syncedUsers = []; // what the (mock) CasePro webhook receiver recorded
const CRM_WEBHOOK_URL = process.env.MOCK_CRM_WEBHOOK_URL || `${ISSUER}/crm/users/webhook/sync`;
// Stable per-email pseudo-UUID so the CentralizedAuth user id (== CasePro users.id) is deterministic.
const uuidForEmail = (email) => {
	const h = crypto.createHash('sha256').update(email).digest('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function send(res, status, obj, headers = {}) {
	const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
	res.writeHead(status, { 'Content-Type': typeof obj === 'string' ? 'text/plain' : 'application/json', ...headers });
	res.end(body);
}

function readBody(req) {
	return new Promise((resolve) => {
		let data = '';
		req.on('data', (c) => (data += c));
		req.on('end', () => resolve(data));
	});
}

function parseBody(raw, contentType = '') {
	if (contentType.includes('application/json')) {
		try { return JSON.parse(raw || '{}'); } catch { return {}; }
	}
	return Object.fromEntries(new URLSearchParams(raw));
}

function makeIdToken(aud) {
	const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const now = Math.floor(Date.now() / 1000);
	const payload = b64url(Buffer.from(JSON.stringify({
		iss: ISSUER, sub: MOCK_USER.sub, aud, iat: now, exp: now + 3600,
		email: MOCK_USER.email, name: MOCK_USER.name,
		'casepro:org_id': MOCK_USER['casepro:org_id'], 'casepro:role': MOCK_USER['casepro:role'],
	})));
	const sig = b64url(crypto.createHmac('sha256', 'mock-secret').update(`${header}.${payload}`).digest());
	return `${header}.${payload}.${sig}`;
}

const server = http.createServer(async (req, res) => {
	const u = new URL(req.url, ISSUER);
	const path = u.pathname;
	const log = (m) => console.log(`[mock-oidc] ${req.method} ${path} :: ${m}`);

	// Discovery
	if (req.method === 'GET' && path === '/.well-known/oauth-authorization-server') {
		return send(res, 200, {
			issuer: ISSUER,
			authorization_endpoint: `${ISSUER}/api/auth/mcp/authorize`,
			token_endpoint: `${ISSUER}/api/auth/mcp/token`,
			userinfo_endpoint: `${ISSUER}/api/auth/mcp/get-session`,
			registration_endpoint: `${ISSUER}/api/auth/mcp/register`,
			jwks_uri: `${ISSUER}/api/auth/jwks`,
			code_challenge_methods_supported: ['S256'],
			grant_types_supported: ['authorization_code', 'refresh_token'],
			response_types_supported: ['code'],
			scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'casepro:read', 'casepro:write'],
			token_endpoint_auth_methods_supported: ['none'],
		});
	}

	if (req.method === 'GET' && path === '/api/auth/jwks') {
		return send(res, 200, { keys: [] });
	}

	// Dynamic client registration (public client, no secret)
	if (req.method === 'POST' && path === '/api/auth/mcp/register') {
		const body = parseBody(await readBody(req), req.headers['content-type']);
		const client_id = `mc_${b64url(crypto.randomBytes(9))}`;
		clients.set(client_id, { redirect_uris: body.redirect_uris || [] });
		log(`registered client ${client_id} redirect_uris=${JSON.stringify(body.redirect_uris)}`);
		return send(res, 201, {
			client_id, client_secret: null,
			client_name: body.client_name || 'MatterChat',
			redirect_uris: body.redirect_uris || [],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'], token_endpoint_auth_method: 'none', client_type: 'public',
		});
	}

	// Authorize — simulate an already-authenticated + consented user, redirect straight back with a code
	if (req.method === 'GET' && path === '/api/auth/mcp/authorize') {
		const q = u.searchParams;
		const redirect_uri = q.get('redirect_uri');
		const state = q.get('state');
		const code_challenge = q.get('code_challenge');
		const method = q.get('code_challenge_method');
		if (!redirect_uri || !code_challenge) return send(res, 400, { error: 'invalid_request', detail: 'missing redirect_uri/code_challenge' });
		if (method !== 'S256') return send(res, 400, { error: 'invalid_request', detail: 'code_challenge_method must be S256' });
		const code = b64url(crypto.randomBytes(18));
		authCodes.set(code, { code_challenge, redirect_uri, client_id: q.get('client_id'), scope: q.get('scope') });
		const back = new URL(redirect_uri);
		back.searchParams.set('code', code);
		if (state) back.searchParams.set('state', state);
		log(`authorize ok -> 302 ${back.toString()}`);
		res.writeHead(302, { Location: back.toString() });
		return res.end();
	}

	// Token — verify PKCE S256, return tokens
	if (req.method === 'POST' && path === '/api/auth/mcp/token') {
		const body = parseBody(await readBody(req), req.headers['content-type']);
		const entry = authCodes.get(body.code);
		if (!entry) return send(res, 400, { error: 'invalid_grant', detail: 'unknown code' });
		authCodes.delete(body.code);
		const expected = b64url(crypto.createHash('sha256').update(body.code_verifier || '').digest());
		if (expected !== entry.code_challenge) {
			log(`PKCE MISMATCH expected=${entry.code_challenge} got=${expected}`);
			return send(res, 400, { error: 'invalid_grant', detail: 'PKCE verification failed' });
		}
		if (body.redirect_uri && body.redirect_uri !== entry.redirect_uri) {
			return send(res, 400, { error: 'invalid_grant', detail: 'redirect_uri mismatch' });
		}
		const access_token = b64url(crypto.randomBytes(24));
		accessTokens.set(access_token, MOCK_USER.sub);
		log(`PKCE ok -> issuing tokens for sub=${MOCK_USER.sub}`);
		return send(res, 200, {
			access_token, token_type: 'Bearer', expires_in: 3600,
			refresh_token: b64url(crypto.randomBytes(24)),
			id_token: makeIdToken(body.client_id),
			scope: entry.scope,
		}, { 'Cache-Control': 'no-store' });
	}

	// Userinfo / get-session
	if (req.method === 'GET' && path === '/api/auth/mcp/get-session') {
		const auth = req.headers['authorization'] || '';
		const token = auth.replace(/^Bearer\s+/i, '');
		if (!accessTokens.has(token)) return send(res, 401, { error: 'invalid_token' });
		log(`get-session ok for sub=${MOCK_USER.sub}`);
		return send(res, 200, {
			user: {
				id: MOCK_USER.sub, email: MOCK_USER.email, name: MOCK_USER.name,
				preferred_username: MOCK_USER.preferred_username,
				'casepro:org_id': MOCK_USER['casepro:org_id'],
				'casepro:role': MOCK_USER['casepro:role'],
				'casepro:is_global_admin': MOCK_USER['casepro:is_global_admin'],
			},
			session: { id: 'mock-session', userId: MOCK_USER.sub, expiresAt: new Date(Date.now() + 3600e3).toISOString() },
		});
	}

	// Bulk provisioning: CentralizedAuth POST /organizations/invite-multiple
	// (real endpoint needs an admin session; the mock accepts any auth). Creates invites and —
	// simulating invite acceptance — fires the user.added_to_org webhook to the CRM receiver,
	// exactly the path that auto-syncs new users into CasePro + LitBox.
	if (req.method === 'POST' && path === '/organizations/invite-multiple') {
		const body = parseBody(await readBody(req), req.headers['content-type']);
		const emails = Array.isArray(body.emails) ? body.emails : [];
		const organizationId = body.organizationId || 'org-mock';
		const roleId = body.roleId || 'role-member';
		const made = [];
		for (const email of emails) {
			const invite = { id: b64url(crypto.randomBytes(9)), email, organizationId, roleId, status: 'pending', token: b64url(crypto.randomBytes(12)) };
			invites.push(invite);
			made.push(invite);
			const userId = uuidForEmail(email); // CentralizedAuth uuid == CasePro users.id
			const payload = {
				event: 'user.added_to_org',
				user: { id: userId, email, name: email.split('@')[0], emailVerified: false, isActive: true },
				organization: { id: organizationId },
				role: { id: roleId },
				timestamp: ISSUER,
			};
			// fire-and-forget webhook (the real CentralizedAuth UserSyncWebhookService behaviour)
			fetch(CRM_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'mock' }, body: JSON.stringify(payload) }).catch(() => {});
		}
		log(`invite-multiple: ${made.length} invites -> webhooks fired to ${CRM_WEBHOOK_URL}`);
		return send(res, 201, { invites: made, errors: [], totalInvited: made.length, totalErrors: 0 });
	}

	// (mock CasePro) inbound user-sync webhook receiver
	if (req.method === 'POST' && path === '/crm/users/webhook/sync') {
		const body = parseBody(await readBody(req), req.headers['content-type']);
		syncedUsers.push({ id: body?.user?.id, email: body?.user?.email, event: body?.event, org: body?.organization?.id });
		log(`CRM received ${body?.event} for ${body?.user?.email} (id=${body?.user?.id})`);
		return send(res, 200, { ok: true });
	}

	// inspection: what the mock CasePro has synced
	if (req.method === 'GET' && path === '/crm/synced') {
		return send(res, 200, { count: syncedUsers.length, users: syncedUsers });
	}

	return send(res, 404, { error: 'not_found', path });
});

server.listen(PORT, '127.0.0.1', () => {
	console.log(`[mock-oidc] listening on ${ISSUER}`);
	console.log(`[mock-oidc] sub (=CasePro users.id) -> ${MOCK_USER.sub}  email -> ${MOCK_USER.email}`);
});
