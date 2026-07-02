import { expect } from 'chai';
import { describe, it } from 'mocha';
import sinon from 'sinon';

import type { ChiFetch } from '../../../../../server/lib/chi/client';
import { askChi } from '../../../../../server/lib/chi/client';
import { getChiConfig, isChiConfigured } from '../../../../../server/lib/chi/config';

const ENV = {
	CHI_API_URL: 'https://ai-agent-app.stg-omnisai.io/',
	CHI_API_KEY: 'test-key',
	CHI_AGENT_ID: 'agent-42',
};

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('chi/config + chi/client', () => {
	describe('configuration (unconfigured behavior)', () => {
		it('is unconfigured when any of the three env vars is missing', () => {
			expect(isChiConfigured({})).to.be.false;
			expect(isChiConfigured({ CHI_API_URL: 'x' })).to.be.false;
			expect(isChiConfigured({ CHI_API_URL: 'x', CHI_API_KEY: 'y' })).to.be.false;
			expect(isChiConfigured({ ...ENV, CHI_AGENT_ID: '   ' })).to.be.false;
			expect(isChiConfigured(ENV)).to.be.true;
		});

		it('strips the trailing slash off the api url', () => {
			expect(getChiConfig(ENV)?.apiUrl).to.equal('https://ai-agent-app.stg-omnisai.io');
		});

		it('askChi degrades to not_configured without ever fetching', async () => {
			const fetcher = sinon.stub();
			const result = await askChi({ question: 'q' }, { env: {}, fetcher });
			expect(result.ok).to.be.false;
			expect(result.ok === false && result.reason).to.equal('not_configured');
			expect(result.ok === false && result.note).to.match(/not configured/i);
			expect(fetcher.called).to.be.false;
		});
	});

	describe('askChi (invoke adapter)', () => {
		it('POSTs the agent chat route with both auth headers and the assembled context', async () => {
			const fetcher = sinon.stub().resolves(okResponse({ response: 'The SOL is 2027-01-15.' }));
			const result = await askChi(
				{ question: 'when is the SOL?', roomName: 'smith-v-jones', matterId: 'matter-123', askedBy: 'phillip' },
				{ env: ENV, fetcher: fetcher as ChiFetch },
			);

			expect(result).to.deep.equal({ ok: true, text: 'The SOL is 2027-01-15.' });

			const [url, options] = fetcher.firstCall.args;
			expect(url).to.equal('https://ai-agent-app.stg-omnisai.io/api/v1/chat/agents/agent-42/chat');
			expect(options.method).to.equal('POST');
			expect(options.headers.Authorization).to.equal('Bearer test-key');
			expect(options.headers['X-API-Key']).to.equal('test-key');
			expect(options.timeout).to.be.a('number');

			const body = JSON.parse(options.body);
			expect(body.message).to.include('CasePro matter id: matter-123');
			expect(body.message).to.include('Question: when is the SOL?');
		});

		it('returns a friendly http failure on a non-2xx response', async () => {
			const fetcher = sinon.stub().resolves({ ok: false, status: 503, json: async () => ({}) });
			const result = await askChi({ question: 'q' }, { env: ENV, fetcher: fetcher as ChiFetch });
			expect(result.ok).to.be.false;
			expect(result.ok === false && result.reason).to.equal('http');
			expect(result.ok === false && result.note).to.include('503');
		});

		it('returns "no answer" when the body has no recognizable text', async () => {
			const fetcher = sinon.stub().resolves(okResponse({ status: 'done' }));
			const result = await askChi({ question: 'q' }, { env: ENV, fetcher: fetcher as ChiFetch });
			expect(result.ok).to.be.false;
			expect(result.ok === false && result.reason).to.equal('empty');
		});

		it('never throws — a transport error degrades and never leaks content', async () => {
			const boom = new Error('secret question text must not surface');
			boom.name = 'AbortError';
			const fetcher = sinon.stub().rejects(boom);
			const result = await askChi({ question: 'super secret question' }, { env: ENV, fetcher: fetcher as ChiFetch });
			expect(result.ok).to.be.false;
			expect(result.ok === false && result.reason).to.equal('unavailable');
			expect(result.ok === false && result.note).to.not.include('secret');
			expect(result.ok === false && result.note).to.include('AbortError');
		});
	});
});
