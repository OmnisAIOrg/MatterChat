import type { IBoardCard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { moveCard, requireUid } from '../../lib/boards';
import { syncLeadStageFromCard } from '../../lib/boards/leads';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'boards.cardMove'(params: { cardId: string; toListId: string; position: number; subStatus?: string }): IBoardCard;
	}
}

Meteor.methods<ServerMethods>({
	async 'boards.cardMove'({ cardId, toListId, position, subStatus }) {
		const uid = requireUid('boards.cardMove');
		const card = await moveCard(uid, cardId, toListId, position, subStatus);
		// Leads-pipeline seam: if this was a lead card, reconcile the linked lead's
		// status to the new column and write the stage through to CasePro. No-op for
		// every other card type (see syncLeadStageFromCard).
		await syncLeadStageFromCard(uid, cardId, toListId);
		return card;
	},
});
