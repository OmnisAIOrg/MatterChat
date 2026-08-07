import type { IBoardList } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { moveList, requireUid } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.listMove'(params: { listId: string; position: number }): IBoardList;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.listMove'({ listId, position }) {
		const uid = requireUid('boards.listMove');
		return moveList(uid, listId, position);
	},
});
