import type { ICommunication } from '@rocket.chat/core-typings';
import type { FindCursor, FindOptions } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

export interface IBoardsCommunicationsModel extends IBaseModel<ICommunication> {
	/** Append a communication; returns its _id. */
	log(entry: Omit<ICommunication, '_id' | '_updatedAt'>): Promise<ICommunication['_id']>;

	/** Lead timeline, sorted ts desc. */
	findByLead(leadId: string, options?: FindOptions<ICommunication>): FindCursor<ICommunication>;

	findLastOutbound(leadId: string): Promise<ICommunication | null>;
}
