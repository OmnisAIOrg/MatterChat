import type { IReferralSource, ReferralSourceType } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, FindOptions, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsReferralSourcesModel extends IBaseModel<IReferralSource> {
	findActive(options?: FindOptions<IReferralSource>): FindCursor<IReferralSource>;
	findByType(type: ReferralSourceType, options?: FindOptions<IReferralSource>): FindCursor<IReferralSource>;
	findByUtmSource(utmSource: string): Promise<IReferralSource | null>;
	findByCampaignUtm(utmCampaign: string): Promise<IReferralSource | null>;

	updateSource(sourceId: string, patch: Partial<IReferralSource>): Promise<UpdateResult>;
	setActive(sourceId: string, active: boolean): Promise<UpdateResult>;
	removeSource(sourceId: string): Promise<DeleteResult>;
}
