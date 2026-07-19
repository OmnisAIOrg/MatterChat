import { Subscriptions, Rooms, Messages } from '@rocket.chat/models';
import { SystemLogger } from '../../logger/system';
import { getSMSBridge, type SMSSyncEvent } from './sms-bridge';
import type { ISMSChannel, ISMSMessage } from '@rocket.chat/core-typings';

/**
 * SMS Sync Job — pulls new SMS messages from CasePro and creates MatterChat room messages.
 *
 * This job runs on an interval (default: every 30 seconds when SMS channels are active).
 * For each room with SMS enabled:
 *
 * 1. Query CasePro for new SMS messages (using cursor for incremental sync).
 * 2. Emit sync events (message_added, thread_opened, thread_closed).
 * 3. Create corresponding MatterChat room messages.
 * 4. Update the room's sync cursor.
 * 5. Handle errors gracefully (log, continue to next room).
 *
 * The sync is idempotent: duplicate messages are deduplicated via the CasePro
 * message ID stored on the room message.
 */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Sync SMS messages for a specific room.
 * Returns the number of new messages synced, or undefined if the room
 * is not an SMS channel or the sync failed.
 */
export async function syncSMSRoomMessages(roomId: string): Promise<number | undefined> {
	try {
		const room = await Rooms.findOneById(roomId);
		if (!room) {
			return undefined;
		}

		// Check if the room has SMS enabled.
		const smsConfig = (room as any).sms as ISMSChannel | undefined;
		if (!smsConfig?.enabled || !smsConfig.caseProThreadId || !smsConfig.caseProMatterId) {
			return undefined;
		}

		const bridge = getSMSBridge();
		const pullResult = await bridge.pullMessages({
			matterId: smsConfig.caseProMatterId,
			cursor: smsConfig.syncCursor,
			limit: 50,
		});

		if (!pullResult || pullResult.events.length === 0) {
			return 0;
		}

		// Process sync events: create room messages for new SMS messages.
		let messagesAdded = 0;
		for (const event of pullResult.events) {
			if (event.eventType === 'message_added' && event.message) {
				const { message } = event;
				const caseProMessageId = str(message.id);
				if (!caseProMessageId) {
					continue;
				}

				// Deduplicate: check if this message already exists in the room.
				const existing = await Messages.findOne({
					rid: roomId,
					['sms.caseProMessageId']: caseProMessageId,
				});
				if (existing) {
					continue;
				}

				// Create a MatterChat room message.
				const smsMessage: ISMSMessage = {
					caseProMessageId,
					caseProStatus: str(message.status),
					caseProSentAt: str(message.sent_at),
					externalMessageId: str(message.external_message_id),
				};

				const newMessage = {
					rid: roomId,
					msg: str(message.body) || '(empty SMS message)',
					ts: new Date(str(message.sent_at) || new Date()),
					sms: smsMessage,
					// Mark the message as system-generated (not from a MatterChat user).
					_updatedAt: new Date(),
					// Store the sender for display (phone number, etc.).
					u: {
						_id: 'sms-system',
						name: `SMS: ${str(message.sender) || 'Unknown'}`,
						username: 'sms-system',
					},
				};

				try {
					await Messages.insertOne(newMessage);
					messagesAdded += 1;
				} catch (err) {
					// E11000 or other DB error; continue to next message.
					SystemLogger.debug('SMSSync: failed to insert message', {
						roomId,
						caseProMessageId,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}
		}

		// Update the room's sync cursor so the next pull skips already-synced messages.
		if (pullResult.nextCursor) {
			const syncUpdate: Partial<ISMSChannel> = { syncCursor: pullResult.nextCursor };
			if (pullResult.events.length > 0) {
				syncUpdate.lastSyncAt = new Date().toISOString();
			}
			await Rooms.updateOne({ _id: roomId }, { $set: { sms: syncUpdate } });
		}

		return messagesAdded;
	} catch (err) {
		SystemLogger.warn('SMSSync: syncSMSRoomMessages failed', {
			roomId,
			error: err instanceof Error ? err.message : String(err),
		});
		return undefined;
	}
}

/**
 * Sync all SMS-enabled rooms in the workspace.
 * Called periodically by a job scheduler. Returns the total messages synced.
 */
export async function syncAllSMSMessages(): Promise<number> {
	try {
		// Find all rooms with SMS enabled.
		const smsRooms = await Rooms.find({ 'sms.enabled': true }).toArray();
		if (smsRooms.length === 0) {
			return 0;
		}

		let totalSynced = 0;
		for (const room of smsRooms) {
			const synced = await syncSMSRoomMessages(room._id);
			if (synced !== undefined) {
				totalSynced += synced;
			}
		}

		if (totalSynced > 0) {
			SystemLogger.debug('SMSSync: synced messages', { totalSynced, roomCount: smsRooms.length });
		}

		return totalSynced;
	} catch (err) {
		SystemLogger.error('SMSSync: syncAllSMSMessages failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		return 0;
	}
}

/**
 * Ingest a message from MatterChat → CasePro SMS.
 * Called when a user posts a message in an SMS-enabled channel.
 *
 * This is fire-and-forget: CasePro is the record, and the message
 * is queued for delivery (SMS provider integration is on CasePro's side).
 */
export async function ingestSMSMessage(roomId: string, messageId: string, messageBody: string, userId?: string): Promise<void> {
	try {
		const room = await Rooms.findOneById(roomId);
		if (!room) {
			return;
		}

		const smsConfig = (room as any).sms as ISMSChannel | undefined;
		if (!smsConfig?.enabled || !smsConfig.caseProThreadId || !smsConfig.caseProMatterId) {
			return;
		}

		const bridge = getSMSBridge();

		// Resolve the user's email or name for the sender field.
		let sender = userId;
		if (userId) {
			const user = await (await import('@rocket.chat/models')).Users.findOneById(userId);
			sender = user?.email || user?.name || userId;
		}

		// Ingest the message. Deduplication is via the messageId stored in CasePro.
		await bridge.ingestMessage(
			{
				matterId: smsConfig.caseProMatterId,
				threadId: smsConfig.caseProThreadId,
				body: messageBody,
				sender,
				externalMessageId: messageId, // Correlation: this MatterChat message ID.
			},
			{ actingUserId: userId },
		);
	} catch (err) {
		SystemLogger.warn('SMSSync: ingestSMSMessage failed', {
			roomId,
			messageId,
			error: err instanceof Error ? err.message : String(err),
		});
		// Don't re-throw: ingest failures should not block the user's message in MatterChat.
	}
}
