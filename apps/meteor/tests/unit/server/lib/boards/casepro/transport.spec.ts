import { expect } from 'chai';
import { beforeEach, afterEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

/**
 * CasePro live-wire transport unit tests.
 *
 * Covers the security-relevant seams:
 *   - endpoint derivation (https-only, /mcp[/v2] path handling, no URL creds),
 *   - auth header injection (X-MCP-API-Key / X-Organization-ID / X-Acting-User)
 *     + strict egress options (SSRF allow-list pinned to the host, no redirects),
 *   - refuse-without-key (constructor AND config resolution fall back to stub),
 *   - the offset-emulation paging contract of query().
 */

const settingsGetStub = sinon.stub();
const warnStub = sinon.stub();

const transportModule = proxyquire.noCallThru().load('../../../../../../server/lib/boards/casepro/transport.ts', {
	'@rocket.chat/server-fetch': { serverFetch: sinon.stub() },
	'../../../../app/settings/server': { settings: { get: settingsGetStub } },
	'../../logger/system': { SystemLogger: { warn: warnStub, info: sinon.stub(), debug: sinon.stub() } },
});

const { deriveMcpEndpoint, buildMcpFilters, McpGatewayTransport, StubTransport, resolveTransportFromConfig, caseProTransportDiagnostics } =
	transportModule;

/** Build a fetch stub that answers every call with one JSON-RPC tool payload. */
const fetchReturning = (payload: unknown, { status = 200 }: { status?: number } = {}) =>
	sinon.stub().resolves({
		ok: status >= 200 && status < 300,
		status,
		json: async () => ({
			jsonrpc: '2.0',
			id: 1,
			result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
		}),
	});

const KEY = 'test-mcp-key';
const ORG = 'org-uuid-1';
const BASE = 'https://casepro-mcp-v2.stg-omnisai.io';

describe('CasePro transport (live wire)', () => {
	const envBackup: Record<string, string | undefined> = {};
	const ENV_KEYS = ['CASEPRO_TRANSPORT', 'CASEPRO_BASE_URL', 'CASEPRO_MCP_API_KEY', 'CASEPRO_ORG_ID', 'CASEPRO_AUTH_MODE'];

	beforeEach(() => {
		for (const k of ENV_KEYS) {
			envBackup[k] = process.env[k];
			delete process.env[k];
		}
		settingsGetStub.reset();
		settingsGetStub.returns(undefined);
		warnStub.reset();
	});

	afterEach(() => {
		for (const k of ENV_KEYS) {
			if (envBackup[k] === undefined) {
				delete process.env[k];
			} else {
				process.env[k] = envBackup[k];
			}
		}
	});

	describe('deriveMcpEndpoint (egress policy)', () => {
		it('appends /mcp/v2 to a bare origin and pins the host', () => {
			expect(deriveMcpEndpoint(BASE)).to.deep.equal({
				endpoint: `${BASE}/mcp/v2`,
				host: 'casepro-mcp-v2.stg-omnisai.io',
			});
		});

		it('keeps an explicit /mcp/v2 (and /mcp) path as-is', () => {
			expect(deriveMcpEndpoint(`${BASE}/mcp/v2`).endpoint).to.equal(`${BASE}/mcp/v2`);
			expect(deriveMcpEndpoint(`${BASE}/mcp/`).endpoint).to.equal(`${BASE}/mcp`);
		});

		it('rejects non-https URLs', () => {
			expect(() => deriveMcpEndpoint('http://casepro-mcp-v2.stg-omnisai.io')).to.throw(/https/);
		});

		it('rejects URLs embedding credentials', () => {
			expect(() => deriveMcpEndpoint('https://user:pass@evil.example.com')).to.throw(/credentials/);
		});

		it('rejects garbage URLs', () => {
			expect(() => deriveMcpEndpoint('not a url')).to.throw();
		});
	});

	describe('buildMcpFilters', () => {
		it('maps equality and $in conditions onto the gateway filters array', () => {
			expect(buildMcpFilters({ archived: false, id: { $in: ['a', 'b'] } })).to.deep.equal([
				{ field: 'archived', operator: '=', value: false },
				{ field: 'id', operator: 'in', value: ['a', 'b'] },
			]);
		});

		it('returns [] for an empty/absent filter', () => {
			expect(buildMcpFilters(undefined)).to.deep.equal([]);
			expect(buildMcpFilters({})).to.deep.equal([]);
		});
	});

	describe('McpGatewayTransport', () => {
		it('refuses to construct without an API key (never unauthenticated)', () => {
			expect(() => new McpGatewayTransport({ baseUrl: BASE, apiKey: '' })).to.throw(/CASEPRO_MCP_API_KEY/);
		});

		it('sends auth headers + strict egress options on every call', async () => {
			const fetchFn = fetchReturning({ success: true, records: [] });
			const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, orgId: ORG, fetchFn });

			await tx.query('matters', { filter: { archived: false } });

			expect(fetchFn.calledOnce).to.be.true;
			const [url, options] = fetchFn.firstCall.args;
			expect(url).to.equal(`${BASE}/mcp/v2`);
			expect(options.headers['X-MCP-API-Key']).to.equal(KEY);
			expect(options.headers['X-Organization-ID']).to.equal(ORG);
			expect(options.ignoreSsrfValidation).to.equal(false);
			expect(options.allowList).to.equal('casepro-mcp-v2.stg-omnisai.io');
			expect(options.followRedirects).to.equal(false);

			const body = JSON.parse(options.body);
			expect(body.method).to.equal('tools/call');
			expect(body.params.name).to.equal('query_entities');
			expect(body.params.arguments.entity).to.equal('matters');
			expect(body.params.arguments.filters).to.deep.equal([{ field: 'archived', operator: '=', value: false }]);
		});

		it('attaches X-Acting-User on writes when a call context is given', async () => {
			const fetchFn = fetchReturning({ success: true, created: { id: 'row-1' } });
			const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, orgId: ORG, fetchFn });

			const row = await tx.create('parties', { full_name: 'Jane Doe' }, { actingUserId: 'user-42' });

			expect(row.id).to.equal('row-1');
			const [, options] = fetchFn.firstCall.args;
			expect(options.headers['X-Acting-User']).to.equal('user-42');
			const body = JSON.parse(options.body);
			expect(body.params.name).to.equal('create_entity');
			expect(body.params.arguments.data).to.deep.equal({ full_name: 'Jane Doe' });
		});

		it('emulates offset paging (gateway has limit only) and slices locally', async () => {
			const records = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }));
			const fetchFn = fetchReturning({ success: true, records });
			const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, fetchFn });

			const { data, total } = await tx.query('matters', { limit: 2, offset: 2 });

			const body = JSON.parse(fetchFn.firstCall.args[1].body);
			expect(body.params.arguments.limit).to.equal(4); // offset + limit over-fetch
			expect(data.map((r: { id: string }) => r.id)).to.deep.equal(['r2', 'r3']);
			expect(total).to.be.greaterThan(4); // full page came back -> signal "maybe more"
		});

		it('reports an exact total when the gateway returns a short page', async () => {
			const fetchFn = fetchReturning({ success: true, records: [{ id: 'r0' }] });
			const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, fetchFn });

			const { data, total } = await tx.query('matters', { limit: 50, offset: 0 });

			expect(data).to.have.length(1);
			expect(total).to.equal(1); // short page -> no phantom "more"
		});

		it('maps a get_entity not-found payload to null', async () => {
			const fetchFn = fetchReturning({ success: false, found: false, record: null, error: 'matters with id nope not found' });
			const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, fetchFn });

			expect(await tx.get('matters', 'nope')).to.equal(null);
		});

		it('throws the tool error for non-not-found failures', async () => {
			const fetchFn = fetchReturning({ success: false, error: 'organization mismatch' });
			const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, fetchFn });

			await expect(tx.query('matters')).to.be.rejectedWith(/organization mismatch/);
		});

		it('refuses to follow gateway redirects', async () => {
			const fetchFn = sinon.stub().resolves({ ok: false, status: 302, json: async () => ({}) });
			const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, fetchFn });

			await expect(tx.query('matters')).to.be.rejectedWith(/redirect/);
		});

		describe('request() — generic CRM REST verb (calendar/email reuse)', () => {
			const okJson = (status: number, body: unknown) =>
				sinon.stub().resolves({ ok: status >= 200 && status < 300, status, json: async () => body });

			it('GET builds a query string and reuses the same auth headers + egress posture', async () => {
				const fetchFn = okJson(200, { data: [{ id: 'cal-1' }], total: 1 });
				const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, orgId: ORG, fetchFn });

				const res = await tx.request('GET', 'calendar/all-events', {
					query: { userId: 'sub-1', timeMin: '2026-01-01T00:00:00.000Z', timeMax: undefined },
					ctx: { actingUserId: 'sub-1' },
				});

				const [url, options] = fetchFn.firstCall.args;
				expect(url).to.equal(`${BASE}/calendar/all-events?userId=sub-1&timeMin=2026-01-01T00%3A00%3A00.000Z`);
				expect(options.method).to.equal('GET');
				expect(options.headers['X-MCP-API-Key']).to.equal(KEY);
				expect(options.headers['X-Organization-ID']).to.equal(ORG);
				expect(options.headers['X-Acting-User']).to.equal('sub-1');
				expect(options.ignoreSsrfValidation).to.equal(false);
				expect(options.allowList).to.equal('casepro-mcp-v2.stg-omnisai.io');
				expect(options.followRedirects).to.equal(false);
				expect(options.body).to.equal(undefined); // GET has no body
				expect(res).to.deep.equal({ data: [{ id: 'cal-1' }], total: 1 });
			});

			it('POST sends a JSON body (calendar create)', async () => {
				const fetchFn = okJson(201, { id: 'cal-new' });
				const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, orgId: ORG, fetchFn });

				const res = (await tx.request('POST', 'calendar/create', {
					body: { user_id: 'sub-1', title: 'Deadline', start: 's', end: 'e' },
					ctx: { actingUserId: 'sub-1' },
				})) as { id: string };

				const [url, options] = fetchFn.firstCall.args;
				expect(url).to.equal(`${BASE}/calendar/create`);
				expect(options.method).to.equal('POST');
				expect(JSON.parse(options.body)).to.deep.equal({ user_id: 'sub-1', title: 'Deadline', start: 's', end: 'e' });
				expect(res.id).to.equal('cal-new');
			});

			it('DELETE returns undefined on a 204 (no JSON body)', async () => {
				const fetchFn = sinon.stub().resolves({ ok: true, status: 204, json: async () => undefined });
				const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, fetchFn });

				const res = await tx.request('DELETE', 'calendar/cal-1', { ctx: { actingUserId: 'sub-1' } });
				expect(res).to.equal(undefined);
				expect(fetchFn.firstCall.args[1].method).to.equal('DELETE');
			});

			it('refuses to follow redirects (never re-sends the key)', async () => {
				const fetchFn = sinon.stub().resolves({ ok: false, status: 302, json: async () => ({}) });
				const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, fetchFn });

				await expect(tx.request('GET', 'calendar/all-events')).to.be.rejectedWith(/redirected/);
			});

			it('refuses a non-https absolute endpoint (never sends the key over http)', async () => {
				const fetchFn = okJson(200, {});
				const tx = new McpGatewayTransport({ baseUrl: BASE, apiKey: KEY, fetchFn });

				await expect(tx.request('GET', 'http://evil.example/calendar')).to.be.rejectedWith(/https/);
				expect(fetchFn.called).to.equal(false);
			});
		});
	});

	describe('resolveTransportFromConfig (refusal + fallback matrix)', () => {
		it('defaults to the stub with no config at all', () => {
			expect(resolveTransportFromConfig()).to.be.instanceOf(StubTransport);
		});

		it('falls back to the stub (loudly) when rest is requested WITHOUT a key', () => {
			process.env.CASEPRO_TRANSPORT = 'rest';
			process.env.CASEPRO_BASE_URL = BASE;

			expect(resolveTransportFromConfig()).to.be.instanceOf(StubTransport);
			expect(warnStub.calledOnce).to.be.true;

			const diag = caseProTransportDiagnostics();
			expect(diag).to.include({ requested: 'rest', effective: 'stub', keyConfigured: false });
			expect(diag.reason).to.match(/CASEPRO_MCP_API_KEY/);
		});

		it('falls back to the stub when the base URL is not https', () => {
			process.env.CASEPRO_TRANSPORT = 'rest';
			process.env.CASEPRO_BASE_URL = 'http://casepro-mcp-v2.stg-omnisai.io';
			process.env.CASEPRO_MCP_API_KEY = KEY;

			expect(resolveTransportFromConfig()).to.be.instanceOf(StubTransport);
			expect(caseProTransportDiagnostics().reason).to.match(/https/);
		});

		it('falls back to the stub for the (declared, unimplemented) keygate auth mode', () => {
			process.env.CASEPRO_TRANSPORT = 'rest';
			process.env.CASEPRO_BASE_URL = BASE;
			process.env.CASEPRO_MCP_API_KEY = KEY;
			process.env.CASEPRO_AUTH_MODE = 'keygate';

			expect(resolveTransportFromConfig()).to.be.instanceOf(StubTransport);
			expect(caseProTransportDiagnostics().reason).to.match(/keygate/);
		});

		it('resolves the live transport when fully configured (url + key)', () => {
			process.env.CASEPRO_TRANSPORT = 'rest';
			process.env.CASEPRO_BASE_URL = BASE;
			process.env.CASEPRO_MCP_API_KEY = KEY;
			process.env.CASEPRO_ORG_ID = ORG;

			expect(resolveTransportFromConfig()).to.be.instanceOf(McpGatewayTransport);
			expect(caseProTransportDiagnostics()).to.include({
				requested: 'rest',
				effective: 'rest',
				keyConfigured: true,
				orgConfigured: true,
				host: 'casepro-mcp-v2.stg-omnisai.io',
			});
		});
	});
});
