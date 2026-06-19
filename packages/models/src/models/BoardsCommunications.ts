import type { ICommunication } from '@rocket.chat/core-typings';
import type { IBoardsCommunicationsModel } from '@rocket.chat/model-typings';
import type { Db, FindCursor, FindOptions, IndexDescription } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsCommunicationsRaw extends BaseRaw<ICommunication> implements IBoardsCommunicationsModel {
	constructor(db: Db) {
		// append-only comms log: no trash collection (mirrors BoardsActivities)
		super(db, 'boards_communications', undefined, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { leadId: 1, ts: -1 } },
			{ key: { leadId: 1, kind: 1, direction: 1, ts: -1 } },
		];
	}

	public async log(entry: Omit<ICommunication, '_id' | '_updatedAt'>): Promise<ICommunication['_id']> {
		const { insertedId } = await this.insertOne(entry);
		return insertedId;
	}

	public findByLead(leadId: string, options?: FindOptions<ICommunication>): FindCursor<ICommunication> {
		return this.find({ leadId }, { sort: { ts: -1 }, ...options });
	}

	public findLastOutbound(leadId: string): Promise<ICommunication | null> {
		return this.findOne({ leadId, direction: 'out' }, { sort: { ts: -1 } });
	}
}
