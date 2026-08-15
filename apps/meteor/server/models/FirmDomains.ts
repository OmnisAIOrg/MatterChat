import { Random } from '@rocket.chat/random';
import type { Collection, IndexDescription, MongoServerError } from 'mongodb';

import { db } from '../database/utils';
import { SystemLogger } from '../lib/logger/system';

/**
 * MATTERCHAT: firm email-domain claims (`matterchat_firm_domains`).
 *
 * A fork-owned, self-contained collection — the same pattern as its sibling
 * `server/models/FirmFeed.ts`: it wraps the raw Mongo `db` from
 * `server/database/utils` directly and deliberately does NOT go
 * through the shared `@rocket.chat/models` registerModel/proxify machinery
 * (which would need edits to the packages/models + packages/model-typings
 * barrels and server/models.ts). That keeps the whole feature additive and
 * confined to our own files — see docs/design/MATTERCHAT-UI-CUSTOMIZATION-GUIDE.md.
 *
 * One document per claimed domain. `domain` is uniquely indexed because a
 * domain maps to exactly one firm globally: two firms auto-joining the same
 * domain would put the second firm's staff into the first firm's private team.
 */

const COLLECTION_NAME = 'matterchat_firm_domains';

/** How long a verification token stays usable. Long enough to survive a weekend. */
export const DOMAIN_VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000;

export type IFirmDomainClaim = {
	_id: string;
	/** Normalized, lowercase, punycode. Globally unique. */
	domain: string;
	/** The owning firm — the team `_id`, i.e. `customFields.firmId`. */
	firmId: string;
	firmName?: string;
	claimedBy: { _id: string; username?: string };
	verified: boolean;
	/** Present only while a verification is outstanding; cleared on success. */
	verificationToken?: string;
	/** The address at the domain the token was mailed to. */
	verificationEmail?: string;
	verificationExpiresAt?: Date;
	verificationSentAt?: Date;
	verifiedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
	_updatedAt: Date;
};

const INDEXES: IndexDescription[] = [
	// The safety property of the whole feature: one firm per domain.
	{ key: { domain: 1 }, unique: true, name: 'matterchat_firm_domain_unique' },
	{ key: { firmId: 1 } },
	{ key: { verificationToken: 1 }, sparse: true },
];

const collection: Collection<IFirmDomainClaim> = db.collection<IFirmDomainClaim>(COLLECTION_NAME);

let indexesEnsured = false;
const ensureIndexes = (): void => {
	if (indexesEnsured) {
		return;
	}
	indexesEnsured = true;
	// Fire-and-forget; index creation must never block a request.
	collection.createIndexes(INDEXES).catch((err) => {
		SystemLogger.warn({ msg: 'FirmDomains: failed to ensure indexes', err });
	});
};
ensureIndexes();

/** Mongo's duplicate-key code — the unique index firing, i.e. "someone else claimed it". */
export const isDuplicateKeyError = (err: unknown): boolean => (err as MongoServerError | undefined)?.code === 11000;

export type FirmDomainClaimInput = {
	domain: string;
	firmId: string;
	firmName?: string;
	claimedBy: IFirmDomainClaim['claimedBy'];
	verificationToken: string;
	verificationEmail: string;
};

export const FirmDomains = {
	findOneByDomain(domain: string): Promise<IFirmDomainClaim | null> {
		return collection.findOne({ domain });
	},

	/** The verified claim for a domain, if any — the only kind that grants membership. */
	findVerifiedByDomain(domain: string): Promise<IFirmDomainClaim | null> {
		return collection.findOne({ domain, verified: true });
	},

	findOneById(id: string): Promise<IFirmDomainClaim | null> {
		return collection.findOne({ _id: id });
	},

	findByFirmId(firmId: string): Promise<IFirmDomainClaim[]> {
		return collection.find({ firmId }, { sort: { createdAt: 1 } }).toArray();
	},

	/**
	 * Insert a pending claim. Throws a duplicate-key error (see
	 * `isDuplicateKeyError`) when the domain is already claimed — the pre-check
	 * in the service can lose a race, the unique index cannot.
	 */
	async create(input: FirmDomainClaimInput): Promise<IFirmDomainClaim> {
		const now = new Date();
		const doc: IFirmDomainClaim = {
			_id: Random.id(),
			domain: input.domain,
			firmId: input.firmId,
			...(input.firmName ? { firmName: input.firmName } : {}),
			claimedBy: input.claimedBy,
			verified: false,
			verificationToken: input.verificationToken,
			verificationEmail: input.verificationEmail,
			verificationSentAt: now,
			verificationExpiresAt: new Date(now.getTime() + DOMAIN_VERIFICATION_TTL_MS),
			createdAt: now,
			updatedAt: now,
			_updatedAt: now,
		};
		await collection.insertOne(doc);
		return doc;
	},

	/** Re-issue the token for an existing pending claim (the "resend" path). */
	async refreshVerification(id: string, token: string, verificationEmail: string): Promise<IFirmDomainClaim | null> {
		const now = new Date();
		await collection.updateOne(
			{ _id: id, verified: false },
			{
				$set: {
					verificationToken: token,
					verificationEmail,
					verificationSentAt: now,
					verificationExpiresAt: new Date(now.getTime() + DOMAIN_VERIFICATION_TTL_MS),
					updatedAt: now,
					_updatedAt: now,
				},
			},
		);
		return this.findOneById(id);
	},

	/**
	 * Consume a token. Atomic and single-use: the token is cleared in the same
	 * update that flips `verified`, so a replayed link cannot re-verify a claim
	 * that was since removed and re-created.
	 */
	async verifyByToken(token: string): Promise<IFirmDomainClaim | null> {
		const now = new Date();
		const result = await collection.findOneAndUpdate(
			{ verificationToken: token, verified: false, verificationExpiresAt: { $gt: now } },
			{
				$set: { verified: true, verifiedAt: now, updatedAt: now, _updatedAt: now },
				$unset: { verificationToken: '', verificationExpiresAt: '' },
			},
			{ returnDocument: 'after' },
		);
		return result ?? null;
	},

	/** Hard delete — a released domain must be claimable again by someone else. */
	async removeByIdAndFirm(id: string, firmId: string): Promise<boolean> {
		const res = await collection.deleteOne({ _id: id, firmId });
		return res.deletedCount > 0;
	},
};
