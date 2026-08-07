import type { IBoard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { createBoard, requireUid, type CreateBoardParams } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.createBoard'(params: CreateBoardParams): IBoard;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.createBoard'(params) {
		const uid = requireUid('boards.createBoard');
		return createBoard(uid, params);
	},
});
