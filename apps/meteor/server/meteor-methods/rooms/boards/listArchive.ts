import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { archiveList, requireUid } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.listArchive'(params: { listId: string }): { ok: true };
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.listArchive'({ listId }) {
		const uid = requireUid('boards.listArchive');
		return archiveList(uid, listId);
	},
});
