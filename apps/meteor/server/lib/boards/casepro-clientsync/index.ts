import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { Messages, Rooms } from '@rocket.chat/models';

import { caseProClientMessagesClient, type CaseProClientMessage } from './client';
import { clientSyncEcho, clientSyncMessageId, isClientSyncMessageId } from './echoSuppression';
import { extractOutboundAttachments, mapInboundAttachments } from './fileSync';
import { ensureClientRoom, findClientRoom, getClientSyncBot } from './room';
import { settings } from '../../../../app/settings/server';
import { sendMessage } from '../../../../app/lib/server/functions/sendMessage';
import { SystemLogger } from '../../logger/system';

/**
 * CasePro CLIENT-message two-way sync ENGINE.
 *
 * DIRECTION 1 — inbound (client → firm): `pollMatter` reads new `client_messages` (from='client')
 * from the CasePro service endpoint and mirrors them into the matter's "Client" channel,
 * attributed to the client via a display alias (the client is NOT an RC user). Deterministic
 * `_id` (cpc-…) makes re-delivery idempotent.
 *
 * DIRECTION 2 — outbound (firm → client): `forwardOutbound` (called by the afterSaveMessage hook,
 * ./hook.ts) POSTs a staff message typed in a Client channel back to CasePro as a firm-side
 * (`direction='outbound'`) portal message, so it appears in the client's PWA.
 *
 * GATING: every entry point is a no-op unless BOTH CasePro_Enabled AND
 * CasePro_Client_Sync_Enabled are true. So "gating off = zero traffic".
 *
 * COORDINATION with the comms-auto-log lane (auto/casepro-comms-log): that lane logs the
 * INTERNAL matter channel's messages into CasePro's Communications tab; it filters on rooms with
 * `matterId` and NO `clientChannel`. THIS lane only ever touches rooms with `clientChannel: true`
 * and posts to the `client_messages` surface (not Communications). The two afterSaveMessage
 * subscribers use different hook ids and mutually-exclusive room filters — no collision.
 */

/** Both master switch and the client-sync toggle must be on. Read live so a flip takes effect. */
export function isClientSyncEnabled(): boolean {
	try {
		return Boolean(settings.get('CasePro_Enabled')) && Boolean(settings.get('CasePro_Client_Sync_Enabled'));
	} catch {
		return false;
	}
}

/**
 * Ingest ONE inbound client message into the Client channel. Idempotent: the deterministic
 * `_id` upserts onto itself, so a re-polled message never duplicates. Skips firm-origin rows
 * (our own echo) — those are the outbound leg's own POSTs coming back.
 */
async function ingestInbound(room: IRoom, matterId: string, msg: CaseProClientMessage): Promise<void> {
	if (msg.from !== 'client') {
		return; // firm-origin rows are our echo; guard 3 (persistent) — never re-inject.
	}
	if (clientSyncEcho.has(matterId, msg.id)) {
		return; // guard 1 (in-memory fast path).
	}

	const bot = await getClientSyncBot();
	if (!bot) {
		return;
	}

	const _id = clientSyncMessageId(matterId, msg.id);
	// Guard 3 (persistent): the deterministic id upserts onto itself — a re-polled message
	// never duplicates. Skipping the insert when it already exists also avoids a needless
	// afterSaveMessage re-fire.
	if (await Messages.findOneById(_id, { projection: { _id: 1 } })) {
		return;
	}

	// Reference-share: when file-sync is ON these are resolvable LitBox deep-links; when OFF
	// they are the reference STUBS (today's behaviour). Either way, NO bytes cross the bridge
	// and a bad file falls back to a note (see fileSync.mapInboundAttachment) — never blocking.
	const attachments = mapInboundAttachments(msg.attachments);
	const rcMessage: Partial<IMessage> & { _id: string; rid: string; msg: string } = {
		_id,
		rid: room._id,
		msg: msg.body,
		ts: new Date(msg.sentAt),
		u: { _id: bot._id, username: bot.username },
		// Render as the CLIENT via the alias mechanism — never a ghost RC account (same pattern
		// as the connectors bridge).
		alias: msg.author || 'Client',
		...(attachments ? { attachments } : {}),
		customFields: {
			caseproClientSync: {
				matterId,
				caseProMessageId: msg.id,
				inbound: true,
			},
		},
	};

	// Inner sendMessage with upsert — preserves our deterministic _id (executeSendMessage would
	// run impersonation/permission checks and not guarantee the _id). The outbound afterSaveMessage
	// hook skips this message by its cpc- prefix (guard 2), so no loop.
	await sendMessage(bot, rcMessage, room, { upsert: true });
}

/**
 * Poll one matter's Client channel: read messages newer than the room cursor and ingest them,
 * then advance the cursor to the newest ingested `sentAt`. Best-effort — errors are logged and
 * swallowed so one bad matter never stalls the sweep.
 */
export async function pollMatter(room: IRoom): Promise<number> {
	if (!isClientSyncEnabled() || !caseProClientMessagesClient.isConfigured() || !room.matterId || !room.clientChannel) {
		return 0;
	}
	const matterId = room.matterId;
	let ingested = 0;
	try {
		const messages = await caseProClientMessagesClient.listSince(matterId, room.clientSyncCursor);
		let newestSentAt = room.clientSyncCursor;
		for (const msg of messages) {
			await ingestInbound(room, matterId, msg);
			if (msg.from === 'client') {
				ingested += 1;
			}
			if (!newestSentAt || msg.sentAt > newestSentAt) {
				newestSentAt = msg.sentAt;
			}
		}
		if (newestSentAt && newestSentAt !== room.clientSyncCursor) {
			await Rooms.updateOne({ _id: room._id }, { $set: { clientSyncCursor: newestSentAt } });
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'casepro.clientSync.pollMatter.failed', matterId, err });
	}
	return ingested;
}

/**
 * The inbound sweep: poll every Client channel once. Called by the per-minute cron. Also
 * ensures a Client channel exists for any matter that already has an internal channel? — NO:
 * channel creation is on-demand (a firm links the client thread), so the sweep only polls
 * channels that already exist. Creating them proactively would leak a channel per matter.
 */
export async function runClientSyncSweep(): Promise<{ rooms: number; ingested: number }> {
	if (!isClientSyncEnabled() || !caseProClientMessagesClient.isConfigured()) {
		return { rooms: 0, ingested: 0 };
	}
	const cursor = Rooms.find({ clientChannel: true, matterId: { $exists: true } });
	let rooms = 0;
	let ingested = 0;
	for await (const room of cursor) {
		rooms += 1;
		ingested += await pollMatter(room);
	}
	return { rooms, ingested };
}

/**
 * Provision a Client channel for a matter on demand (firm action / when the client thread is
 * first linked). Returns the room id or null. Exposed for the REST/link path.
 */
export async function ensureClientChannel(matterId: string, matterNumber?: string, matterName?: string): Promise<string | null> {
	if (!isClientSyncEnabled()) {
		return null;
	}
	return ensureClientRoom(matterId, matterNumber, matterName);
}

/**
 * DIRECTION 2 — forward a staff message from a Client channel out to the CasePro portal.
 * Returns true when forwarded. Idempotent on the RC message `_id` (CasePro upserts on
 * `sourceMessageId`); the returned CasePro id is remembered so the next inbound poll drops
 * our own echo. Called only by the afterSaveMessage hook, already room-filtered.
 */
export async function forwardOutbound(message: IMessage, room: IRoom): Promise<boolean> {
	if (!isClientSyncEnabled() || !caseProClientMessagesClient.isConfigured()) {
		return false;
	}
	if (!room.clientChannel || !room.matterId) {
		return false; // not a Client channel — leave it for other subscribers (e.g. comms-log).
	}
	// Guard 2: never re-POST a message we ourselves injected inbound.
	if (isClientSyncMessageId(message._id)) {
		return false;
	}
	// Skip system messages, edits with no body, and empty posts.
	if (message.t || !message.msg?.trim()) {
		return false;
	}
	// Skip messages authored by the sync bot (inbound mirrors already excluded above, but the
	// bot should never originate an outbound anyway).
	const bot = await getClientSyncBot();
	if (bot && message.u?._id === bot._id) {
		return false;
	}

	try {
		// Reference-share outbound: forward any shared-LitBox doc references the staff message
		// carries so the PWA renders them natively. [] when file-sync is OFF or none present —
		// the POST then stays text-only. A file never blocks the outbound message.
		const attachments = extractOutboundAttachments(message);
		const caseProId = await caseProClientMessagesClient.postFirmMessage(room.matterId, {
			body: message.msg,
			authorName: message.u?.name || message.u?.username,
			sourceMessageId: message._id,
			...(attachments.length ? { attachments } : {}),
		});
		clientSyncEcho.add(room.matterId, caseProId);
		return true;
	} catch (err) {
		SystemLogger.warn({ msg: 'casepro.clientSync.forwardOutbound.failed', matterId: room.matterId, mid: message._id, err });
		return false;
	}
}

export { findClientRoom };
