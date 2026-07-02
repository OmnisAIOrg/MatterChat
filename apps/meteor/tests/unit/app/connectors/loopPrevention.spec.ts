import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	EXT_MESSAGE_ID_PREFIX,
	extMessageId,
	isBridgeMessageId,
	isBridgeRoomImportId,
	roomImportId,
} from '../../../../app/connectors/server/bridge/bridgeIds';
import { EchoSuppressionSet } from '../../../../app/connectors/server/bridge/echoSuppression';

const CONNECTION_ID = 'conn123';
const CHANNEL = 'team-guid|19:abc@thread.tacv2';

describe('Bridge loop prevention', () => {
	describe('extMessageId (deterministic RC _id scheme)', () => {
		it('is deterministic and ext-prefixed', () => {
			const a = extMessageId(CONNECTION_ID, CHANNEL, '1616990032035');
			const b = extMessageId(CONNECTION_ID, CHANNEL, '1616990032035');
			expect(a).to.equal(b);
			expect(a.startsWith(EXT_MESSAGE_ID_PREFIX)).to.equal(true);
		});

		it('scopes by connection AND channel AND message', () => {
			const base = extMessageId(CONNECTION_ID, CHANNEL, '1');
			expect(extMessageId('other-conn', CHANNEL, '1')).to.not.equal(base);
			expect(extMessageId(CONNECTION_ID, 'other|channel', '1')).to.not.equal(base);
			expect(extMessageId(CONNECTION_ID, CHANNEL, '2')).to.not.equal(base);
		});

		it('sanitizes symbol-heavy external ids into a Mongo-safe _id', () => {
			const id = extMessageId(CONNECTION_ID, CHANNEL, 'weird id:with@symbols/…');
			expect(id).to.match(/^ext-[A-Za-z0-9_-]+-[a-f0-9]{10}-[A-Za-z0-9_-]+$/);
		});
	});

	describe('isBridgeMessageId (the outbound skip guard)', () => {
		it('recognizes bridge-minted ids and nothing else', () => {
			expect(isBridgeMessageId(extMessageId(CONNECTION_ID, CHANNEL, '1'))).to.equal(true);
			expect(isBridgeMessageId('vRQvXFyKvKbnSN4c2')).to.equal(false);
			expect(isBridgeMessageId('slack-C123-1616990032-035')).to.equal(false);
		});
	});

	describe('roomImportId (the spec §4.3 room tag)', () => {
		it('namespaces as ext:<connectionId>:<channelExternalId>', () => {
			expect(roomImportId(CONNECTION_ID, CHANNEL)).to.equal(`ext:${CONNECTION_ID}:${CHANNEL}`);
		});

		it('isBridgeRoomImportId gates only ext: tags', () => {
			expect(isBridgeRoomImportId(roomImportId(CONNECTION_ID, CHANNEL))).to.equal(true);
			expect(isBridgeRoomImportId('C0123SLACK')).to.equal(false); // legacy SlackBridge importId
			expect(isBridgeRoomImportId(undefined)).to.equal(false);
			expect(isBridgeRoomImportId(42)).to.equal(false);
		});
	});

	describe('EchoSuppressionSet (drop the webhook echo of our own outbound post)', () => {
		it('remembers a posted external id within the TTL window', () => {
			let now = 1_000_000;
			const set = new EchoSuppressionSet(60_000, () => now);
			set.add(CONNECTION_ID, 'ext-msg-1');
			expect(set.has(CONNECTION_ID, 'ext-msg-1')).to.equal(true);
			// Scoped per connection — another connection's identical external id is not suppressed.
			expect(set.has('other-conn', 'ext-msg-1')).to.equal(false);
			expect(set.has(CONNECTION_ID, 'ext-msg-2')).to.equal(false);
			// Still inside TTL.
			now += 59_000;
			expect(set.has(CONNECTION_ID, 'ext-msg-1')).to.equal(true);
		});

		it('expires entries after the TTL', () => {
			let now = 1_000_000;
			const set = new EchoSuppressionSet(60_000, () => now);
			set.add(CONNECTION_ID, 'ext-msg-1');
			now += 60_001;
			expect(set.has(CONNECTION_ID, 'ext-msg-1')).to.equal(false);
			expect(set.size()).to.equal(0);
		});

		it('sweeps expired entries on add', () => {
			let now = 1_000_000;
			const set = new EchoSuppressionSet(60_000, () => now);
			set.add(CONNECTION_ID, 'a');
			set.add(CONNECTION_ID, 'b');
			now += 60_001;
			set.add(CONNECTION_ID, 'c');
			expect(set.size()).to.equal(1);
			expect(set.has(CONNECTION_ID, 'c')).to.equal(true);
		});
	});
});
