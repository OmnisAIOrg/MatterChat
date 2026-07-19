import type { IExternalSentMessage } from '@rocket.chat/core-typings';
import type { IExternalSentMessagesModel } from '@rocket.chat/model-typings';
import type { Db, IndexDescription } from 'mongodb';

import { BaseRaw } from './BaseRaw';

/**
 * MatterChat's durable record of messages sent OUT to external workspaces (Slack/Teams/Google).
 * See IExternalSentMessage — this exists because provider history APIs don't reliably return the
 * app's own sent messages, so the browse view merges these in to guarantee they stay visible.
 */
export class ExternalSentMessagesRaw extends BaseRaw<IExternalSentMessage> implements IExternalSentMessagesModel {
	constructor(db: Db) {
		super(db, 'external_sent_messages');
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			// Primary read: a user's sent messages for one channel, newest-first.
			{ key: { userId: 1, connectionId: 1, channelExternalId: 1, createdAt: -1 } },
			// Idempotency guard for recordSent.
			{ key: { userId: 1, connectionId: 1, channelExternalId: 1, externalId: 1 }, unique: true },
		];
	}

	async recordSent(msg: Omit<IExternalSentMessage, '_id' | '_updatedAt'>): Promise<void> {
		// Upsert on the natural key so a resend/retry with the same provider id never duplicates.
		await this.updateOne(
			{
				userId: msg.userId,
				connectionId: msg.connectionId,
				channelExternalId: msg.channelExternalId,
				externalId: msg.externalId,
			},
			{ $set: msg },
			{ upsert: true },
		);
	}

	async recordSeenBatch(msgs: Omit<IExternalSentMessage, '_id' | '_updatedAt'>[]): Promise<void> {
		if (!msgs.length) {
			return;
		}
		// One round-trip for a whole history page. $setOnInsert (NOT $set) so re-reading history
		// never overwrites a record we already hold — in particular a 'sent' record, which carries
		// attribution the provider's history read may lack.
		await this.col.bulkWrite(
			msgs.map((msg) => ({
				updateOne: {
					filter: {
						userId: msg.userId,
						connectionId: msg.connectionId,
						channelExternalId: msg.channelExternalId,
						externalId: msg.externalId,
					},
					update: { $setOnInsert: msg },
					upsert: true,
				},
			})),
			{ ordered: false },
		);
	}

	async findForChannel(
		userId: string,
		connectionId: string,
		channelExternalId: string,
		limit = 500,
	): Promise<IExternalSentMessage[]> {
		return this.find(
			{ userId, connectionId, channelExternalId },
			{ sort: { createdAt: -1 }, limit },
		).toArray();
	}
}
