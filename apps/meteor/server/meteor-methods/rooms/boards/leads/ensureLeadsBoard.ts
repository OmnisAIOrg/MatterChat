import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { ensureLeadsBoard, type EnsureLeadsBoardResult } from '../../../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.ensureLeadsBoard'(): EnsureLeadsBoardResult;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.ensureLeadsBoard'() {
		const uid = requireUid('boards.ensureLeadsBoard');
		return ensureLeadsBoard(uid);
	},
});
