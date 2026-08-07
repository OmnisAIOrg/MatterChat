import type { IBoardCard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { bindMatterCard } from '../../../../lib/boards/matters';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.matters.bind'(params: { boardId: string; listId: string; matterId: string }): IBoardCard;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.matters.bind'({ boardId, listId, matterId }) {
		const uid = requireUid('boards.matters.bind');
		return bindMatterCard(uid, boardId, listId, matterId);
	},
});
