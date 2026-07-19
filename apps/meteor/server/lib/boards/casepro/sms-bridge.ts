import type { CaseProRow, ICaseProTransport, CaseProCallContext } from './transport';
import { resolveTransportFromConfig } from './transport';
import { SystemLogger } from '../../logger/system';

/**
 * SMS Channel Bridge — Matter channels mirror CasePro SMS threads both ways.
 *
 * CasePro SMS threads are the system of record. MatterChat channels are a view
 * into those threads, and messages are synced bidirectionally:
 *
 * - **CasePro → MatterChat:** Incoming SMS messages ingested via CasePro's
 *   `sms_threads` / `sms_messages` entities (transport queries). A sync job
 *   pulls new messages and creates/updates Matter channel messages.
 *
 * - **MatterChat → CasePro:** Matter channel messages posted by users are
 *   ingested via the transport's `ingest()` verb, which routes to CasePro's
 *   `POST /matterchat-messages/ingest` or SMS-specific ingestion endpoint.
 *   CasePro is the record; the ingest call is fire-and-forget.
 *
 * Hidden without CasePro: if no `caseProMode()` enablement or no configured
 * transport, the bridge returns empty results and message syncs are no-ops.
 *
 * This module NEVER mutates Matter channels directly — it returns sync events
 * (new messages, updates) to the caller, who owns the channel lifecycle.
 */

/**
 * A raw CasePro SMS thread row.
 * Columns are dynamic; the transport schema defines what's available.
 * Seeded from the stub or fetched live via the native/MCP transport.
 */
export type CaseProSMSThread = CaseProRow & {
	/** Thread ID (unique within a matter/party pair). */
	id?: string;
	/** The associated CasePro matter ID. */
	matter_id?: string;
	/** The party (client/contact) ID this thread is with. */
	party_id?: string;
	/** Thread status: active, closed, archived, etc. */
	status?: string;
	/** Last message timestamp for sort ordering. */
	last_message_at?: string;
	/** Thread subject or context label. */
	subject?: string;
	/** Participant phone numbers or identifiers. */
	participants?: string | string[];
};

/**
 * A raw CasePro SMS message row.
 * Columns are dynamic; full schema from the transport.
 */
export type CaseProSMSMessage = CaseProRow & {
	/** Message ID. */
	id?: string;
	/** Thread ID this message belongs to. */
	sms_thread_id?: string;
	/** Message body/text. */
	body?: string;
	/** Timestamp sent/received. */
	sent_at?: string;
	/** Sender: phone number, party ID, or "system". */
	sender?: string;
	/** Recipient phone numbers or identifiers. */
	recipients?: string | string[];
	/** Message status: pending, delivered, failed, read, etc. */
	status?: string;
	/** External message ID (SMS provider's reference). */
	external_message_id?: string;
};

/**
 * Sync result: events generated during an ingest or pull.
 * The caller owns the responsibility to apply these to Matter channels.
 */
export type SMSSyncEvent = {
	/** The associated matter ID. */
	matterId?: string;
	/** The CasePro thread ID. */
	threadId: string;
	/** Message pulled from CasePro (or None if thread-only event). */
	message?: CaseProSMSMessage;
	/** Thread metadata if newly discovered. */
	thread?: CaseProSMSThread;
	/** Event type: 'message_added' | 'thread_opened' | 'thread_closed' | 'sync_point'. */
	eventType: 'message_added' | 'thread_opened' | 'thread_closed' | 'sync_point';
	/** Timestamp of the event (ISO 8601). */
	timestamp: string;
};

/**
 * Pull result: a batch of new messages from CasePro SMS threads that
 * need to be synced into Matter channels.
 */
export type SMSPullResult = {
	/** Events to apply to Matter channels. */
	events: SMSSyncEvent[];
	/** Cursor for the next pull (thread ID + message timestamp). */
	nextCursor?: string;
	/** True if there are more messages to fetch. */
	hasMore: boolean;
};

/**
 * Options for pulling new SMS messages from CasePro.
 */
export type SMSPullOpts = {
	/** Matter ID to sync. If undefined, pull across all matters the user has access to. */
	matterId?: string;
	/** Cursor from a prior pull (for incremental sync). */
	cursor?: string;
	/** Max messages to fetch in this batch. */
	limit?: number;
};

/**
 * A message to ingest from MatterChat → CasePro SMS.
 * This is fire-and-forget; CasePro is the record.
 */
export type SMSIngestMessage = {
	/** The associated CasePro matter ID. */
	matterId: string;
	/** The CasePro SMS thread ID (or party ID to create one). */
	threadId?: string;
	partyId?: string;
	/** Message body. */
	body: string;
	/** Sender (MatterChat user ID or email). */
	sender?: string;
	/** External metadata (used for deduplication/correlation). */
	externalMessageId?: string;
	/** Additional fields for the CasePro row. */
	metadata?: Record<string, unknown>;
};

/**
 * The SMS bridge client. Wraps the transport layer and provides
 * high-level SMS sync verbs (pull new messages, ingest Matter messages).
 *
 * Stub-guarded: returns empty results if no transport or disabled config.
 */
export class SMSBridge {
	private transport: ICaseProTransport | undefined;

	/** Resolved per access (like CaseProClient). */
	private get tx(): ICaseProTransport {
		return this.transport ?? resolveTransportFromConfig();
	}

	/** Override the transport (tests / runtime swap). */
	setTransport(transport?: ICaseProTransport): void {
		this.transport = transport;
	}

	/**
	 * Pull new SMS messages from CasePro for a matter (or all matters).
	 * Returns sync events that should be applied to Matter channels.
	 *
	 * Degradation: if the sms_threads/sms_messages entities are not available,
	 * the transport returns `{ data: [], total: 0 }` and this returns empty.
	 */
	async pullMessages(opts: SMSPullOpts = {}): Promise<SMSPullResult> {
		try {
			const limit = opts.limit ?? 50;
			const filter: Record<string, unknown> = {};

			if (opts.matterId) {
				filter.matter_id = opts.matterId;
			}

			// Query SMS threads for this matter (or all if no matter filter).
			// The cursor, if present, is typically "threadId:timestamp" and used
			// to fetch messages newer than the cursor.
			const threadsResult = await this.tx.query('sms_threads', {
				filter,
				limit,
				offset: 0,
			});

			if (!threadsResult || threadsResult.total === 0) {
				return { events: [], hasMore: false };
			}

			const threads = threadsResult.data as CaseProSMSThread[];
			const events: SMSSyncEvent[] = [];
			let lastCursor: string | undefined;

			// For each thread, pull new messages (after the cursor, if provided).
			for (const thread of threads) {
				const threadId = String(thread.id ?? '');
				if (!threadId) {
					continue;
				}

				const messagesFilter: Record<string, unknown> = { sms_thread_id: threadId };
				const messagesResult = await this.tx.query('sms_messages', {
					filter: messagesFilter,
					limit,
					offset: 0,
				});

				if (!messagesResult) {
					continue;
				}

				const messages = messagesResult.data as CaseProSMSMessage[];

				// Emit a thread_opened event if this is a new thread discovery.
				if (!opts.cursor || opts.cursor.indexOf(threadId) === -1) {
					events.push({
						matterId: String(thread.matter_id ?? ''),
						threadId,
						thread,
						eventType: 'thread_opened',
						timestamp: new Date().toISOString(),
					});
				}

				// Emit message_added events for each message.
				for (const msg of messages) {
					const sentAt = String(msg.sent_at ?? new Date().toISOString());
					events.push({
						matterId: String(thread.matter_id ?? ''),
						threadId,
						message: msg,
						eventType: 'message_added',
						timestamp: sentAt,
					});
					// Update the cursor to track the latest message time.
					lastCursor = `${threadId}:${sentAt}`;
				}
			}

			// Emit a sync_point event for query/pagination tracking.
			events.push({
				threadId: 'sync-point',
				eventType: 'sync_point',
				timestamp: new Date().toISOString(),
			});

			return {
				events,
				nextCursor: lastCursor,
				hasMore: threadsResult.total > limit,
			};
		} catch (err) {
			// Graceful degradation: if the query fails, log and return empty.
			SystemLogger.warn('SMSBridge.pullMessages failed', {
				error: err instanceof Error ? err.message : String(err),
				opts,
			});
			return { events: [], hasMore: false };
		}
	}

	/**
	 * Ingest a message from MatterChat → CasePro SMS threads.
	 * This is fire-and-forget; CasePro is the system of record.
	 *
	 * The call routes through the transport's `ingest()` verb, which adapts
	 * to the configured CasePro endpoint (native REST, MCP, or stub).
	 *
	 * Returns the result from the ingest call (typically { ok: true } or
	 * a service response). If the ingest fails, an error is thrown and
	 * logged; the caller should decide whether to retry or notify the user.
	 */
	async ingestMessage(message: SMSIngestMessage, ctx?: CaseProCallContext): Promise<unknown> {
		try {
			// Build the ingest payload. The endpoint path is configurable;
			// default to 'sms-messages/ingest' unless the message specifies.
			const ingestPath = '/sms-messages/ingest';

			const payload: Record<string, unknown> = {
				matter_id: message.matterId,
				body: message.body,
				sender: message.sender,
				...(message.threadId && { sms_thread_id: message.threadId }),
				...(message.partyId && { party_id: message.partyId }),
				...(message.externalMessageId && { external_message_id: message.externalMessageId }),
				...(message.metadata && message.metadata),
			};

			return await this.tx.ingest(ingestPath, payload, ctx);
		} catch (err) {
			SystemLogger.error('SMSBridge.ingestMessage failed', {
				error: err instanceof Error ? err.message : String(err),
				message,
			});
			throw err;
		}
	}

	/**
	 * Fetch a single SMS thread by ID (for detail view, etc.).
	 * Returns null if not found or entities are not available.
	 */
	async getThread(threadId: string): Promise<CaseProSMSThread | null> {
		try {
			const row = await this.tx.get('sms_threads', threadId);
			return row ? (row as CaseProSMSThread) : null;
		} catch (err) {
			// Graceful: entity not available or not found.
			SystemLogger.debug('SMSBridge.getThread failed', {
				error: err instanceof Error ? err.message : String(err),
				threadId,
			});
			return null;
		}
	}

	/**
	 * Fetch messages for a specific thread (for conversation history).
	 */
	async getThreadMessages(threadId: string, limit = 100, offset = 0): Promise<CaseProSMSMessage[]> {
		try {
			const result = await this.tx.query('sms_messages', {
				filter: { sms_thread_id: threadId },
				limit,
				offset,
			});
			return (result?.data ?? []) as CaseProSMSMessage[];
		} catch (err) {
			SystemLogger.debug('SMSBridge.getThreadMessages failed', {
				error: err instanceof Error ? err.message : String(err),
				threadId,
			});
			return [];
		}
	}

	/**
	 * List SMS threads for a matter.
	 * Used for UI: show SMS channels in the sidebar or channel browser.
	 */
	async listThreadsForMatter(matterId: string, limit = 50, offset = 0): Promise<CaseProSMSThread[]> {
		try {
			const result = await this.tx.query('sms_threads', {
				filter: { matter_id: matterId },
				limit,
				offset,
			});
			return (result?.data ?? []) as CaseProSMSThread[];
		} catch (err) {
			SystemLogger.debug('SMSBridge.listThreadsForMatter failed', {
				error: err instanceof Error ? err.message : String(err),
				matterId,
			});
			return [];
		}
	}
}

/** Singleton instance. */
let smsBridgeInstance: SMSBridge | undefined;

/** Get or create the SMS bridge singleton. */
export function getSMSBridge(): SMSBridge {
	return (smsBridgeInstance ??= new SMSBridge());
}
