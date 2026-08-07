import type { IBoard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { updateBoard, requireUid, type UpdateBoardPatch } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.updateBoard'(params: { boardId: string; patch: UpdateBoardPatch }): IBoard;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.updateBoard'({ boardId, patch }) {
		const uid = requireUid('boards.updateBoard');
		return updateBoard(uid, boardId, patch);
	},
});
