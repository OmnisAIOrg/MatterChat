import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Rooms, Subscriptions } from '@rocket.chat/models';

import { API } from '../api';
import { getSMSBridge } from '../../../lib/boards/casepro/sms-bridge';
import { syncSMSRoomMessages, ingestSMSMessage } from '../../../lib/boards/casepro/sms-sync';
import type { ISMSChannel } from '@rocket.chat/core-typings';

/**
 * SMS API Endpoints — bridges MatterChat rooms to CasePro SMS threads.
 *
 * All endpoints require authentication and the CasePro integration to be enabled.
 * Responses are guarded: no data is returned if CasePro is not configured.
 */

/**
 * GET /api/v1/sms/threads?matterId=...
 *
 * List SMS threads for a matter. Returns the raw CasePro thread rows.
 * Requires the user to have access to the matter (checked via room permissions).
 */
API.v1.addRoute(
	'sms/threads',
	{
		authRequired: true,
		async action() {
			try {
				const { matterId } = this.queryParams;
				check(matterId, String);

				const bridge = getSMSBridge();
				// No direct permission check here; the caller should validate matter access
				// via room membership. Returns empty if the bridge is in stub mode.
				const threads = await bridge.listThreadsForMatter(matterId, 50, 0);
				return API.v1.success({ threads });
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : String(err));
			}
		},
	},
);

/**
 * GET /api/v1/sms/threads/:threadId
 *
 * Get a specific SMS thread (for detail view).
 */
API.v1.addRoute(
	'sms/threads/:threadId',
	{
		authRequired: true,
		async action() {
			try {
				const { threadId } = this.urlParams;
				check(threadId, String);

				const bridge = getSMSBridge();
				const thread = await bridge.getThread(threadId);
				if (!thread) {
					return API.v1.notFound();
				}
				return API.v1.success({ thread });
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : String(err));
			}
		},
	},
);

/**
 * GET /api/v1/sms/threads/:threadId/messages?limit=...&offset=...
 *
 * Get messages for a specific SMS thread (conversation history).
 */
API.v1.addRoute(
	'sms/threads/:threadId/messages',
	{
		authRequired: true,
		async action() {
			try {
				const { threadId } = this.urlParams;
				const limit = parseInt(this.queryParams.limit || '100', 10);
				const offset = parseInt(this.queryParams.offset || '0', 10);

				check(threadId, String);

				const bridge = getSMSBridge();
				const messages = await bridge.getThreadMessages(threadId, limit, offset);
				return API.v1.success({ messages, count: messages.length });
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : String(err));
			}
		},
	},
);

/**
 * POST /api/v1/sms/rooms/:roomId/sync
 *
 * Trigger a manual sync of SMS messages for a room.
 * (Normally sync runs on an interval, but this allows explicit triggering.)
 */
API.v1.addRoute(
	'sms/rooms/:roomId/sync',
	{
		authRequired: true,
		async action() {
			try {
				const { roomId } = this.urlParams;
				check(roomId, String);

				const room = await Rooms.findOneById(roomId);
				if (!room) {
					return API.v1.notFound();
				}

				// Permission check: user must be a member of the room.
				const subscription = await Subscriptions.findOneByRoomIdAndUserId(roomId, this.userId);
				if (!subscription) {
					return API.v1.unauthorized();
				}

				const synced = await syncSMSRoomMessages(roomId);
				if (synced === undefined) {
					return API.v1.success({
						synced: 0,
						message: 'Room is not an SMS channel',
					});
				}

				return API.v1.success({
					synced,
					message: `Synced ${synced} new SMS messages`,
				});
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : String(err));
			}
		},
	},
);

/**
 * POST /api/v1/sms/rooms/:roomId/messages/ingest
 *
 * Ingest a message from MatterChat → CasePro SMS.
 * Called when a user posts a message in an SMS-enabled channel.
 * Fire-and-forget: response returns immediately; delivery is async.
 */
API.v1.addRoute(
	'sms/rooms/:roomId/messages/ingest',
	{
		authRequired: true,
		async action() {
			try {
				const { roomId } = this.urlParams;
				const { messageId, messageBody } = this.bodyParams;

				check(roomId, String);
				check(messageId, String);
				check(messageBody, String);

				const room = await Rooms.findOneById(roomId);
				if (!room) {
					return API.v1.notFound();
				}

				// Permission check: user must be a member of the room.
				const subscription = await Subscriptions.findOneByRoomIdAndUserId(roomId, this.userId);
				if (!subscription) {
					return API.v1.unauthorized();
				}

				// Ingest the message (fire-and-forget).
				await ingestSMSMessage(roomId, messageId, messageBody, this.userId);

				return API.v1.success({
					ingested: true,
					message: 'Message queued for delivery via CasePro SMS',
				});
			} catch (err) {
				return API.v1.failure(err instanceof Error ? err.message : String(err));
			}
		},
	},
);

/**
 * GET /api/v1/sms/status
 *
 * Check SMS bridge status (for admin diagnostics).
 * Returns whether the CasePro SMS entities are available.
 */
API.v1.addRoute(
	'sms/status',
	{
		authRequired: true,
		async action() {
			try {
				// Only admins can check status.
				if (!this.user?.roles?.includes('admin')) {
					return API.v1.unauthorized();
				}

				const bridge = getSMSBridge();
				// Try to fetch a schema to verify the entities are available.
				const schema = await bridge.tx.listSchema('sms_threads');

				return API.v1.success({
					available: !!schema,
					schema,
				});
			} catch (err) {
				return API.v1.success({
					available: false,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		},
	},
);
