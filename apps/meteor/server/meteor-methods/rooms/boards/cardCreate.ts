import type { IBoardCard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { createCard, requireUid, type CreateCardParams } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.cardCreate'(params: CreateCardParams): IBoardCard;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.cardCreate'(params) {
		const uid = requireUid('boards.cardCreate');
		return createCard(uid, params);
	},
});
