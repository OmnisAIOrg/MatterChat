import type { IExternalSentMessage } from '@rocket.chat/core-typings';

import type { IBaseModel } from './IBaseModel';

export interface IExternalSentMessagesModel extends IBaseModel<IExternalSentMessage> {
	/** Record one message the user sent out through a connector (idempotent per externalId). */
	recordSent(msg: Omit<IExternalSentMessage, '_id' | '_updatedAt'>): Promise<void>;

	/**
	 * Persist a batch of messages MatterChat has seen for a channel (history reads + live inbound
	 * events), so they stay native to MatterChat instead of being re-fetched from the provider on
	 * every view. Idempotent per externalId.
	 */
	recordSeenBatch(msgs: Omit<IExternalSentMessage, '_id' | '_updatedAt'>[]): Promise<void>;

	/** Every message MatterChat knows about for one channel, newest-first, capped. */
	findForChannel(userId: string, connectionId: string, channelExternalId: string, limit?: number): Promise<IExternalSentMessage[]>;
}
