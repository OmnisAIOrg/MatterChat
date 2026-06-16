import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Inbound referral directory (Tier 2, collection `boards_referral_sources`).
 * Per 00-MASTER-PLAN, marketing sources/campaigns fold in here as a typed source
 * registry with embedded campaigns, so this doubles as the attribution registry
 * for `ILead.attribution.marketingSourceId` / `.campaignId`.
 */

export type ReferralSourceType = 'person' | 'firm' | 'campaign' | 'internal';

export interface IReferralSourceContact {
	phone?: string;
	email?: string;
	address?: string;
	website?: string;
}

/** Embedded campaign under a referral/marketing source (folds doc 01 ICampaign). */
export interface IReferralCampaign {
	id: string; // source-local id (nanoid)
	name: string;
	utmCampaign?: string;
	startDate?: Date;
	endDate?: Date;
	budget?: number;
	spendByMonth?: { month: string; amount: number }[]; // 'YYYY-MM'
	active: boolean;
}

export interface IReferralSource extends IRocketChatRecord {
	type: ReferralSourceType;
	name: string;
	contact?: IReferralSourceContact;
	defaultFeePct?: number; // expected inbound fee %
	channel?: 'paid-search' | 'lsa' | 'social' | 'tv' | 'radio' | 'organic' | 'referral' | 'other';
	utmSource?: string; // matching key for web-form attribution
	monthlySpend?: number; // for cost-per-lead / ROI
	campaigns?: IReferralCampaign[]; // embedded campaign registry
	caseproPartyId?: string; // -> CasePro parties.id (matters.referral_party_id target)
	notes?: string;
	active: boolean;

	// denormalized rollups (recomputed):
	leadsReferred?: number;
	signed?: number;
	totalExpectedFee?: number;

	createdBy?: IUser['_id'];
	createdAt: Date;
}
