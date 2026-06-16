import type { IBoardCard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { moveCard, requireUid } from '../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.cardMove'(params: { cardId: string; toListId: string; position: number; subStatus?: string }): IBoardCard;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.cardMove'({ cardId, toListId, position, subStatus }) {
		const uid = requireUid('boards.cardMove');
		return moveCard(uid, cardId, toListId, position, subStatus);
	},
});
