import type { IBoard, IBoardList } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { ensureMattersBoard } from '../../../../lib/boards/matters';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.matters.ensureBoard'(): { board: IBoard; lists: IBoardList[] };
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.matters.ensureBoard'() {
		const uid = requireUid('boards.matters.ensureBoard');
		return ensureMattersBoard(uid);
	},
});
