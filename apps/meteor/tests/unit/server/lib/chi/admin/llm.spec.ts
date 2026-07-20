import { expect } from 'chai';
import { describe, it } from 'mocha';

import type { LlmFetch } from '../../../../../../server/lib/chi/admin/llm';
import { llmStep, parseAnthropicResponse, parseOpenAiResponse } from '../../../../../../server/lib/chi/admin/llm';

const CONFIG = { provider: 'anthropic' as const, apiKey: 'k', model: 'm' };

const fakeFetch =
	(status: number, body: unknown, capture?: { url?: string; body?: string; headers?: Record<string, string> }): LlmFetch =>
	async (url, options) => {
		if (capture) {
			capture.url = url;
			capture.body = options.body;
			capture.headers = options.headers;
		}
		return { ok: status >= 200 && status < 300, status, json: async () => body };
	};

describe('chi admin llm adapter', () => {
	describe('parseAnthropicResponse', () => {
		it('extracts text and tool_use blocks', () => {
			const parsed = parseAnthropicResponse({
				content: [
					{ type: 'text', text: 'On it. ' },
					{ type: 'tool_use', id: 't1', name: 'create_user', input: { email: 'a@x.com' } },
				],
			});
			expect(parsed).to.deep.equal({ text: 'On it.', toolCalls: [{ id: 't1', name: 'create_user', input: { email: 'a@x.com' } }] });
		});
		it('returns undefined on an alien shape', () => {
			expect(parseAnthropicResponse({ nope: true })).to.be.undefined;
		});
	});

	describe('parseOpenAiResponse', () => {
		it('extracts content and tool_calls, surviving malformed arguments', () => {
			const parsed = parseOpenAiResponse({
				choices: [
					{
						message: {
							content: 'ok',
							tool_calls: [
								{ id: 'c1', function: { name: 'list_users', arguments: '{"query":"jane"}' } },
								{ id: 'c2', function: { name: 'broken', arguments: '{oops' } },
							],
						},
					},
				],
			});
			expect(parsed?.text).to.equal('ok');
			expect(parsed?.toolCalls).to.deep.equal([
				{ id: 'c1', name: 'list_users', input: { query: 'jane' } },
				{ id: 'c2', name: 'broken', input: {} },
			]);
		});
		it('returns undefined when there is no message', () => {
			expect(parseOpenAiResponse({ choices: [] })).to.be.undefined;
		});
	});

	describe('llmStep', () => {
		it('anthropic: sends x-api-key + tools and normalizes the reply', async () => {
			const capture: { url?: string; body?: string; headers?: Record<string, string> } = {};
			const step = await llmStep(
				CONFIG,
				'sys',
				[{ kind: 'user', text: 'hi' }],
				[{ name: 'noop', description: 'd', inputSchema: { type: 'object' } }],
				{ fetcher: fakeFetch(200, { content: [{ type: 'text', text: 'hello' }] }, capture) },
			);
			expect(step).to.deep.equal({ ok: true, text: 'hello', toolCalls: [] });
			expect(capture.url).to.equal('https://api.anthropic.com/v1/messages');
			expect(capture.headers?.['x-api-key']).to.equal('k');
			expect(JSON.parse(capture.body || '{}').tools[0].input_schema).to.deep.equal({ type: 'object' });
		});
		it('openai: honors a custom base url and Bearer auth', async () => {
			const capture: { url?: string; headers?: Record<string, string> } = {};
			const step = await llmStep(
				{ provider: 'openai', apiKey: 'k2', model: 'm', baseUrl: 'https://openrouter.ai/api/v1/' },
				'sys',
				[{ kind: 'user', text: 'hi' }],
				[],
				{ fetcher: fakeFetch(200, { choices: [{ message: { content: 'yo' } }] }, capture) },
			);
			expect(step).to.deep.equal({ ok: true, text: 'yo', toolCalls: [] });
			expect(capture.url).to.equal('https://openrouter.ai/api/v1/chat/completions');
			expect(capture.headers?.Authorization).to.equal('Bearer k2');
		});
		it('maps HTTP errors and thrown transports to friendly notes, never throws', async () => {
			const denied = await llmStep(CONFIG, 's', [{ kind: 'user', text: 'x' }], [], { fetcher: fakeFetch(401, {}) });
			expect(denied.ok).to.be.false;
			const dead = await llmStep(CONFIG, 's', [{ kind: 'user', text: 'x' }], [], {
				fetcher: async () => {
					throw new Error('boom');
				},
			});
			expect(dead.ok).to.be.false;
		});
	});
});
