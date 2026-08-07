import { Random } from '@rocket.chat/random';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Collection, IndexDescription } from 'mongodb';

import { db } from '../../database/utils';
import { SystemLogger } from '../logger/system';

/**
 * Upload-link records — a fork-owned collection (the `FirmFeed` pattern: raw
 * `db` access, no edits to the shared models barrels).
 *
 * ## The token is never stored
 *
 * An upload link is a **writable door into a matter workspace** handed to
 * someone with no account. We therefore store only a SHA-256 of the token, the
 * way a password would be handled: a leaked database dump yields no usable
 * links. The plaintext token exists exactly once, in the response to the create
 * call, and is never recoverable afterwards — "copy the link now" is a
 * deliberate consequence, not an oversight.
 *
 * Lookup is by hash, so it is a single indexed read; the `timingSafeEqual`
 * comparison then guards against a timing oracle on the stored digest.
 *
 * ## Counters are enforced here, not in the UI
 *
 * `usedCount` is incremented atomically as part of the same conditional update
 * that checks the cap, so two concurrent uploads cannot both pass a cap of one.
 * Expiry and revocation are re-checked on EVERY request rather than at issue
 * time.
 */

const COLLECTION_NAME = 'litbox_upload_links';

export type UploadLinkDestination =
	| { kind: 'matter'; matterId: string; matterName: string; workspaceId?: string }
	/** "My LitBox" — the creator's own workspace; touches no matter. */
	| { kind: 'personal' };

export type UploadLinkRecord = {
	_id: string;
	/** SHA-256 hex of the token. The token itself is never persisted. */
	tokenHash: string;
	destination: UploadLinkDestination;
	/** Free text shown on the upload page. */
	recipientLabel?: string;
	requestText?: string;
	/** Channel to notify on each upload, when the creator asked for it. */
	notifyRoomId?: string;
	notifyOnUpload: boolean;
	/** Send arriving files to AutoDoc, already bound to this matter. */
	sendToAutoDoc: boolean;
	/** bcrypt-free: a SHA-256 of the optional password, salted per link. */
	passwordHash?: string;
	passwordSalt?: string;
	maxFiles: number;
	maxFileBytes: number;
	usedCount: number;
	expiresAt?: Date;
	revokedAt?: Date;
	createdBy: { _id: string; username?: string };
	createdAt: Date;
	lastUsedAt?: Date;
};

const INDEXES: IndexDescription[] = [
	{ key: { tokenHash: 1 }, unique: true },
	{ key: { createdAt: -1 } },
	{ key: { 'destination.matterId': 1 } },
];

const collection: Collection<UploadLinkRecord> = db.collection<UploadLinkRecord>(COLLECTION_NAME);

let indexesEnsured = false;
const ensureIndexes = (): void => {
	if (indexesEnsured) {
		return;
	}
	indexesEnsured = true;
	collection.createIndexes(INDEXES).catch((err) => {
		SystemLogger.warn({ msg: 'LitBox upload links: failed to ensure indexes', err });
	});
};
ensureIndexes();

/** 32 bytes of CSPRNG entropy, base64url. Single-purpose and unguessable. */
export function mintToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function hashPassword(password: string, salt: string): string {
	return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

/** Constant-time compare of two hex digests of equal length. */
function digestsMatch(a: string, b: string): boolean {
	const bufA = Buffer.from(a, 'hex');
	const bufB = Buffer.from(b, 'hex');
	return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export type CreateUploadLinkInput = {
	destination: UploadLinkDestination;
	recipientLabel?: string;
	requestText?: string;
	notifyRoomId?: string;
	notifyOnUpload: boolean;
	sendToAutoDoc: boolean;
	password?: string;
	maxFiles: number;
	maxFileBytes: number;
	expiryDays?: number;
	createdBy: { _id: string; username?: string };
};

/** @returns the record plus the ONE-TIME plaintext token. */
export async function createUploadLink(input: CreateUploadLinkInput): Promise<{ record: UploadLinkRecord; token: string }> {
	const token = mintToken();
	const salt = input.password ? randomBytes(16).toString('hex') : undefined;

	const record: UploadLinkRecord = {
		_id: Random.id(),
		tokenHash: hashToken(token),
		destination: input.destination,
		...(input.recipientLabel ? { recipientLabel: input.recipientLabel } : {}),
		...(input.requestText ? { requestText: input.requestText } : {}),
		...(input.notifyRoomId ? { notifyRoomId: input.notifyRoomId } : {}),
		notifyOnUpload: input.notifyOnUpload,
		sendToAutoDoc: input.sendToAutoDoc,
		...(input.password && salt ? { passwordHash: hashPassword(input.password, salt), passwordSalt: salt } : {}),
		maxFiles: input.maxFiles,
		maxFileBytes: input.maxFileBytes,
		usedCount: 0,
		...(input.expiryDays ? { expiresAt: new Date(Date.now() + input.expiryDays * 24 * 60 * 60 * 1000) } : {}),
		createdBy: input.createdBy,
		createdAt: new Date(),
	};

	await collection.insertOne(record);
	return { record, token };
}

export type LinkRejection = 'not-found' | 'revoked' | 'expired' | 'exhausted' | 'bad-password';

/**
 * Resolve a token to a usable link. Expiry and revocation are checked HERE, on
 * every request, so revoking invalidates immediately rather than at next issue.
 */
export async function resolveUploadLink(token: string, password?: string): Promise<{ link: UploadLinkRecord } | { rejected: LinkRejection }> {
	const digest = hashToken(token);
	const link = await collection.findOne({ tokenHash: digest });
	if (!link || !digestsMatch(link.tokenHash, digest)) {
		return { rejected: 'not-found' };
	}
	if (link.revokedAt) {
		return { rejected: 'revoked' };
	}
	if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
		return { rejected: 'expired' };
	}
	if (link.usedCount >= link.maxFiles) {
		return { rejected: 'exhausted' };
	}
	if (link.passwordHash && link.passwordSalt) {
		if (!password || !digestsMatch(link.passwordHash, hashPassword(password, link.passwordSalt))) {
			return { rejected: 'bad-password' };
		}
	}
	return { link };
}

/**
 * Atomically claim one upload slot.
 *
 * The `usedCount: { $lt: maxFiles }` predicate and the `$inc` are one operation,
 * which is what makes the total-file cap hold under concurrent uploads. A
 * check-then-increment would not.
 */
export async function claimUploadSlot(linkId: string): Promise<boolean> {
	const now = new Date();
	const result = await collection.findOneAndUpdate(
		{
			_id: linkId,
			revokedAt: { $exists: false },
			$or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
			$expr: { $lt: ['$usedCount', '$maxFiles'] },
		},
		{ $inc: { usedCount: 1 }, $set: { lastUsedAt: now } },
		{ returnDocument: 'after' },
	);
	return Boolean(result);
}

/** Release a slot claimed for an upload that then failed. */
export async function releaseUploadSlot(linkId: string): Promise<void> {
	await collection.updateOne({ _id: linkId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
}

export async function listUploadLinks(filter: { matterId?: string; createdBy?: string } = {}): Promise<UploadLinkRecord[]> {
	return collection
		.find(
			{
				...(filter.matterId ? { 'destination.matterId': filter.matterId } : {}),
				...(filter.createdBy ? { 'createdBy._id': filter.createdBy } : {}),
			},
			{ sort: { createdAt: -1 }, limit: 100 },
		)
		.toArray();
}

export async function revokeUploadLink(linkId: string): Promise<boolean> {
	const result = await collection.updateOne({ _id: linkId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
	return result.modifiedCount > 0;
}

export async function findUploadLinkById(linkId: string): Promise<UploadLinkRecord | null> {
	return collection.findOne({ _id: linkId });
}

/** Test seam. */
export async function clearUploadLinks(): Promise<void> {
	await collection.deleteMany({});
}
