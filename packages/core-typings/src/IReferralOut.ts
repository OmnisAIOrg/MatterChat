import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Outbound / co-counsel referral with fee split (Tier 2, collection
 * `boards_referrals_out`). One per lead we refer out or co-counsel.
 */

export type ReferralOutStatus = 'sent' | 'accepted' | 'declined' | 'signed' | 'fee-received' | 'closed';

export type ReferralArrangement = 'referral-fee' | 'co-counsel';

export interface IReferralOutContact {
	name?: string;
	phone?: string;
	email?: string;
}

export interface IReferralOut extends IRocketChatRecord {
	leadId: string; // -> ILead._id
	toFirmName: string;
	toReferralSourceId?: string; // optional link to directory (a firm we refer to)
	contact?: IReferralOutContact;
	sentAt: Date;
	status: ReferralOutStatus;
	arrangement: ReferralArrangement;
	agreedFeePct?: number;
	expectedFee?: number; // amount
	receivedFee?: number;
	receivedAt?: Date;
	agreementDocRef?: string; // LitBox/uploaded fee agreement
	notes?: string;

	createdBy?: IUser['_id'];
	createdAt: Date;
}
