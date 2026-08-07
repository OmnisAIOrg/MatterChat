import type { IBoardCard } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { Meteor } from 'meteor/meteor';

import { moveCard, requireUid } from '../../../lib/boards';
import { syncLeadStageFromCard } from '../../../lib/boards/leads';
import { applyMatterStageEntry } from '../../../lib/boards/matters';

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
		// Matters-pipeline seam (M5): if this was a matter card, apply the new stage's
		// playbook + stamp stage-specific deadlines (e.g. Demand-Sent → +30d response).
		// No-op for every other card type (see applyMatterStageEntry); best-effort so a
		// playbook/deadline failure never rolls back the already-committed move.
		await applyMatterStageEntry(uid, cardId, toListId);
		return card;
	},
});
