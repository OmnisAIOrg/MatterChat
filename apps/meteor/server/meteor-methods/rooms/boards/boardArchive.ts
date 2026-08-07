import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { archiveBoard, requireUid } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.archiveBoard'(params: { boardId: string }): { ok: true };
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.archiveBoard'({ boardId }) {
		const uid = requireUid('boards.archiveBoard');
		return archiveBoard(uid, boardId);
	},
});
