import type { IRocketChatRecord } from './IRocketChatRecord';
import type { IUser } from './IUser';

/**
 * Inbound referral directory + marketing-source registry (Tier 2, collection
 * `boards_referral_sources`). Per 00-MASTER-PLAN, marketing sources/campaigns
 * fold in here as a typed source registry with embedded campaigns, so this
 * doubles as the attribution registry for `ILead.attribution.marketingSourceId`
 * / `.campaignId`.
 *
 * M6 DECISION (marketing source/campaign): rather than add parallel
 * `IMarketingSource` / `IMarketingCampaign` collections, the marketing registry
 * is folded into THIS type. `kind` distinguishes a relationship referrer
 * ('referral') from a paid/marketing channel ('marketing'); a source can be
 * both. Source-level paid spend lives in `monthlySpend[]` (a series, replacing
 * the prior scalar) and campaign-level spend in `IReferralCampaign.spendByMonth`.
 * ROI math (spend vs. signed vs. revenue) is query-then-sum at report time
 * because aggregate GROUP BY is broken. See intake-lead-management.md §9.
 */

export type ReferralSourceType = 'person' | 'firm' | 'campaign' | 'internal';

/** Whether this row is a relationship referrer, a paid marketing channel, or both. */
export type ReferralSourceKind = 'referral' | 'marketing' | 'both';

/** A month of attributed marketing spend at the source level ('YYYY-MM'). */
export interface IMonthlySpend {
	month: string; // 'YYYY-MM'
	amount: number;
}

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
	kind?: ReferralSourceKind; // referral | marketing | both (default 'referral')
	name: string;
	contact?: IReferralSourceContact;
	defaultFeePct?: number; // expected inbound fee %
	channel?: 'paid-search' | 'lsa' | 'social' | 'tv' | 'radio' | 'organic' | 'referral' | 'other';
	utmSource?: string; // matching key for web-form attribution
	monthlySpend?: IMonthlySpend[]; // source-level paid spend series, for CPL / ROI
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
