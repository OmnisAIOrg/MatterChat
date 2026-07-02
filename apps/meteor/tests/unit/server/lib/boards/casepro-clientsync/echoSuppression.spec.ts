import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	EchoSuppressionSet,
	clientSyncMessageId,
	isClientSyncMessageId,
} from '../../../../../../server/lib/boards/casepro-clientsync/echoSuppression';

const MATTER = 'matter-abc';
const OTHER_MATTER = 'matter-xyz';

describe('CasePro client-sync loop prevention', () => {
	describe('clientSyncMessageId (deterministic RC _id scheme)', () => {
		it('is deterministic and cpc-prefixed', () => {
			const a = clientSyncMessageId(MATTER, 'cm-1');
			const b = clientSyncMessageId(MATTER, 'cm-1');
			expect(a).to.equal(b);
			expect(a.startsWith('cpc-')).to.equal(true);
		});

		it('scopes by matter AND CasePro message id', () => {
			const base = clientSyncMessageId(MATTER, 'cm-1');
			expect(clientSyncMessageId(OTHER_MATTER, 'cm-1')).to.not.equal(base);
			expect(clientSyncMessageId(MATTER, 'cm-2')).to.not.equal(base);
		});
	});

	describe('isClientSyncMessageId (the outbound skip guard)', () => {
		it('recognizes sync-minted ids and nothing else', () => {
			expect(isClientSyncMessageId(clientSyncMessageId(MATTER, 'cm-1'))).to.equal(true);
			expect(isClientSyncMessageId('regular-rc-message-id')).to.equal(false);
			expect(isClientSyncMessageId(undefined)).to.equal(false);
		});
	});

	describe('EchoSuppressionSet (guard 1: TTL memory of our own outbound POSTs)', () => {
		it('remembers an id it just posted, forgets a foreign one', () => {
			const set = new EchoSuppressionSet();
			set.add(MATTER, 'cm-1');
			expect(set.has(MATTER, 'cm-1')).to.equal(true);
			expect(set.has(MATTER, 'cm-2')).to.equal(false);
			// same CasePro id but a different matter is a different key.
			expect(set.has(OTHER_MATTER, 'cm-1')).to.equal(false);
		});

		it('expires entries after the TTL', () => {
			let now = 1_000;
			const set = new EchoSuppressionSet(100, () => now);
			set.add(MATTER, 'cm-1');
			expect(set.has(MATTER, 'cm-1')).to.equal(true);
			now = 1_101; // past ttl
			expect(set.has(MATTER, 'cm-1')).to.equal(false);
		});

		it('stays bounded under churn (never grows unbounded)', () => {
			const set = new EchoSuppressionSet();
			for (let i = 0; i < 10_000; i++) {
				set.add(MATTER, `cm-${i}`);
			}
			// MAX_ENTRIES cap is 5000.
			expect(set.size()).to.be.at.most(5000);
		});
	});
});
