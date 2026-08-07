import { expect } from 'chai';
import { afterEach, before, beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

/**
 * LitBox proxy — loginToken EXPIRY enforcement (M3, ported from crossFirmProxy).
 *
 * The proxy re-implements the resume-token lookup, so it must also enforce token expiry the way
 * Rocket.Chat's normal resume path does: a loginToken whose `when` is older than
 * Accounts_LoginExpiration (days) must 401 instead of resolving the user and forwarding to LitBox.
 */

const DAY = 24 * 60 * 60 * 1000;

const findOne = sinon.stub();
const updateOne = sinon.stub().resolves();
const serverFetch = sinon.stub();
const settingsGet = sinon.stub();

// Capture the connect handler litboxProxy registers on '/_litbox'.
let handler: (req: any, res: any, next: () => void) => Promise<void>;

proxyquire.noCallThru().load('../../../../../app/omnisai-oauth/server/litboxProxy', {
	'@rocket.chat/models': {
		Users: { findOne, updateOne },
	},
	'@rocket.chat/server-fetch': {
		serverFetch,
	},
	'meteor/accounts-base': {
		Accounts: {
			_hashLoginToken: (raw: string) => `hashed(${raw})`,
		},
	},
	'meteor/routepolicy': {
		RoutePolicy: { declare: sinon.stub() },
	},
	'meteor/webapp': {
		WebApp: {
			connectHandlers: {
				use: (_path: string, fn: any) => {
					handler = fn;
				},
			},
		},
	},
	'../../../server/lib/logger/system': {
		SystemLogger: { error: sinon.stub(), warn: sinon.stub() },
	},
	'../../../server/settings': {
		settings: { get: settingsGet },
	},
	'./litboxCrypto': {
		// Pass-through: encryption-at-rest is covered by litboxCrypto.spec.ts.
		encryptToken: (v: string | undefined) => v,
		decryptToken: (v: string | undefined) => v,
	},
});

const makeReq = (token = 'raw-token') => ({
	method: 'GET',
	url: '/v1/files',
	headers: { authorization: `Bearer ${token}` },
});

const makeRes = () => {
	const res = {
		statusCode: 0,
		body: '',
		writeHead(code: number) {
			this.statusCode = code;
		},
		end(data?: any) {
			this.body = data ? data.toString() : '';
		},
	};
	return res;
};

const userWithTokenIssuedAt = (when: Date | undefined) => ({
	_id: 'user1',
	omnisaiLitbox: { sessionToken: 'litbox-session-token' },
	services: {
		resume: {
			// The positional ($) projection returns ONLY the matched token entry.
			loginTokens: [when === undefined ? { hashedToken: 'hashed(raw-token)' } : { hashedToken: 'hashed(raw-token)', when }],
		},
	},
});

const okUpstream = () => ({
	status: 200,
	headers: { get: () => null },
	arrayBuffer: async () => new ArrayBuffer(0),
});

describe('litboxProxy loginToken expiry (M3)', () => {
	before(() => {
		expect(handler, 'litboxProxy should register a /_litbox connect handler').to.be.a('function');
	});

	beforeEach(() => {
		process.env.LITBOX_API_URL = 'https://litbox.example.test';
		findOne.reset();
		updateOne.reset();
		updateOne.resolves();
		serverFetch.reset();
		serverFetch.resolves(okUpstream());
		settingsGet.reset();
		settingsGet.withArgs('Accounts_LoginExpiration').returns(90);
	});

	afterEach(() => {
		delete process.env.LITBOX_API_URL;
	});

	it('401s an EXPIRED loginToken and never forwards to LitBox', async () => {
		findOne.resolves(userWithTokenIssuedAt(new Date(Date.now() - 91 * DAY)));

		const res = makeRes();
		await handler(makeReq(), res as any, () => undefined);

		expect(res.statusCode).to.equal(401);
		expect(JSON.parse(res.body)).to.deep.equal({ success: false, error: 'unauthorized' });
		// Fail closed: the LitBox credential must never be attached for an expired token.
		expect(serverFetch.called).to.be.false;
	});

	it('401s a loginToken with no `when` timestamp (fail closed)', async () => {
		findOne.resolves(userWithTokenIssuedAt(undefined));

		const res = makeRes();
		await handler(makeReq(), res as any, () => undefined);

		expect(res.statusCode).to.equal(401);
		expect(serverFetch.called).to.be.false;
	});

	it('honors a shorter Accounts_LoginExpiration setting', async () => {
		settingsGet.withArgs('Accounts_LoginExpiration').returns(1);
		findOne.resolves(userWithTokenIssuedAt(new Date(Date.now() - 2 * DAY)));

		const res = makeRes();
		await handler(makeReq(), res as any, () => undefined);

		expect(res.statusCode).to.equal(401);
		expect(serverFetch.called).to.be.false;
	});

	it('defaults to 90 days when Accounts_LoginExpiration is unset', async () => {
		settingsGet.withArgs('Accounts_LoginExpiration').returns(undefined);
		findOne.resolves(userWithTokenIssuedAt(new Date(Date.now() - 30 * DAY)));

		const res = makeRes();
		await handler(makeReq(), res as any, () => undefined);

		expect(res.statusCode).to.equal(200);
		expect(serverFetch.calledOnce).to.be.true;
	});

	it('still resolves a FRESH loginToken and forwards with the LitBox credential', async () => {
		findOne.resolves(userWithTokenIssuedAt(new Date(Date.now() - 1 * DAY)));

		const res = makeRes();
		await handler(makeReq(), res as any, () => undefined);

		expect(res.statusCode).to.equal(200);
		expect(serverFetch.calledOnce).to.be.true;
		const [url, opts] = serverFetch.firstCall.args;
		expect(String(url)).to.equal('https://litbox.example.test/api/v1/files');
		expect(opts.headers.authorization).to.equal('Bearer litbox-session-token');
	});

	it('queries with the positional loginTokens projection so only the matched token is checked', async () => {
		findOne.resolves(userWithTokenIssuedAt(new Date()));

		const res = makeRes();
		await handler(makeReq(), res as any, () => undefined);

		const [query, options] = findOne.firstCall.args;
		expect(query).to.deep.equal({ 'services.resume.loginTokens.hashedToken': 'hashed(raw-token)' });
		expect(options.projection).to.have.property('services.resume.loginTokens.$', 1);
	});
});
