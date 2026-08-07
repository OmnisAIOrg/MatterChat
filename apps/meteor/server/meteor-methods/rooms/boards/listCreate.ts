import type { IBoardList } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { createList, requireUid, type CreateListParams } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.listCreate'(params: CreateListParams): IBoardList;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.listCreate'(params) {
		const uid = requireUid('boards.listCreate');
		return createList(uid, params);
	},
});
