import { expect } from 'chai';
import { describe, it } from 'mocha';

import { htmlToText, mapGraphMessage } from '../../../../app/connectors/server/providers/teams/messageMapping';

const CHANNEL = 'team-guid|19:abc@thread.tacv2';

describe('Teams message mapping', () => {
	describe('htmlToText', () => {
		it('strips tags, decodes entities, collapses whitespace', () => {
			expect(htmlToText('<p>Hello <b>world</b> &amp; friends</p>')).to.equal('Hello world & friends');
			expect(htmlToText('line1<br/>line2')).to.equal('line1\nline2');
			expect(htmlToText('<div>a</div><div>b</div>')).to.equal('a\nb');
			expect(htmlToText('&lt;tag&gt; &quot;q&quot; &#39;s&#39;&nbsp;x')).to.equal('<tag> "q" \'s\' x');
		});
	});

	describe('mapGraphMessage', () => {
		const base = {
			id: '1616990032035',
			messageType: 'message',
			createdDateTime: '2026-07-01T12:00:00Z',
			body: { contentType: 'html' as const, content: '<p>Hi <b>there</b></p>' },
			from: { user: { id: 'aad-user-1', displayName: 'Jane Attorney' } },
		};

		it('maps a normal html message', () => {
			const mapped = mapGraphMessage(base, CHANNEL);
			expect(mapped).to.deep.equal({
				externalId: '1616990032035',
				channelExternalId: CHANNEL,
				authorExternalId: 'aad-user-1',
				authorDisplayName: 'Jane Attorney',
				text: 'Hi there',
				ts: '2026-07-01T12:00:00Z',
			});
		});

		it('keeps a text body as-is (trimmed)', () => {
			const mapped = mapGraphMessage({ ...base, body: { contentType: 'text', content: '  plain text  ' } }, CHANNEL);
			expect(mapped?.text).to.equal('plain text');
		});

		it('carries editedTs only when lastModified differs from created', () => {
			const same = mapGraphMessage({ ...base, lastModifiedDateTime: base.createdDateTime }, CHANNEL);
			expect(same?.editedTs).to.equal(undefined);
			const edited = mapGraphMessage({ ...base, lastModifiedDateTime: '2026-07-01T13:00:00Z' }, CHANNEL);
			expect(edited?.editedTs).to.equal('2026-07-01T13:00:00Z');
		});

		it('carries the thread root for replies', () => {
			const mapped = mapGraphMessage({ ...base, replyToId: '1616990000000' }, CHANNEL);
			expect(mapped?.threadExternalId).to.equal('1616990000000');
		});

		it('skips soft-deleted messages', () => {
			expect(mapGraphMessage({ ...base, deletedDateTime: '2026-07-01T14:00:00Z' }, CHANNEL)).to.equal(null);
		});

		it('skips system/event messages (no human from.user, or non-message type)', () => {
			expect(mapGraphMessage({ ...base, from: null }, CHANNEL)).to.equal(null);
			expect(mapGraphMessage({ ...base, from: {} }, CHANNEL)).to.equal(null);
			expect(mapGraphMessage({ ...base, messageType: 'systemEventMessage' }, CHANNEL)).to.equal(null);
		});

		it('skips id-less / null payloads', () => {
			expect(mapGraphMessage(null, CHANNEL)).to.equal(null);
			expect(mapGraphMessage({}, CHANNEL)).to.equal(null);
		});

		it('falls back cleanly when the display name is absent', () => {
			const mapped = mapGraphMessage({ ...base, from: { user: { id: 'aad-user-1' } } }, CHANNEL);
			expect(mapped?.authorExternalId).to.equal('aad-user-1');
			expect(mapped?.authorDisplayName).to.equal(undefined);
		});
	});
});
