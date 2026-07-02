/**
 * CasePro comms-log — wiring. Registers the afterSaveMessage hook that queues
 * messages from matter-linked rooms and flushes batched digests to the CasePro
 * ingest endpoint (`POST /matterchat-messages/ingest`, built in Crm-Backend
 * branch feature/matterchat-comms-ingest — idempotent per message id).
 *
 * Loaded from server/hooks/index.ts. The pure pieces live next door:
 *  - ./hookGate.ts — the per-message gate (matterId / toggles / system msgs)
 *  - ./batcher.ts  — batching, cursor resume, backoff (fully DI, unit-tested)
 *
 * Transport: rides caseProClient → ICaseProTransport.ingest — the SAME auth seam
 * (transport.ts authHeaders) the live-wire lane is wiring. No auth code here.
 */
import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { Messages, Rooms } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { settings } from '../../../app/settings/server';
import { caseProClient } from '../boards/casepro/client';
import { callbacks } from '../callbacks';
import { SystemLogger } from '../logger/system';
import type { CommsLogBatcherDeps, CommsLogMessage } from './batcher';
import { CommsLogBatcher } from './batcher';
import { evaluateMessageForCommsLog } from './hookGate';

const CALLBACK_ID = 'CasePro_Comms_Log_Out';
const TICK_MS = 10_000;
const RESUME_DELAY_MS = 15_000;

const isGloballyEnabled = (): boolean =>
	settings.get<boolean>('CasePro_Enabled') === true && settings.get<boolean>('CasePro_Comms_Log_Enabled') === true;

const senderName = (message: IMessage): string => message.alias || message.u?.name || message.u?.username || 'Unknown';

const toCommsLogMessage = (message: IMessage): CommsLogMessage => ({
	message_id: message._id,
	sender_name: senderName(message),
	sent_at: new Date(message.ts).toISOString(),
	text: message.msg,
});

export const commsLogDeps: CommsLogBatcherDeps = {
	async getRoomTarget(rid) {
		const room = await Rooms.findOneById<Pick<IRoom, '_id' | 'name' | 'fname' | 'matterId' | 'caseProCommsLog'>>(rid, {
			projection: { name: 1, fname: 1, matterId: 1, caseProCommsLog: 1 },
		});
		if (!room?.matterId) {
			return null;
		}
		return {
			rid,
			matterId: room.matterId,
			channelName: room.fname || room.name || rid,
			// Re-evaluated at flush time: toggling a channel off mid-queue stops traffic.
			enabled: isGloballyEnabled() && room.caseProCommsLog?.enabled !== false,
			cursorTs: room.caseProCommsLog?.lastLoggedTs ?? null,
		};
	},

	async fetchLoggableMessagesSince(rid, since, limit) {
		const docs = await Messages.find(
			{
				rid,
				ts: { $gt: since },
				t: { $exists: false }, // no system messages
				msg: { $exists: true, $ne: '' }, // no file-only messages
				_hidden: { $ne: true },
			},
			{ sort: { ts: 1 }, limit, projection: { msg: 1, ts: 1, u: 1, alias: 1 } },
		).toArray();
		return docs.map((doc) => ({ ...toCommsLogMessage(doc as IMessage), ts: doc.ts }));
	},

	async postBatch(_target, payload) {
		const ingestUrl = (settings.get<string>('CasePro_Comms_Log_Ingest_URL') || 'matterchat-messages/ingest').trim();
		await caseProClient.logMatterChannelMessages(ingestUrl, payload);
	},

	async setCursor(rid, lastTs, lastId) {
		await Rooms.updateOne(
			{ _id: rid },
			{ $set: { 'caseProCommsLog.lastLoggedTs': lastTs, 'caseProCommsLog.lastLoggedId': lastId } },
		);
	},

	onError(context, err) {
		SystemLogger.error({ msg: context, err: String(err) });
	},

	onInfo(msg) {
		SystemLogger.debug({ msg });
	},
};

export const commsLogBatcher = new CommsLogBatcher(commsLogDeps);

/**
 * afterSaveMessage — NEVER throws, never awaits; a comms-log failure must not
 * break message saving (same contract as the Teams bridge's onMessageSaved).
 */
function onMessageSaved(message: IMessage, room: IRoom | undefined): IMessage {
	try {
		const decision = evaluateMessageForCommsLog(message, room, isGloballyEnabled());
		if (decision.action === 'skip') {
			return message;
		}
		if (!decision.edited && !room?.caseProCommsLog?.lastLoggedTs) {
			// First-ever loggable message in this room: persist the start-of-logging
			// cursor immediately, so a restart before the first flush cannot lose the
			// window (the boot resume scan only covers rooms that have a cursor).
			// Guarded $exists filter ⇒ only the first writer wins.
			void Rooms.updateOne(
				{ '_id': room!._id, 'caseProCommsLog.lastLoggedTs': { $exists: false } },
				{ $set: { 'caseProCommsLog.lastLoggedTs': new Date(message.ts.getTime() - 1) } },
			).catch((err) => SystemLogger.error({ msg: 'comms-log: cursor init failed', rid: room!._id, err: String(err) }));
		}
		commsLogBatcher.noteMessageSaved(room!._id, { ts: message.ts }, decision.edited ? toCommsLogMessage(message) : undefined);
	} catch (err) {
		SystemLogger.error({ msg: 'comms-log hook failed (message unaffected)', rid: room?._id, err: String(err) });
	}
	return message;
}

/** Boot resume: any room whose cursor is behind its newest loggable message flushes on the first ticks. */
async function resumeRooms(): Promise<void> {
	if (!isGloballyEnabled()) {
		return;
	}
	try {
		const rooms = Rooms.find<Pick<IRoom, '_id' | 'caseProCommsLog'>>(
			{ 'matterId': { $exists: true }, 'caseProCommsLog.lastLoggedTs': { $exists: true } },
			{ projection: { _id: 1, caseProCommsLog: 1 } },
		);
		for await (const room of rooms) {
			if (room.caseProCommsLog?.enabled === false || !room.caseProCommsLog?.lastLoggedTs) {
				continue;
			}
			const [next] = await commsLogDeps.fetchLoggableMessagesSince(room._id, room.caseProCommsLog.lastLoggedTs, 1);
			if (next) {
				commsLogBatcher.resumeRoom(room._id);
			}
		}
	} catch (err) {
		SystemLogger.error({ msg: 'comms-log: boot resume scan failed', err: String(err) });
	}
}

let started = false;

export function startCaseProCommsLog(): void {
	if (started) {
		return;
	}
	started = true;
	callbacks.add(
		'afterSaveMessage',
		(message: IMessage, { room }: { room: IRoom }) => onMessageSaved(message, room),
		callbacks.priority.LOW,
		CALLBACK_ID,
	);
	setInterval(() => {
		commsLogBatcher.flushDue().catch((err) => SystemLogger.error({ msg: 'comms-log: tick failed', err: String(err) }));
	}, TICK_MS);
	setTimeout(() => {
		void resumeRooms();
	}, RESUME_DELAY_MS);
}

Meteor.startup(() => {
	startCaseProCommsLog();
});
