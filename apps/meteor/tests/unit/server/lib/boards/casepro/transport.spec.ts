import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

/**
 * CasePro transport unit tests (merged surface: stub | native | mcp).
 *
 * Covers the security-relevant seams of the RECONCILED transport layer:
 *   - StubTransport live store semantics + the ingest recorder,
 *   - NativeRestTransport auth header injection (X-API-Key / X-Organization-ID /
 *     Authorization bearer / advisory X-Acting-User) + strict egress options
 *     (SSRF allow-list pinned to the configured host, ignoreSsrfValidation:false),
 *   - the ingest() custom-path egress policy (https-only for absolute URLs,
 *     loopback exemption + localhost→127.0.0.1 pinning),
 *   - config-driven selection (`resolveTransportFromConfig`): disabled → stub,
 *     enabled+native → NativeRestTransport, enabled+mcp → McpTransport,
 *   - `caseProTransportDiagnostics()` requested/effective derivation.
 */

const fetchStub = sinon.stub();
const settingsGetStub = sinon.stub();
const warnStub = sinon.stub();

type StubbedConfig = {
	enabled: boolean;
	transport: 'stub' | 'native' | 'mcp';
	baseUrl: string;
	authMode: 'internal-key' | 'bearer';
	apiKey: string;
	orgId: string;
	mcpPath: string;
};

let currentConfig: StubbedConfig;

const setConfig = (over: Partial<StubbedConfig> = {}): void => {
	currentConfig = {
		enabled: false,
		transport: 'stub',
		baseUrl: '',
		authMode: 'internal-key',
		apiKey: '',
		orgId: '',
		mcpPath: '/mcp/v2',
		...over,
	};
};

const transportModule = proxyquire.noCallThru().load('../../../../../../server/lib/boards/casepro/transport.ts', {
	'@rocket.chat/server-fetch': { serverFetch: fetchStub },
	'../../logger/system': { SystemLogger: { warn: warnStub, info: sinon.stub(), debug: sinon.stub() } },
	'./config': {
		resolveCaseProConfig: () => ({ ...currentConfig }),
		caseProConfigFingerprint: () => JSON.stringify(currentConfig),
		warnOnce: warnStub,
		safeGetSetting: settingsGetStub,
	},
});

const { StubTransport, NativeRestTransport, McpTransport, resolveTransportFromConfig, caseProTransportDiagnostics } = transportModule;

/** serverFetch stub answering with a JSON body (wireFetch reads res.text()). */
const fetchReturning = (payload: unknown, { status = 200 }: { status?: number } = {}) => {
	fetchStub.reset();
	fetchStub.resolves({
		ok: status >= 200 && status < 300,
		status,
		text: async () => JSON.stringify(payload),
	});
	return fetchStub;
};

const KEY = 'test-api-key';
const ORG = 'org-uuid-1';
const BASE = 'https://crm.example.com';

const nativeCfg = (over: Partial<StubbedConfig> = {}): StubbedConfig => ({
	enabled: true,
	transport: 'native',
	baseUrl: BASE,
	authMode: 'internal-key',
	apiKey: KEY,
	orgId: ORG,
	mcpPath: '/mcp/v2',
	...over,
});

describe('CasePro transport (merged: stub | native | mcp)', () => {
	const envBackup: Record<string, string | undefined> = {};
	const ENV_KEYS = ['CASEPRO_TRANSPORT', 'CASEPRO_BASE_URL', 'CASEPRO_API_KEY', 'CASEPRO_ORG_ID', 'CASEPRO_AUTH_MODE', 'CASEPRO_ENABLED'];

	beforeEach(() => {
		for (const k of ENV_KEYS) {
			envBackup[k] = process.env[k];
			delete process.env[k];
		}
		settingsGetStub.reset();
		settingsGetStub.returns(undefined);
		warnStub.reset();
		fetchStub.reset();
		setConfig();
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

	describe('StubTransport (live store + ingest recorder)', () => {
		it('serves seeded rows and pages with limit/offset', async () => {
			const stub = new StubTransport();
			const all = await stub.query('matter_stages');
			expect(all.total).to.be.greaterThan(1);
			const page = await stub.query('matter_stages', { limit: 1, offset: 1 });
			expect(page.data).to.have.length(1);
			expect(page.total).to.equal(all.total);
		});

		it('created/updated rows become visible to get/query (write-through store)', async () => {
			const stub = new StubTransport();
			const created = await stub.create('parties', { first_name: 'Ada' });
			expect(created.id).to.be.a('string');
			const updated = await stub.update('parties', created.id as string, { last_name: 'Lovelace' });
			expect(updated.last_name).to.equal('Lovelace');
			const got = await stub.get('parties', created.id as string);
			expect(got?.last_name).to.equal('Lovelace');
		});

		it('ingest records the payload and reports stub acceptance', async () => {
			const stub = new StubTransport();
			const res = await stub.ingest('matterchat-messages/ingest', { messages: [{ id: 'm1' }] });
			expect(res).to.deep.equal({ ok: true, stub: true });
			expect(stub.ingested).to.have.length(1);
			expect(stub.ingested[0].path).to.equal('matterchat-messages/ingest');
		});
	});

	describe('NativeRestTransport (auth + egress)', () => {
		it('sends X-API-Key + X-Organization-ID and pins the SSRF allow-list to the configured host', async () => {
			const fetch = fetchReturning({ ok: true });
			const tx = new NativeRestTransport(nativeCfg());
			await tx.listSchema('matters');
			expect(fetch.calledOnce).to.equal(true);
			const [url, init] = fetch.firstCall.args;
			expect(url).to.equal(`${BASE}/api/v1/schema/entities/matters`);
			expect(init.headers['X-API-Key']).to.equal(KEY);
			expect(init.headers['X-Organization-ID']).to.equal(ORG);
			expect(init.ignoreSsrfValidation).to.equal(false);
			expect(init.allowList).to.deep.equal(['crm.example.com']);
		});

		it('bearer auth mode sends Authorization instead of the service headers', async () => {
			const fetch = fetchReturning({ ok: true });
			const tx = new NativeRestTransport(nativeCfg({ authMode: 'bearer' }));
			await tx.listSchema('matters');
			const [, init] = fetch.firstCall.args;
			expect(init.headers.Authorization).to.equal(`Bearer ${KEY}`);
			expect(init.headers['X-API-Key']).to.equal(undefined);
		});

		it('attaches the advisory X-Acting-User header on writes when a call context is given', async () => {
			const fetch = fetchReturning({ id: 'p-1', first_name: 'Ada' });
			const tx = new NativeRestTransport(nativeCfg());
			await tx.create('parties', { first_name: 'Ada' }, { actingUserId: 'user-7' });
			const [, init] = fetch.firstCall.args;
			expect(init.headers['X-Acting-User']).to.equal('user-7');
		});

		it('ingest resolves a relative path against the /api/v1 base with the same auth', async () => {
			const fetch = fetchReturning({ accepted: 1 });
			const tx = new NativeRestTransport(nativeCfg());
			const res = await tx.ingest('matterchat-messages/ingest', { messages: [] });
			expect(res).to.deep.equal({ accepted: 1 });
			const [url, init] = fetch.firstCall.args;
			expect(url).to.equal(`${BASE}/api/v1/matterchat-messages/ingest`);
			expect(init.headers['X-API-Key']).to.equal(KEY);
		});

		it('ingest accepts an absolute https URL on a DIFFERENT host and pins the allow-list to it', async () => {
			const fetch = fetchReturning({ accepted: 1 });
			const tx = new NativeRestTransport(nativeCfg());
			await tx.ingest('https://crm-api.example.com/matterchat-messages/ingest', { messages: [] });
			const [url, init] = fetch.firstCall.args;
			expect(url).to.equal('https://crm-api.example.com/matterchat-messages/ingest');
			expect(init.allowList).to.deep.equal(['crm-api.example.com']);
		});

		it('ingest REFUSES a non-https absolute URL (unless loopback)', async () => {
			fetchReturning({ accepted: 1 });
			const tx = new NativeRestTransport(nativeCfg());
			try {
				await tx.ingest('http://evil.example.com/steal', { messages: [] });
				expect.fail('expected a refusal');
			} catch (err) {
				expect((err as Error).message).to.match(/must be https/);
			}
		});

		it('ingest permits the loopback rig and pins localhost to 127.0.0.1', async () => {
			const fetch = fetchReturning({ accepted: 1 });
			const tx = new NativeRestTransport(nativeCfg({ baseUrl: 'http://localhost:6010' }));
			await tx.ingest('http://localhost:6010/api/v1/matterchat-messages/ingest', { messages: [] });
			const [url, init] = fetch.firstCall.args;
			expect(url).to.contain('127.0.0.1:6010');
			expect(init.allowList).to.include('127.0.0.1:6010');
		});
	});

	describe('resolveTransportFromConfig (enablement gate + selection)', () => {
		it('disabled → the stub, regardless of the configured transport', () => {
			setConfig({ enabled: false, transport: 'native', baseUrl: BASE, apiKey: KEY, orgId: ORG });
			expect(resolveTransportFromConfig()).to.be.instanceOf(StubTransport);
		});

		it('enabled + native → NativeRestTransport', () => {
			setConfig(nativeCfg());
			expect(resolveTransportFromConfig()).to.be.instanceOf(NativeRestTransport);
		});

		it('enabled + mcp → McpTransport', () => {
			setConfig(nativeCfg({ transport: 'mcp' }));
			expect(resolveTransportFromConfig()).to.be.instanceOf(McpTransport);
		});

		it('memoizes on the config fingerprint (stub store survives across calls)', () => {
			setConfig();
			const first = resolveTransportFromConfig();
			const second = resolveTransportFromConfig();
			expect(first).to.equal(second);
		});
	});

	describe('caseProTransportDiagnostics', () => {
		it('reports stub/stub with no config at all', () => {
			setConfig();
			const diag = caseProTransportDiagnostics();
			expect(diag.requested).to.equal('stub');
			expect(diag.effective).to.equal('stub');
			expect(diag.keyConfigured).to.equal(false);
		});

		it('reports the kill switch when a live transport is requested while disabled', () => {
			process.env.CASEPRO_TRANSPORT = 'native';
			setConfig({ enabled: false, transport: 'native', baseUrl: BASE, apiKey: KEY, orgId: ORG });
			const diag = caseProTransportDiagnostics();
			expect(diag.requested).to.equal('native');
			expect(diag.effective).to.equal('stub');
			expect(diag.reason).to.match(/CasePro_Enabled/);
		});

		it('reports a fully-live native config (host, key, org)', () => {
			process.env.CASEPRO_TRANSPORT = 'native';
			setConfig(nativeCfg());
			const diag = caseProTransportDiagnostics();
			expect(diag.effective).to.equal('native');
			expect(diag.host).to.equal('crm.example.com');
			expect(diag.keyConfigured).to.equal(true);
			expect(diag.orgConfigured).to.equal(true);
			expect(diag.reason).to.equal(undefined);
		});

		it("maps the legacy 'rest' request onto mcp", () => {
			process.env.CASEPRO_TRANSPORT = 'rest';
			setConfig(nativeCfg({ transport: 'mcp' }));
			const diag = caseProTransportDiagnostics();
			expect(diag.requested).to.equal('mcp');
			expect(diag.effective).to.equal('mcp');
		});
	});
});
