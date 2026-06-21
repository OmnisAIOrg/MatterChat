import { api } from '@rocket.chat/core-services';
import type { SlashCommandCallbackParams } from '@rocket.chat/core-typings';

import { createLead } from '../../../server/lib/boards/leads/service';
import { ensureMattersBoard, bindMatterCard } from '../../../server/lib/boards/matters/service';
import { createCard } from '../../../server/lib/boards/service';
import { slashCommands } from '../../utils/server/slashCommand';

/**
 * Omnis Boards slash commands — quick capture from any chat channel:
 *   /task <title>     → create a task card on the user's Matters board
 *   /lead <name>      → create a lead (CasePro intake)
 *   /matter <id>      → add a CasePro matter to the user's Matters board
 *
 * All feedback is an ephemeral message to the caller (plain strings — descriptions
 * are typed `string`, so no i18n-key build dependency). Each handler is fail-safe:
 * any error surfaces as an ephemeral note rather than throwing into the command bus.
 */
const notify = (userId: string, rid: string, msg: string): void => {
	void api.broadcast('notify.ephemeralMessage', userId, rid, { msg });
};

slashCommands.add({
	command: 'task',
	callback: async ({ params, message, userId }: SlashCommandCallbackParams<'task'>): Promise<void> => {
		const title = params.trim();
		if (!title) {
			return notify(userId, message.rid, 'Usage: /task <title> — creates a task card on your Matters board.');
		}
		try {
			const { board, lists } = await ensureMattersBoard(userId);
			const card = await createCard(userId, { boardId: board._id, listId: lists[0]._id, title, cardType: 'task' });
			notify(userId, message.rid, `✅ Task #${card.cardNumber} created: "${title}"`);
		} catch (err: any) {
			notify(userId, message.rid, `Could not create the task: ${err?.message || 'unknown error'}`);
		}
	},
	options: {
		description: 'Create a task card on your Matters board',
		params: 'task title',
	},
});

slashCommands.add({
	command: 'lead',
	callback: async ({ params, message, userId }: SlashCommandCallbackParams<'lead'>): Promise<void> => {
		const name = params.trim();
		if (!name) {
			return notify(userId, message.rid, 'Usage: /lead <name> — creates a new lead from this channel.');
		}
		try {
			const { card, refNo, duplicateOf } = await createLead(userId, {
				contact: { fullName: name },
				capturedChannel: 'manual',
			});
			if (duplicateOf) {
				notify(userId, message.rid, `ℹ️ A lead already exists for "${name}" (#${refNo}).`);
				return;
			}
			notify(userId, message.rid, `✅ Lead #${refNo} created for "${name}" (card ${card.cardNumber}).`);
		} catch (err: any) {
			notify(userId, message.rid, `Could not create the lead: ${err?.message || 'unknown error'}`);
		}
	},
	options: {
		description: 'Create a new lead',
		params: 'contact name',
	},
});

slashCommands.add({
	command: 'matter',
	callback: async ({ params, message, userId }: SlashCommandCallbackParams<'matter'>): Promise<void> => {
		const matterId = params.trim();
		if (!matterId) {
			return notify(userId, message.rid, 'Usage: /matter <matter id> — adds a CasePro matter to your Matters board.');
		}
		try {
			const { board, lists } = await ensureMattersBoard(userId);
			const card = await bindMatterCard(userId, board._id, lists[0]._id, matterId);
			const label = card.link?.kind === 'matter' ? (card.link.snapshot?.matterName ?? matterId) : matterId;
			notify(userId, message.rid, `✅ Matter "${label}" is on your Matters board (card #${card.cardNumber}).`);
		} catch (err: any) {
			notify(userId, message.rid, `Could not add the matter: ${err?.message || 'unknown error'}`);
		}
	},
	options: {
		description: 'Add a CasePro matter to your Matters board',
		params: 'matter id',
	},
});
