import { expect } from 'chai';
import { describe, it } from 'mocha';

import { buildInboundPushTargets } from '../../../../app/connectors/server/providers/slack/inboundPushTargets';

const DOCS = [
	{ _id: 'c1', userId: 'alice', provider: 'slack' as const },
	{ _id: 'c2', userId: 'bob', provider: 'slack' as const },
];
const EVENT = {
	channelExternalId: 'D0123',
	externalId: '1700000000.000100',
	author: 'Carol',
	text: 'x'.repeat(300),
	tsMs: 1_700_000_000_000,
};

describe('slack inbound push targets', () => {
	it('pushes one payload per connection owner with routing info + clipped preview', () => {
		const targets = buildInboundPushTargets(DOCS, () => false, EVENT);
		expect(targets.map((t) => t.userId)).to.deep.equal(['alice', 'bob']);
		const p = targets[0].payload;
		expect(p).to.include({
			provider: 'slack',
			connectionId: 'c1',
			channelExternalId: 'D0123',
			externalId: '1700000000.000100',
			author: 'Carol',
		});
		expect(p.preview).to.have.length(140);
		expect(p.tsMs).to.equal(1_700_000_000_000);
	});

	it('skips the author echo per connection, not globally', () => {
		const targets = buildInboundPushTargets(DOCS, (id) => id === 'c1', EVENT);
		expect(targets.map((t) => t.userId)).to.deep.equal(['bob']);
	});

	it('drops malformed events and connection docs fail-closed', () => {
		expect(buildInboundPushTargets(DOCS, () => false, { ...EVENT, externalId: '' })).to.be.empty;
		expect(buildInboundPushTargets(DOCS, () => false, { ...EVENT, channelExternalId: '' })).to.be.empty;
		expect(buildInboundPushTargets([{ _id: '', userId: 'x', provider: 'slack' }], () => false, EVENT)).to.be.empty;
	});

	it('omits empty optional fields rather than sending empties', () => {
		const [t] = buildInboundPushTargets([DOCS[0]], () => false, { channelExternalId: 'D1', externalId: 'ts1' });
		expect(t.payload).to.not.have.any.keys('author', 'preview', 'tsMs', 'channelKind');
	});
});
