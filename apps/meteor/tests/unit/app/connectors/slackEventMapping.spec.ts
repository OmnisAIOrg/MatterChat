import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	extractMessageEvent,
	fileStubLines,
	slackTsToEpochMs,
	toProviderMessage,
} from '../../../../app/connectors/server/providers/slack/eventMessageMapping';

const CHANNEL = 'C0123456789';

describe('Slack event message mapping', () => {
	describe('extractMessageEvent — new messages', () => {
		it('extracts a plain channel message', () => {
			expect(
				extractMessageEvent({ type: 'message', channel: CHANNEL, channel_type: 'channel', user: 'U1', text: 'hello', ts: '1.000001' }),
			).to.deep.equal({ kind: 'new', channel: CHANNEL, ts: '1.000001', user: 'U1', text: 'hello' });
		});

		it('extracts a private-channel (group) message', () => {
			const action = extractMessageEvent({
				type: 'message',
				channel: 'G999',
				channel_type: 'group',
				user: 'U1',
				text: 'psst',
				ts: '2.0002',
			});
			expect(action).to.include({ kind: 'new', channel: 'G999' });
		});

		it('tolerates a missing channel_type (routing still requires a bridged channel)', () => {
			expect(extractMessageEvent({ type: 'message', channel: CHANNEL, user: 'U1', text: 'x', ts: '3.3' })).to.include({ kind: 'new' });
		});

		it('carries the thread root as threadTs for a reply (and not for a root)', () => {
			const reply = extractMessageEvent({
				type: 'message',
				channel: CHANNEL,
				channel_type: 'channel',
				user: 'U1',
				text: 're',
				ts: '5.000002',
				thread_ts: '5.000001',
			});
			expect(reply).to.deep.include({ kind: 'new', threadTs: '5.000001' });

			// A thread ROOT carries thread_ts === ts — that is not a reply.
			const root = extractMessageEvent({
				type: 'message',
				channel: CHANNEL,
				channel_type: 'channel',
				user: 'U1',
				text: 'root',
				ts: '5.000001',
				thread_ts: '5.000001',
			});
			expect(root && 'threadTs' in root ? root.threadTs : undefined).to.equal(undefined);
		});

		it('maps file attachments to link-out stubs', () => {
			const action = extractMessageEvent({
				type: 'message',
				channel: CHANNEL,
				channel_type: 'channel',
				user: 'U1',
				text: 'see attached',
				ts: '6.1',
				files: [
					{ id: 'F1', name: 'brief.pdf', mimetype: 'application/pdf', permalink: 'https://slack.example/f1', size: 123 },
					{ junk: true },
				],
			});
			expect(action).to.have.property('kind', 'new');
			expect((action as any).files).to.deep.equal([
				{ externalId: 'F1', name: 'brief.pdf', mimeType: 'application/pdf', url: 'https://slack.example/f1', size: 123 },
			]);
		});
	});

	describe('extractMessageEvent — echo prevention + skip rules', () => {
		it('skips bot-authored events (bot_id — including the connector app bot itself)', () => {
			expect(
				extractMessageEvent({
					type: 'message',
					channel: CHANNEL,
					channel_type: 'channel',
					bot_id: 'B1',
					text: 'beep',
					ts: '1.1',
					user: 'U1',
				}),
			).to.equal(null);
		});

		it('skips subtype/system messages (bot_message, channel_join, thread_broadcast)', () => {
			for (const subtype of ['bot_message', 'channel_join', 'thread_broadcast', 'channel_topic']) {
				expect(
					extractMessageEvent({ type: 'message', subtype, channel: CHANNEL, channel_type: 'channel', user: 'U1', ts: '1.1' }),
				).to.equal(null, subtype);
			}
		});

		it('skips authorless payloads and non-message events', () => {
			expect(extractMessageEvent({ type: 'message', channel: CHANNEL, channel_type: 'channel', text: 'x', ts: '1.1' })).to.equal(null);
			expect(extractMessageEvent({ type: 'reaction_added', channel: CHANNEL, user: 'U1' })).to.equal(null);
			expect(extractMessageEvent({ type: 'message', channel_type: 'channel', user: 'U1', ts: '1.1' })).to.equal(null); // no channel
		});

		it('skips unknown channel types (fail-closed)', () => {
			expect(extractMessageEvent({ type: 'message', channel: 'C1', channel_type: 'shared', user: 'U1', text: 'x', ts: '1.1' })).to.equal(
				null,
			);
			expect(extractMessageEvent({ type: 'message', channel: 'C1', channel_type: 42, user: 'U1', text: 'x', ts: '1.1' })).to.equal(null);
		});
	});

	describe('extractMessageEvent — DMs (im/mpim realtime)', () => {
		it('extracts a 1:1 DM (im) message', () => {
			expect(
				extractMessageEvent({ type: 'message', channel: 'D0AAAAAAAA1', channel_type: 'im', user: 'U1', text: 'dm hello', ts: '10.000001' }),
			).to.deep.equal({ kind: 'new', channel: 'D0AAAAAAAA1', ts: '10.000001', user: 'U1', text: 'dm hello' });
		});

		it('extracts a group DM (mpim) message', () => {
			expect(
				extractMessageEvent({ type: 'message', channel: 'G0BBBBBBBB2', channel_type: 'mpim', user: 'U2', text: 'group dm', ts: '11.5' }),
			).to.deep.equal({ kind: 'new', channel: 'G0BBBBBBBB2', ts: '11.5', user: 'U2', text: 'group dm' });
		});

		it('carries thread replies in DMs like channels', () => {
			const reply = extractMessageEvent({
				type: 'message',
				channel: 'D1',
				channel_type: 'im',
				user: 'U1',
				text: 're',
				ts: '12.000002',
				thread_ts: '12.000001',
			});
			expect(reply).to.deep.include({ kind: 'new', channel: 'D1', threadTs: '12.000001' });
		});

		it('applies the same bot/subtype skip rules inside DMs', () => {
			expect(
				extractMessageEvent({ type: 'message', channel: 'D1', channel_type: 'im', bot_id: 'B1', user: 'U1', text: 'beep', ts: '1.1' }),
			).to.equal(null);
			expect(
				extractMessageEvent({ type: 'message', subtype: 'channel_join', channel: 'G1', channel_type: 'mpim', user: 'U1', ts: '1.1' }),
			).to.equal(null);
		});

		it('maps DM edits (message_changed) to the ORIGINAL ts', () => {
			expect(
				extractMessageEvent({
					type: 'message',
					subtype: 'message_changed',
					channel: 'D1',
					channel_type: 'im',
					ts: '20.9',
					message: { type: 'message', user: 'U1', text: 'fixed', ts: '20.000001', edited: { user: 'U1', ts: '20.9' } },
				}),
			).to.deep.equal({ kind: 'edit', channel: 'D1', ts: '20.000001', user: 'U1', text: 'fixed', editedTs: '20.9' });
		});

		it('maps DM deletes (message_deleted) to the deleted ts', () => {
			expect(
				extractMessageEvent({
					type: 'message',
					subtype: 'message_deleted',
					channel: 'G1',
					channel_type: 'mpim',
					ts: '21.9',
					deleted_ts: '21.000001',
				}),
			).to.deep.equal({ kind: 'delete', channel: 'G1', ts: '21.000001' });
		});

		it('maps a DM action to the same IProviderMessage vocabulary as syncMessages', () => {
			const mapped = toProviderMessage({ kind: 'new', channel: 'D1', ts: '30.000001', user: 'U1', text: 'dm' }, 'Bob Builder');
			expect(mapped).to.deep.equal({
				externalId: '30.000001',
				channelExternalId: 'D1',
				authorExternalId: 'U1',
				authorDisplayName: 'Bob Builder',
				text: 'dm',
				ts: '30.000001',
			});
		});
	});

	describe('extractMessageEvent — edits', () => {
		it('extracts message_changed as an edit of the ORIGINAL ts', () => {
			expect(
				extractMessageEvent({
					type: 'message',
					subtype: 'message_changed',
					channel: CHANNEL,
					channel_type: 'channel',
					ts: '9.999999', // the event's own ts — NOT the message identity
					message: { type: 'message', user: 'U1', text: 'new text', ts: '7.000001', edited: { user: 'U1', ts: '9.999999' } },
				}),
			).to.deep.equal({ kind: 'edit', channel: CHANNEL, ts: '7.000001', user: 'U1', text: 'new text', editedTs: '9.999999' });
		});

		it('skips edits of bot messages and tombstoned/subtyped nested messages', () => {
			expect(
				extractMessageEvent({
					type: 'message',
					subtype: 'message_changed',
					channel: CHANNEL,
					message: { type: 'message', bot_id: 'B1', text: 'x', ts: '1.1' },
				}),
			).to.equal(null);
			expect(
				extractMessageEvent({
					type: 'message',
					subtype: 'message_changed',
					channel: CHANNEL,
					message: { type: 'message', subtype: 'tombstone', text: 'This message was deleted.', ts: '1.1' },
				}),
			).to.equal(null);
			expect(extractMessageEvent({ type: 'message', subtype: 'message_changed', channel: CHANNEL })).to.equal(null);
		});
	});

	describe('extractMessageEvent — deletes', () => {
		it('extracts message_deleted with the deleted ts', () => {
			expect(
				extractMessageEvent({
					type: 'message',
					subtype: 'message_deleted',
					channel: CHANNEL,
					channel_type: 'channel',
					ts: '9.9',
					deleted_ts: '7.000001',
				}),
			).to.deep.equal({ kind: 'delete', channel: CHANNEL, ts: '7.000001' });
		});

		it('skips message_deleted without a deleted_ts', () => {
			expect(extractMessageEvent({ type: 'message', subtype: 'message_deleted', channel: CHANNEL, ts: '9.9' })).to.equal(null);
		});
	});

	describe('toProviderMessage', () => {
		it('maps identically to syncMessages vocabulary (externalId/ts = raw Slack ts)', () => {
			const mapped = toProviderMessage(
				{ kind: 'new', channel: CHANNEL, ts: '7.000001', user: 'U1', text: 'hello', threadTs: '6.5' },
				'Alice Attorney',
			);
			expect(mapped).to.deep.equal({
				externalId: '7.000001',
				channelExternalId: CHANNEL,
				authorExternalId: 'U1',
				authorDisplayName: 'Alice Attorney',
				text: 'hello',
				ts: '7.000001',
				threadExternalId: '6.5',
			});
		});

		it('appends file link-out stubs to the text (file-only messages still surface)', () => {
			const files = [{ externalId: 'F1', name: 'brief.pdf', url: 'https://slack.example/f1' }];
			const withText = toProviderMessage({ kind: 'new', channel: CHANNEL, ts: '1.1', user: 'U1', text: 'see attached', files });
			expect(withText.text).to.equal('see attached\n[shared file: brief.pdf](https://slack.example/f1)');

			const fileOnly = toProviderMessage({ kind: 'new', channel: CHANNEL, ts: '1.1', user: 'U1', text: '', files });
			expect(fileOnly.text).to.equal('[shared file: brief.pdf](https://slack.example/f1)');
			expect(fileOnly.files).to.deep.equal(files);
		});

		it('omits authorDisplayName when unresolved (alias falls back to the id downstream)', () => {
			const mapped = toProviderMessage({ kind: 'new', channel: CHANNEL, ts: '1.1', user: 'U1', text: 'x' });
			expect(mapped).to.not.have.property('authorDisplayName');
		});

		it('carries editedTs for edits', () => {
			const mapped = toProviderMessage({ kind: 'edit', channel: CHANNEL, ts: '1.1', user: 'U1', text: 'x2', editedTs: '2.2' });
			expect(mapped.editedTs).to.equal('2.2');
		});
	});

	describe('helpers', () => {
		it('fileStubLines renders name+permalink, tolerating missing fields', () => {
			expect(fileStubLines(undefined)).to.equal('');
			expect(fileStubLines([{ externalId: 'F1' }])).to.equal('[shared file: F1]');
			expect(
				fileStubLines([
					{ externalId: 'F1', name: 'a.png', url: 'https://x/1' },
					{ externalId: 'F2', name: 'b.png' },
				]),
			).to.equal('[shared file: a.png](https://x/1)\n[shared file: b.png]');
		});

		it('slackTsToEpochMs converts seconds.micros and rejects junk', () => {
			expect(slackTsToEpochMs('1700000000.000005')).to.equal(1700000000000);
			expect(slackTsToEpochMs('junk')).to.equal(undefined);
		});
	});
});
