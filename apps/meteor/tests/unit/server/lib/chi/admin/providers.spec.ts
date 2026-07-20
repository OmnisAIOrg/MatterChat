import { expect } from 'chai';
import { describe, it } from 'mocha';

import { PROVIDER_PRESETS, resolveProvider } from '../../../../../../server/lib/chi/admin/providers';

describe('chi admin provider presets', () => {
	it('maps each provider to the right family + endpoint', () => {
		expect(resolveProvider('anthropic')).to.deep.equal({ family: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' });
		expect(resolveProvider('cerebras')).to.deep.equal({ family: 'openai', baseUrl: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b' });
		expect(resolveProvider('groq')).to.deep.equal({ family: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' });
		expect(resolveProvider('openai').baseUrl).to.equal('https://api.openai.com/v1');
		expect(resolveProvider('openrouter').baseUrl).to.equal('https://openrouter.ai/api/v1');
	});

	it('lets Model and Base URL overrides win over the preset', () => {
		const r = resolveProvider('cerebras', 'https://proxy.internal/v1', 'qwen-3-32b');
		expect(r).to.deep.equal({ family: 'openai', baseUrl: 'https://proxy.internal/v1', model: 'qwen-3-32b' });
	});

	it('blank Model falls back to the provider default (so switching provider needs no model edit)', () => {
		expect(resolveProvider('cerebras', '', '').model).to.equal('llama-3.3-70b');
		expect(resolveProvider('groq', '', '   ').model).to.equal('llama-3.3-70b-versatile');
	});

	it('custom provider with no base url leaves baseUrl undefined (llm.ts fills the OpenAI default) + a valid model', () => {
		const r = resolveProvider('custom', '', '');
		expect(r.family).to.equal('openai');
		expect(r.baseUrl).to.be.undefined;
		expect(r.model).to.equal('gpt-4o');
	});

	it('unknown provider ids fall back to Anthropic', () => {
		expect(resolveProvider('does-not-exist').family).to.equal('anthropic');
		expect(resolveProvider(undefined).family).to.equal('anthropic');
	});

	it('every preset id is resolvable', () => {
		for (const id of Object.keys(PROVIDER_PRESETS)) {
			expect(resolveProvider(id).model, id).to.be.a('string').and.not.empty;
		}
	});
});
