import type { IReferralOut, ReferralOutStatus } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsReferralsOutModel extends IBaseModel<IReferralOut> {
	findByLead(leadId: string, options?: FindOptions<IReferralOut>): FindCursor<IReferralOut>;
	findByStatus(status: ReferralOutStatus, options?: FindOptions<IReferralOut>): FindCursor<IReferralOut>;
	findByToReferralSource(toReferralSourceId: string, options?: FindOptions<IReferralOut>): FindCursor<IReferralOut>;

	/** Outstanding referral revenue: accepted/signed but fee not yet received. */
	findOutstandingFees(options?: FindOptions<IReferralOut>): FindCursor<IReferralOut>;

	setStatus(referralOutId: string, status: ReferralOutStatus): Promise<UpdateResult>;
	recordReceivedFee(referralOutId: string, receivedFee: number, receivedAt: Date): Promise<UpdateResult>;
	updateReferralOut(referralOutId: string, patch: Partial<IReferralOut>): Promise<UpdateResult>;
	removeReferralOut(referralOutId: string): Promise<DeleteResult>;
}
