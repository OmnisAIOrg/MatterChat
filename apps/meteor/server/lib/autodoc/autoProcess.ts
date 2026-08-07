import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { Uploads } from '@rocket.chat/models';
import type { Collection, IndexDescription } from 'mongodb';

import { resolveAutoDocConfig } from './config';
import { submitAutoDocDocument } from './client';
import { db } from '../../database/utils';
import { callbacks } from '../callbacks';
import { FileUpload } from '../media/file-upload';
import { SystemLogger } from '../logger/system';
import { postOmnisNote } from '../omnis/receipt';

/**
 * Auto-processing of PDFs posted to a matter channel.
 *
 * **The guards are required, not optional.** In a chat app people paste
 * screenshots, signed NDAs and lunch menus. Processing all of it fills the
 * review queue with junk and spends OCR credits on it, so:
 *
 *   1. per-channel toggle (`room.autodocAutoProcess`), OFF by default, and only
 *      offered on matter-linked channels;
 *   2. PDFs only;
 *   3. per-file size ceiling (`AutoDoc_Auto_Process_Max_MB`, default 25);
 *   4. per-channel daily ceiling (`AutoDoc_Auto_Process_Daily_Cap`, default 50)
 *      — and on hitting it we post ONE system message rather than silently
 *      dropping, because a silent drop is indistinguishable from a broken
 *      integration.
 *
 * The daily counter lives in a fork-owned collection (the `FirmFeed` pattern:
 * raw `db` access, no edits to the shared models barrels).
 */

const CALLBACK_ID = 'AutoDoc_AutoProcess';
const COLLECTION_NAME = 'autodoc_autoprocess_counters';

type AutoProcessCounter = {
	_id: string; // `${rid}:${yyyy-mm-dd}`
	rid: string;
	day: string;
	count: number;
	/** Set once the cap message has been posted, so it is posted exactly once per day. */
	capNotifiedAt?: Date;
	updatedAt: Date;
};

const INDEXES: IndexDescription[] = [
	{ key: { rid: 1, day: 1 } },
	// Counters are only meaningful for the current day; expire them a week later.
	{ key: { updatedAt: 1 }, expireAfterSeconds: 7 * 24 * 60 * 60 },
];

const collection: Collection<AutoProcessCounter> = db.collection<AutoProcessCounter>(COLLECTION_NAME);

let indexesEnsured = false;
const ensureIndexes = (): void => {
	if (indexesEnsured) {
		return;
	}
	indexesEnsured = true;
	collection.createIndexes(INDEXES).catch((err) => {
		SystemLogger.warn({ msg: 'AutoDoc: failed to ensure auto-process counter indexes', err });
	});
};

/** UTC day key. Deliberately UTC so the cap cannot be reset by a timezone change. */
export function dayKey(at: Date = new Date()): string {
	return at.toISOString().slice(0, 10);
}

export type AutoProcessDecision =
	| { process: true }
	| { process: false; reason: 'disabled' | 'not-matter-channel' | 'toggle-off' | 'not-pdf' | 'too-large' | 'daily-cap' };

/** Everything except the daily cap, which needs a counter read. */
export function screenAttachment(
	room: Pick<IRoom, 'matterId' | 'autodocAutoProcess'>,
	file: { type?: string; name?: string; size?: number },
	maxMb: number,
): AutoProcessDecision {
	if (!room.matterId) {
		return { process: false, reason: 'not-matter-channel' };
	}
	if (room.autodocAutoProcess !== true) {
		return { process: false, reason: 'toggle-off' };
	}

	const isPdf = file.type === 'application/pdf' || (file.name ?? '').toLowerCase().endsWith('.pdf');
	if (!isPdf) {
		return { process: false, reason: 'not-pdf' };
	}

	if (typeof file.size === 'number' && file.size > maxMb * 1024 * 1024) {
		return { process: false, reason: 'too-large' };
	}

	return { process: true };
}

/**
 * Reserve one slot against the channel's daily cap.
 *
 * Atomic: a single `findOneAndUpdate` with `$inc` is what makes two concurrent
 * uploads unable to both pass a cap of one.
 *
 * @returns `allowed`, and `justHitCap` exactly once per channel per day.
 */
export async function reserveDailySlot(rid: string, cap: number): Promise<{ allowed: boolean; justHitCap: boolean }> {
	ensureIndexes();
	if (cap <= 0) {
		return { allowed: false, justHitCap: false };
	}

	const day = dayKey();
	const _id = `${rid}:${day}`;
	const updated = await collection.findOneAndUpdate(
		{ _id },
		{ $inc: { count: 1 }, $set: { rid, day, updatedAt: new Date() } },
		{ upsert: true, returnDocument: 'after' },
	);

	const count = updated?.count ?? 1;
	if (count <= cap) {
		return { allowed: true, justHitCap: false };
	}

	// Over the cap. Claim the right to post the notice — the conditional update
	// means only the first over-cap upload of the day wins it.
	const claimed = await collection.findOneAndUpdate(
		{ _id, capNotifiedAt: { $exists: false } },
		{ $set: { capNotifiedAt: new Date() } },
		{ returnDocument: 'after' },
	);

	return { allowed: false, justHitCap: Boolean(claimed) };
}

/** Test seam. */
export async function resetDailyCounters(rid?: string): Promise<void> {
	await collection.deleteMany(rid ? { rid } : {});
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type MessageFile = { _id?: string; name?: string; type?: string; size?: number };

async function onMessageSaved(message: IMessage, room: IRoom): Promise<void> {
	const cfg = resolveAutoDocConfig();
	if (!cfg.enabled) {
		return;
	}

	const files: MessageFile[] = [
		...(message.files ?? []),
		...(message.file && !message.files?.length ? [message.file as MessageFile] : []),
	];
	if (files.length === 0) {
		return;
	}

	for (const file of files) {
		const decision = screenAttachment(room, file, cfg.autoProcessMaxMb);
		if (!decision.process) {
			continue;
		}

		const slot = await reserveDailySlot(room._id, cfg.autoProcessDailyCap);
		if (!slot.allowed) {
			if (slot.justHitCap) {
				await postOmnisNote(
					room._id,
					message.u._id,
					`AutoDoc auto-processing has hit this channel's daily limit of ${cfg.autoProcessDailyCap} documents. ` +
						`Further PDFs posted today will not be processed automatically — you can still send one with **Process with AutoDoc**.`,
				);
			}
			return;
		}

		try {
			const content = await readUploadedFile(file._id);
			if (!content) {
				continue;
			}
			await submitAutoDocDocument({
				filename: file.name ?? 'document.pdf',
				contentType: 'application/pdf',
				content,
				...(room.matterId ? { matterId: room.matterId } : {}),
				roomId: room._id,
				submittedBy: message.u._id,
			});
		} catch (err) {
			// Auto-processing is a convenience. It must never break message save,
			// and the file remains in the channel as a normal attachment.
			SystemLogger.warn({ msg: 'AutoDoc auto-process submit failed', rid: room._id, err });
		}
	}
}

/** Pull an uploaded file's bytes out of Rocket.Chat's upload store. */
export async function readUploadedFile(fileId?: string): Promise<Buffer | null> {
	if (!fileId) {
		return null;
	}
	const upload = await Uploads.findOneById(fileId);
	if (!upload) {
		return null;
	}
	return FileUpload.getBuffer(upload);
}

/**
 * Register the hook. Cheap gates run before anything else so a workspace with
 * auto-processing off pays nothing per message.
 */
export function registerAutoDocAutoProcess(): void {
	callbacks.add(
		'afterSaveMessage',
		(message: IMessage, { room }: { room: IRoom }) => {
			// Fast path: not a matter channel, or the toggle is off.
			if (!room?.matterId || room.autodocAutoProcess !== true) {
				return message;
			}
			void onMessageSaved(message, room).catch((err) => {
				SystemLogger.warn({ msg: 'AutoDoc auto-process hook failed', mid: message._id, err });
			});
			return message;
		},
		callbacks.priority.LOW,
		CALLBACK_ID,
	);
}
