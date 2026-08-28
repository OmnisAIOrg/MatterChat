import { expect } from 'chai';
import { describe, it } from 'mocha';
import { z } from 'zod';

import { shapeOf } from '../../../../../../server/lib/chi/admin/claudecode';

/**
 * The Claude sign-in provider is the one Chi provider with no HTTP wire to assert against — it
 * drives the `claude` CLI through the Agent SDK. What IS pure and worth pinning is the bridge
 * between Chi's JSON-Schema tool defs and the Zod raw shape the SDK's tool() requires: if that
 * silently drops a field, the model gets a tool it cannot call correctly and the orb looks
 * "broken" for reasons no other provider shares.
 */
describe('chi Claude sign-in — JSON Schema → Zod tool shapes', () => {
	const parse = (schema: Parameters<typeof shapeOf>[1], input: unknown) => z.object(shapeOf(z, schema)).safeParse(input);

	it('maps a real Chi tool schema (post_message) with required + optional fields', () => {
		const schema = { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['text'] };
		expect(parse(schema, { text: 'standup at 9' }).success).to.equal(true);
		expect(parse(schema, { channel: '#general', text: 'standup at 9' }).success).to.equal(true);
		// `text` is required — omitting it must fail, or the model could call post_message with nothing to post
		expect(parse(schema, { channel: '#general' }).success).to.equal(false);
	});

	it('carries every scalar type Chi uses', () => {
		const schema = {
			type: 'object',
			properties: { name: { type: 'string' }, count: { type: 'number' }, dryRun: { type: 'boolean' } },
			required: ['name', 'count', 'dryRun'],
		};
		expect(parse(schema, { name: 'a', count: 2, dryRun: true }).success).to.equal(true);
		expect(parse(schema, { name: 'a', count: 'two', dryRun: true }).success).to.equal(false);
	});

	it('handles arrays and nested objects (the CasePro connector shape)', () => {
		const schema = {
			type: 'object',
			properties: {
				entity: { type: 'string' },
				tags: { type: 'array', items: { type: 'string' } },
				data: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
			},
			required: ['entity'],
		};
		expect(parse(schema, { entity: 'matter', tags: ['urgent'], data: { name: 'Doe' } }).success).to.equal(true);
		expect(parse(schema, { entity: 'matter', tags: [1, 2] }).success).to.equal(false);
	});

	it('maps a string enum to a closed set', () => {
		const schema = { type: 'object', properties: { mode: { type: 'string', enum: ['read', 'write'] } }, required: ['mode'] };
		expect(parse(schema, { mode: 'read' }).success).to.equal(true);
		expect(parse(schema, { mode: 'delete' }).success).to.equal(false);
	});

	it('degrades an unknown type to permissive rather than throwing', () => {
		// A dead turn is worse than a loosely-typed argument: the tool itself reports a bad value.
		const schema = { type: 'object', properties: { weird: { type: 'null' } }, required: ['weird'] };
		expect(() => shapeOf(z, schema)).to.not.throw();
		expect(parse(schema, { weird: 'anything' }).success).to.equal(true);
	});

	it('treats a tool with no properties as an empty shape (Chi has several no-arg tools)', () => {
		expect(shapeOf(z, { type: 'object' })).to.deep.equal({});
		expect(parse({ type: 'object' }, {}).success).to.equal(true);
	});
});
