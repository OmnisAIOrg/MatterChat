import { Random } from '@rocket.chat/random';
import type { Collection, IndexDescription } from 'mongodb';

import { db } from '../../database/utils';
import { SystemLogger } from '../logger/system';

/**
 * The envelope ↔ matter ↔ document-type mapping.
 *
 * Stored **at send time**, because completion may arrive days later — a client
 * signs when they get round to it — and by then nothing in the request tells us
 * what should fire. Without this record a signed LOP is just a PDF.
 *
 * ## Idempotency
 *
 * Providers retry webhooks. Firing the LOP automation twice would double the
 * lien schedule entry, so completion is guarded by an atomic
 * `completedAt: { $exists: false }` → `$set` transition: exactly one delivery
 * wins the right to run the automations, and every retry is a no-op that still
 * returns 200 (a non-200 just makes the provider retry harder).
 */

const COLLECTION_NAME = 'omnisproof_envelopes';

export type EnvelopeStatus = 'sent' | 'viewed' | 'signed' | 'declined' | 'voided';

export type EnvelopeSigner = {
	name: string;
	email: string;
	role: 'client' | 'provider' | 'adjuster';
	/** Ordered signing. 1-based. */
	order: number;
};

export type AppliedStep = { label: string; ok: boolean; detail?: string };

export type EnvelopeRecord = {
	_id: string;
	/** Provider envelope id — the webhook's join key. */
	envelopeId: string;
	provider: string;
	documentName: string;
	documentRef?: string;
	signers: EnvelopeSigner[];
	/** Absent for a General (non-matter) send: nothing will fire. */
	matterId?: string;
	matterName?: string;
	/** Absent for a General send — a type is meaningless without a matter. */
	documentTypeKey?: string;
	/** Channel the send came from; receipts post here. */
	roomId?: string;
	sentBy: { _id: string; username?: string };
	status: EnvelopeStatus;
	sentAt: Date;
	viewedAt?: Date;
	viewCount: number;
	completedAt?: Date;
	/** What actually fired, recorded so the receipt and any audit agree. */
	appliedSteps?: AppliedStep[];
	signUrl?: string;
};

const INDEXES: IndexDescription[] = [
	{ key: { envelopeId: 1 }, unique: true },
	{ key: { status: 1, sentAt: -1 } },
	{ key: { matterId: 1 } },
];

const collection: Collection<EnvelopeRecord> = db.collection<EnvelopeRecord>(COLLECTION_NAME);

let indexesEnsured = false;
const ensureIndexes = (): void => {
	if (indexesEnsured) {
		return;
	}
	indexesEnsured = true;
	collection.createIndexes(INDEXES).catch((err) => {
		SystemLogger.warn({ msg: 'OmnisProof: failed to ensure envelope indexes', err });
	});
};
ensureIndexes();

export async function recordEnvelope(input: Omit<EnvelopeRecord, '_id' | 'status' | 'sentAt' | 'viewCount'>): Promise<EnvelopeRecord> {
	const record: EnvelopeRecord = {
		_id: Random.id(),
		status: 'sent',
		sentAt: new Date(),
		viewCount: 0,
		...input,
	};
	await collection.insertOne(record);
	return record;
}

export async function findEnvelope(envelopeId: string): Promise<EnvelopeRecord | null> {
	return collection.findOne({ envelopeId });
}

export async function listEnvelopes(filter: { matterId?: string } = {}): Promise<EnvelopeRecord[]> {
	return collection
		.find({ ...(filter.matterId ? { matterId: filter.matterId } : {}) }, { sort: { sentAt: -1 }, limit: 50 })
		.toArray();
}

/**
 * Record a view. `viewCount` earns its place: "viewed twice" and "never opened"
 * are exactly what a paralegal chasing a signature needs in order to decide
 * whether to nudge or phone.
 */
export async function markViewed(envelopeId: string): Promise<void> {
	await collection.updateOne(
		{ envelopeId, status: { $in: ['sent', 'viewed'] } },
		{ $set: { status: 'viewed', viewedAt: new Date() }, $inc: { viewCount: 1 } },
	);
}

/**
 * Claim the right to run completion automations for this envelope.
 *
 * @returns the record when THIS call won the race, `null` when the envelope is
 *          unknown or already completed (a provider retry). Callers must treat
 *          `null` as success-and-do-nothing, not as an error.
 */
export async function claimCompletion(envelopeId: string): Promise<EnvelopeRecord | null> {
	return collection.findOneAndUpdate(
		{ envelopeId, completedAt: { $exists: false } },
		{ $set: { completedAt: new Date(), status: 'signed' } },
		{ returnDocument: 'before' },
	);
}

export async function recordAppliedSteps(envelopeId: string, steps: AppliedStep[]): Promise<void> {
	await collection.updateOne({ envelopeId }, { $set: { appliedSteps: steps } });
}

export async function markTerminal(envelopeId: string, status: 'declined' | 'voided'): Promise<void> {
	await collection.updateOne({ envelopeId, completedAt: { $exists: false } }, { $set: { status, completedAt: new Date() } });
}

/** Test seam. */
export async function clearEnvelopes(): Promise<void> {
	await collection.deleteMany({});
}
