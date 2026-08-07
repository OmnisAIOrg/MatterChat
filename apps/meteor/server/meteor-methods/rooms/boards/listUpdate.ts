import type { IBoardList } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { updateList, requireUid, type UpdateListPatch } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.listUpdate'(params: { listId: string; patch: UpdateListPatch }): IBoardList;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.listUpdate'({ listId, patch }) {
		const uid = requireUid('boards.listUpdate');
		return updateList(uid, listId, patch);
	},
});
