import type { IBoardCard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { updateCard, requireUid, type UpdateCardPatch } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.cardUpdate'(params: { cardId: string; patch: UpdateCardPatch }): IBoardCard;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.cardUpdate'({ cardId, patch }) {
		const uid = requireUid('boards.cardUpdate');
		return updateCard(uid, cardId, patch);
	},
});
