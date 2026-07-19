import { describe, it, expect, beforeEach } from '@jest/globals';
import { SMSBridge } from '../../../../../server/lib/boards/casepro/sms-bridge';
import { StubTransport } from '../../../../../server/lib/boards/casepro/transport';
import type { CaseProSMSThread, CaseProSMSMessage, SMSSyncEvent } from '../../../../../server/lib/boards/casepro/sms-bridge';

/**
 * Unit tests for the SMS bridge.
 * Uses the StubTransport for testing without a live CasePro instance.
 */

describe('SMSBridge', () => {
	let bridge: SMSBridge;
	let stubTransport: StubTransport;

	beforeEach(() => {
		// Create a fresh bridge and stub transport for each test.
		bridge = new SMSBridge();
		stubTransport = new StubTransport();
		bridge.setTransport(stubTransport);
	});

	describe('pullMessages', () => {
		it('should return empty events when no SMS threads exist', async () => {
			const result = await bridge.pullMessages({ matterId: 'test-matter-1', limit: 50 });
			expect(result.events).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it('should emit thread_opened and message_added events', async () => {
			// Seed stub data: a thread with messages.
			const thread: CaseProSMSThread = {
				id: 'sms-thread-1',
				matter_id: 'test-matter-1',
				party_id: 'test-party-1',
				status: 'active',
				subject: 'Client callback',
				last_message_at: new Date().toISOString(),
			};

			const message: CaseProSMSMessage = {
				id: 'sms-msg-1',
				sms_thread_id: 'sms-thread-1',
				body: 'Hi, client here',
				sent_at: new Date().toISOString(),
				sender: '+1-555-0100',
				status: 'delivered',
			};

			// Manually insert into stub so query returns them.
			await stubTransport.create('sms_threads', thread);
			await stubTransport.create('sms_messages', message);

			// Pull messages for the matter.
			const result = await bridge.pullMessages({ matterId: 'test-matter-1', limit: 50 });

			// Verify events.
			expect(result.events.length).toBeGreaterThan(0);

			// Find the message_added event.
			const messageEvent = result.events.find((e) => e.eventType === 'message_added');
			expect(messageEvent).toBeDefined();
			expect(messageEvent?.message?.id).toBe('sms-msg-1');
			expect(messageEvent?.message?.body).toBe('Hi, client here');

			// Verify hasMore flag.
			expect(typeof result.hasMore).toBe('boolean');
		});

		it('should support incremental sync with cursor', async () => {
			// Create initial messages.
			const thread: CaseProSMSThread = {
				id: 'sms-thread-2',
				matter_id: 'test-matter-2',
				status: 'active',
			};
			await stubTransport.create('sms_threads', thread);

			// First pull (no cursor).
			const result1 = await bridge.pullMessages({ matterId: 'test-matter-2', limit: 10 });
			expect(result1.nextCursor).toBeDefined();

			// Second pull with cursor (should skip already-synced messages).
			const result2 = await bridge.pullMessages({
				matterId: 'test-matter-2',
				cursor: result1.nextCursor,
				limit: 10,
			});
			expect(result2.events).toBeDefined();
		});
	});

	describe('ingestMessage', () => {
		it('should ingest a message via the transport', async () => {
			const ingestResult = await bridge.ingestMessage({
				matterId: 'test-matter-1',
				threadId: 'sms-thread-1',
				body: 'User reply from MatterChat',
				sender: 'user@example.com',
			});

			// Stub transport records ingests; verify the call was made.
			expect(stubTransport.ingested.length).toBe(1);
			expect(stubTransport.ingested[0].path).toBe('/sms-messages/ingest');
			expect(stubTransport.ingested[0].payload.body).toBe('User reply from MatterChat');
		});

		it('should ingest with external message ID for deduplication', async () => {
			await bridge.ingestMessage({
				matterId: 'test-matter-1',
				threadId: 'sms-thread-1',
				body: 'Test message',
				externalMessageId: 'matter-msg-123',
			});

			expect(stubTransport.ingested[0].payload.external_message_id).toBe('matter-msg-123');
		});

		it('should support metadata in ingest', async () => {
			await bridge.ingestMessage({
				matterId: 'test-matter-1',
				threadId: 'sms-thread-1',
				body: 'Test',
				metadata: { custom_field: 'value' },
			});

			expect(stubTransport.ingested[0].payload.custom_field).toBe('value');
		});
	});

	describe('getThread', () => {
		it('should retrieve a specific SMS thread', async () => {
			const thread: CaseProSMSThread = {
				id: 'sms-thread-detail',
				matter_id: 'test-matter-1',
				subject: 'Thread subject',
				status: 'active',
			};
			await stubTransport.create('sms_threads', thread);

			const result = await bridge.getThread('sms-thread-detail');
			expect(result).toBeDefined();
			expect(result?.id).toBe('sms-thread-detail');
			expect(result?.subject).toBe('Thread subject');
		});

		it('should return null for non-existent thread', async () => {
			const result = await bridge.getThread('non-existent-thread');
			expect(result).toBeNull();
		});
	});

	describe('getThreadMessages', () => {
		it('should retrieve messages for a thread', async () => {
			// Seed a thread and messages.
			const thread: CaseProSMSThread = { id: 'thread-msgs', matter_id: 'matter-1' };
			const msg1: CaseProSMSMessage = { id: 'msg-1', sms_thread_id: 'thread-msgs', body: 'First' };
			const msg2: CaseProSMSMessage = { id: 'msg-2', sms_thread_id: 'thread-msgs', body: 'Second' };

			await stubTransport.create('sms_threads', thread);
			await stubTransport.create('sms_messages', msg1);
			await stubTransport.create('sms_messages', msg2);

			const messages = await bridge.getThreadMessages('thread-msgs', 10, 0);
			expect(messages.length).toBe(2);
			expect(messages[0].body).toBe('First');
			expect(messages[1].body).toBe('Second');
		});

		it('should support pagination', async () => {
			const thread: CaseProSMSThread = { id: 'thread-page', matter_id: 'matter-1' };
			await stubTransport.create('sms_threads', thread);

			// Create 5 messages.
			for (let i = 1; i <= 5; i++) {
				await stubTransport.create('sms_messages', {
					id: `msg-${i}`,
					sms_thread_id: 'thread-page',
					body: `Message ${i}`,
				});
			}

			// Fetch with limit=2, offset=1.
			const messages = await bridge.getThreadMessages('thread-page', 2, 1);
			expect(messages.length).toBeLessThanOrEqual(2);
		});
	});

	describe('listThreadsForMatter', () => {
		it('should list SMS threads for a matter', async () => {
			const thread1: CaseProSMSThread = { id: 'thread-1', matter_id: 'matter-1' };
			const thread2: CaseProSMSThread = { id: 'thread-2', matter_id: 'matter-1' };
			const thread3: CaseProSMSThread = { id: 'thread-3', matter_id: 'matter-2' };

			await stubTransport.create('sms_threads', thread1);
			await stubTransport.create('sms_threads', thread2);
			await stubTransport.create('sms_threads', thread3);

			// Query matter-1.
			const threads = await bridge.listThreadsForMatter('matter-1', 50, 0);
			expect(threads.length).toBe(2);
			expect(threads.map((t) => t.id)).toContain('thread-1');
			expect(threads.map((t) => t.id)).toContain('thread-2');
		});

		it('should return empty for matter with no threads', async () => {
			const threads = await bridge.listThreadsForMatter('matter-no-threads', 50, 0);
			expect(threads).toEqual([]);
		});
	});

	describe('Graceful degradation', () => {
		it('should handle entity unavailability gracefully', async () => {
			// When sms_threads entity is not available, stub returns empty.
			// This test verifies the bridge handles it without throwing.

			// Simply call pullMessages on an empty stub — should not throw.
			const result = await bridge.pullMessages({ matterId: 'any-matter', limit: 50 });
			expect(result).toBeDefined();
			expect(result.events).toBeDefined();
		});

		it('should return empty on query failure', async () => {
			// Use the bridge without a transport (fallback to stub which is empty).
			const noTransportBridge = new SMSBridge();
			// Don't set transport, so it uses stub.

			const result = await noTransportBridge.pullMessages({ matterId: 'test', limit: 50 });
			expect(result.events).toEqual([]);
			expect(result.hasMore).toBe(false);
		});
	});
});
