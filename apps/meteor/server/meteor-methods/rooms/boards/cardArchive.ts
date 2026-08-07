import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { archiveCard, requireUid } from '../../../lib/boards';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.cardArchive'(params: { cardId: string }): { ok: true };
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.cardArchive'({ cardId }) {
		const uid = requireUid('boards.cardArchive');
		return archiveCard(uid, cardId);
	},
});
