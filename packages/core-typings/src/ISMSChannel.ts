/**
 * SMS Channel — a MatterChat room synced to a CasePro SMS thread.
 *
 * An SMS channel is a bidirectional bridge between a MatterChat room (or DM)
 * and a CasePro SMS thread. Messages are synced both ways; CasePro is the
 * system of record.
 *
 * The channel is hidden/unavailable if CasePro is not configured or enabled.
 */

/**
 * SMS channel metadata stored in the MatterChat room document.
 * Keyed under `room.sms` or as a room sub-type indicator.
 */
export interface ISMSChannel {
	/** Whether SMS sync is enabled for this room. */
	enabled: boolean;

	/** The associated CasePro SMS thread ID. */
	caseProThreadId: string;

	/** The associated CasePro matter ID (for reference and filtering). */
	caseProMatterId: string;

	/** The CasePro party ID this thread is with (client/contact). */
	caseProPartyId?: string;

	/** Last sync timestamp: when new messages from CasePro were last pulled. */
	lastSyncAt?: string;

	/** Cursor for incremental sync (thread ID + message timestamp). */
	syncCursor?: string;

	/** Status: 'active' | 'closed' | 'archived'. */
	status?: string;

	/** Thread subject or context label from CasePro. */
	subject?: string;
}

/**
 * SMS message metadata stored on individual room messages.
 * Keyed under `message.sms` to correlate with the CasePro SMS message.
 */
export interface ISMSMessage {
	/** The CasePro SMS message ID (for deduplication and updates). */
	caseProMessageId: string;

	/** Sender as tracked by CasePro (phone number, party ID, or "system"). */
	casePro Sender?: string;

	/** External SMS provider's message ID (Twilio, Bandwidth, etc.). */
	externalMessageId?: string;

	/** Status from CasePro: 'pending' | 'delivered' | 'failed' | 'read' | etc. */
	caseProStatus?: string;

	/** Timestamp from CasePro (may differ slightly from room message timestamp). */
	caseProSentAt?: string;
}

/**
 * Sync event: a change detected during a pull or ingest that affects a room.
 * Used internally by the sync job to drive message creation/updates.
 */
export type ISMSSyncEvent = 'message_added' | 'message_updated' | 'thread_opened' | 'thread_closed' | 'sync_point';
