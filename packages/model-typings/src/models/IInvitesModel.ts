import type { IInvite } from '@rocket.chat/core-typings';
import type { UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IInvitesModel extends IBaseModel<IInvite> {
	findOneByUserRoomMaxUsesAndExpiration(userId: string, rid: string, maxUses: number, daysToExpire: number): Promise<IInvite | null>;
	increaseUsageById(_id: string, uses: number): Promise<UpdateResult>;
	// MATTERCHAT: atomic conditional increment — null when maxUses is already reached
	consumeUseById(_id: string): Promise<IInvite | null>;
	countUses(): Promise<number>;
}
