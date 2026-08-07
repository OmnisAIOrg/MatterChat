import type { IBoardCard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { refreshMatterSnapshot } from '../../../../lib/boards/matters';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.matters.refreshSnapshot'(params: { cardId: string }): IBoardCard;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.matters.refreshSnapshot'({ cardId }) {
		const uid = requireUid('boards.matters.refreshSnapshot');
		return refreshMatterSnapshot(uid, cardId);
	},
});
