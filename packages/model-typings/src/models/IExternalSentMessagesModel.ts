import type { IExternalSentMessage } from '@rocket.chat/core-typings';

import type { IBaseModel } from './IBaseModel';

export interface IExternalSentMessagesModel extends IBaseModel<IExternalSentMessage> {
	/** Record one message the user sent out through a connector (idempotent per externalId). */
	recordSent(msg: Omit<IExternalSentMessage, '_id' | '_updatedAt'>): Promise<void>;

	/** The user's own sent messages for one channel, newest-first, capped. */
	findForChannel(
		userId: string,
		connectionId: string,
		channelExternalId: string,
		limit?: number,
	): Promise<IExternalSentMessage[]>;
}
