import type { IReferralOut, ReferralOutStatus, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsReferralsOutModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

const OUTSTANDING_STATUSES: ReferralOutStatus[] = ['accepted', 'signed'];

export class BoardsReferralsOutRaw extends BaseRaw<IReferralOut> implements IBoardsReferralsOutModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IReferralOut>>) {
		super(db, 'boards_referrals_out', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { leadId: 1 } },
			{ key: { status: 1 } },
			{ key: { toReferralSourceId: 1 }, sparse: true },
		];
	}

	public findByLead(leadId: string, options?: FindOptions<IReferralOut>): FindCursor<IReferralOut> {
		return this.find({ leadId }, { sort: { sentAt: -1 }, ...options });
	}

	public findByStatus(status: ReferralOutStatus, options?: FindOptions<IReferralOut>): FindCursor<IReferralOut> {
		return this.find({ status }, options);
	}

	public findByToReferralSource(
		toReferralSourceId: string,
		options?: FindOptions<IReferralOut>,
	): FindCursor<IReferralOut> {
		return this.find({ toReferralSourceId }, options);
	}

	public findOutstandingFees(options?: FindOptions<IReferralOut>): FindCursor<IReferralOut> {
		return this.find(
			{ status: { $in: OUTSTANDING_STATUSES }, receivedFee: { $exists: false } },
			options,
		);
	}

	public setStatus(referralOutId: string, status: ReferralOutStatus): Promise<UpdateResult> {
		return this.updateOne({ _id: referralOutId }, { $set: { status } });
	}

	public recordReceivedFee(referralOutId: string, receivedFee: number, receivedAt: Date): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: referralOutId },
			{ $set: { receivedFee, receivedAt, status: 'fee-received' } },
		);
	}

	public updateReferralOut(referralOutId: string, patch: Partial<IReferralOut>): Promise<UpdateResult> {
		const { _id, ...rest } = patch as Partial<IReferralOut> & { _id?: string };
		return this.updateOne({ _id: referralOutId }, { $set: rest });
	}

	public removeReferralOut(referralOutId: string): Promise<DeleteResult> {
		return this.removeById(referralOutId);
	}
}
