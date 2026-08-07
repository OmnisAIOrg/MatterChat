import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { requireUid } from '../../../../lib/boards';
import { seedFromCasePro, type SeedFromCaseProResult } from '../../../../lib/boards/matters';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.matters.seedFromCasePro'(params: { boardId: string }): SeedFromCaseProResult;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.matters.seedFromCasePro'({ boardId }) {
		const uid = requireUid('boards.matters.seedFromCasePro');
		return seedFromCasePro(uid, boardId);
	},
});
