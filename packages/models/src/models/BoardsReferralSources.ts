import type { IReferralSource, ReferralSourceType, RocketChatRecordDeleted } from '@rocket.chat/core-typings';
import type { IBoardsReferralSourcesModel } from '@rocket.chat/model-typings';
import type { Collection, Db, DeleteResult, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsReferralSourcesRaw extends BaseRaw<IReferralSource> implements IBoardsReferralSourcesModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IReferralSource>>) {
		super(db, 'boards_referral_sources', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { active: 1 } },
			{ key: { type: 1 } },
			{ key: { utmSource: 1 }, sparse: true },
			{ key: { 'campaigns.utmCampaign': 1 }, sparse: true },
		];
	}

	public findActive(options?: FindOptions<IReferralSource>): FindCursor<IReferralSource> {
		return this.find({ active: true }, options);
	}

	public findByType(type: ReferralSourceType, options?: FindOptions<IReferralSource>): FindCursor<IReferralSource> {
		return this.find({ type }, options);
	}

	public findByUtmSource(utmSource: string): Promise<IReferralSource | null> {
		return this.findOne({ utmSource });
	}

	public findByCampaignUtm(utmCampaign: string): Promise<IReferralSource | null> {
		return this.findOne({ 'campaigns.utmCampaign': utmCampaign });
	}

	public updateSource(sourceId: string, patch: Partial<IReferralSource>): Promise<UpdateResult> {
		const { _id, ...rest } = patch as Partial<IReferralSource> & { _id?: string };
		return this.updateOne({ _id: sourceId }, { $set: rest });
	}

	public setActive(sourceId: string, active: boolean): Promise<UpdateResult> {
		return this.updateOne({ _id: sourceId }, { $set: { active } });
	}

	public removeSource(sourceId: string): Promise<DeleteResult> {
		return this.removeById(sourceId);
	}
}
