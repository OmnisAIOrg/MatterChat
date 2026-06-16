import type { IReferralSource, ReferralSourceType, ReferralSourceKind } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsReferralSourcesModel extends IBaseModel<IReferralSource> {
	findActive(options?: FindOptions<IReferralSource>): FindCursor<IReferralSource>;
	findByType(type: ReferralSourceType, options?: FindOptions<IReferralSource>): FindCursor<IReferralSource>;
	findByUtmSource(utmSource: string): Promise<IReferralSource | null>;
	findByCampaignUtm(utmCampaign: string): Promise<IReferralSource | null>;

	/** M6 marketing registry: active sources of a kind (marketing/referral/both). */
	findByKind(kind: ReferralSourceKind, options?: FindOptions<IReferralSource>): FindCursor<IReferralSource>;

	/** M6: active sources that carry marketing spend (kind marketing|both) for ROI reporting. */
	findMarketingSources(options?: FindOptions<IReferralSource>): FindCursor<IReferralSource>;

	/** Set/replace a month's source-level spend ('YYYY-MM'); used by the spend editor. */
	setMonthlySpend(sourceId: string, month: string, amount: number): Promise<UpdateResult>;

	updateSource(sourceId: string, patch: Partial<IReferralSource>): Promise<UpdateResult>;
	setActive(sourceId: string, active: boolean): Promise<UpdateResult>;
	removeSource(sourceId: string): Promise<DeleteResult>;
}
