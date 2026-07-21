import { expect } from 'chai';
import { describe, it } from 'mocha';

import { decodeChannelKey, encodeChannelKey, lastSeenFor, storeUnreadCounts } from '../../../../app/connectors/server/channelSeen';

describe('external channel seen/unread (store-computed)', () => {
	it('encodes Mongo-hostile channel ids reversibly (Teams ids carry dots/colons/@)', () => {
		for (const id of ['C0123456789', '19:abc.def@thread.tacv2', 'a$b.c d', '']) {
			expect(decodeChannelKey(encodeChannelKey(id))).to.equal(id);
			expect(encodeChannelKey(id)).to.not.match(/[.$ ]/);
		}
	});

	it('lastSeenFor reads markers under the encoded key and survives string dates + junk', () => {
		const markers = { [encodeChannelKey('D1')]: '2026-07-20T10:00:00.000Z', [encodeChannelKey('D2')]: 'not-a-date' };
		expect(lastSeenFor(markers, 'D1')?.toISOString()).to.equal('2026-07-20T10:00:00.000Z');
		expect(lastSeenFor(markers, 'D2')).to.be.undefined;
		expect(lastSeenFor(markers, 'D3')).to.be.undefined;
		expect(lastSeenFor(undefined, 'D1')).to.be.undefined;
	});

	it('counts only rows newer than the marker; never-seen channels count everything', () => {
		const markers = { [encodeChannelKey('D1')]: new Date('2026-07-20T10:00:00Z') };
		const rows = [
			{ channelExternalId: 'D1', createdAt: new Date('2026-07-20T09:00:00Z') }, // seen
			{ channelExternalId: 'D1', createdAt: new Date('2026-07-20T11:00:00Z') }, // unread
			{ channelExternalId: 'D1', createdAt: '2026-07-20T12:00:00Z' }, // unread (string date)
			{ channelExternalId: 'C9', createdAt: new Date('2026-07-01T00:00:00Z') }, // never seen -> unread
		];
		const counts = storeUnreadCounts(rows, markers);
		expect(counts.get('D1')).to.equal(2);
		expect(counts.get('C9')).to.equal(1);
	});

	it('boundary: a row exactly AT the marker is seen; junk rows are dropped', () => {
		const at = new Date('2026-07-20T10:00:00Z');
		const markers = { [encodeChannelKey('D1')]: at };
		const counts = storeUnreadCounts(
			[
				{ channelExternalId: 'D1', createdAt: at },
				{ channelExternalId: '', createdAt: at },
				{ channelExternalId: 'D1', createdAt: 'garbage' },
			],
			markers,
		);
		expect(counts.size).to.equal(0);
	});
});
