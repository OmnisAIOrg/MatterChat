import type { IInvite, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IInvitesModel } from '@rocket.chat/model-typings';
import type { Collection, Db, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class InvitesRaw extends BaseRaw<IInvite> implements IInvitesModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IInvite>>) {
		super(db, 'invites', trash);
	}

	findOneByUserRoomMaxUsesAndExpiration(userId: string, rid: string, maxUses: number, daysToExpire: number): Promise<IInvite | null> {
		return this.findOne({
			rid,
			userId,
			days: daysToExpire,
			maxUses,
			...(daysToExpire > 0 ? { expires: { $gt: new Date() } } : {}),
			...(maxUses > 0 ? { uses: { $lt: maxUses } } : {}),
		});
	}

	increaseUsageById(_id: string, uses = 1): Promise<UpdateResult> {
		return this.updateOne(
			{ _id },
			{
				$inc: {
					uses,
				},
			},
		);
	}

	/**
	 * MATTERCHAT: atomically consume ONE redemption of an invite.
	 *
	 * Stock RC reads `uses` in validateInviteToken and increments it later in
	 * useInviteToken, so N concurrent redemptions of the same link all read the
	 * pre-increment value and all pass. That race was cosmetic while firm invites
	 * were unlimited; now that `Firms_Invite_MaxUses` IS the security guarantee for
	 * a firm link (each redemption also runs adoptUserIntoFirm), the cap has to hold
	 * under concurrency. A single conditional `findOneAndUpdate` does that.
	 *
	 * `maxUses <= 0` still means unlimited (stock semantics for non-firm invites).
	 * Returns the updated invite, or null when the cap was already reached.
	 */
	async consumeUseById(_id: string): Promise<IInvite | null> {
		// BaseRaw wrapper (not this.col) so `_updatedAt` is maintained, matching increaseUsageById
		return this.findOneAndUpdate(
			{
				_id,
				$or: [{ maxUses: { $lte: 0 } }, { maxUses: { $exists: false } }, { $expr: { $lt: ['$uses', '$maxUses'] } }],
			},
			{ $inc: { uses: 1 } },
			{ returnDocument: 'after' },
		);
	}

	async countUses(): Promise<number> {
		const [result] = await this.col.aggregate<{ totalUses: number }>([{ $group: { _id: null, totalUses: { $sum: '$uses' } } }]).toArray();

		return result?.totalUses || 0;
	}
}
