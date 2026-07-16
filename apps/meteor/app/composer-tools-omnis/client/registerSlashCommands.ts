/**
 * MatterChat fork — `/canned` and `/snippet` client-only slash commands that
 * open the canned-replies picker. Registered additively via `slashCommands.add`
 * (mirrors the app/slashcommands-* pattern); no core edits.
 *
 * clientOnly callbacks don't receive the ChatAPI, so we look up the room's live
 * composer from the fork's composerRegistry (populated by the "+" menu actions).
 * If found, the pick is inserted for editing; otherwise it is sent directly.
 */
import type { SlashCommandCallbackParams } from '@rocket.chat/core-typings';
import { imperativeModal } from '@rocket.chat/ui-client';

import CannedRepliesModal from './CannedRepliesModal';
import { getChatForRid } from './composerRegistry';
import { sdk } from '../../utils/client/lib/SDKClient';
import { slashCommands } from '../../utils/client/slashCommand';

const openCannedPicker = (message: SlashCommandCallbackParams<string>['message'], userId: string): void => {
	const composer = getChatForRid(message.rid)?.composer;

	if (composer) {
		imperativeModal.open({
			component: CannedRepliesModal,
			props: {
				userId,
				actionLabel: 'Insert',
				onPick: (text: string) => {
					composer.insertText(text);
					composer.focus();
				},
				onClose: () => imperativeModal.close(),
			},
		});
		return;
	}

	// No live composer registered for this room yet this session (the "+" menu
	// hasn't been opened here) — fall back to sending the selected template.
	imperativeModal.open({
		component: CannedRepliesModal,
		props: {
			userId,
			actionLabel: 'Send',
			onPick: (text: string) => {
				void sdk.call('sendMessage', { ...message, msg: text });
			},
			onClose: () => imperativeModal.close(),
		},
	});
};

slashCommands.add({
	command: 'canned',
	callback: ({ message, userId }: SlashCommandCallbackParams<'canned'>) => openCannedPicker(message, userId),
	options: {
		description: 'Insert or send a saved reply template',
		params: '[search]',
		clientOnly: true,
	},
});

slashCommands.add({
	command: 'snippet',
	callback: ({ message, userId }: SlashCommandCallbackParams<'snippet'>) => openCannedPicker(message, userId),
	options: {
		description: 'Insert a saved text snippet',
		params: '[search]',
		clientOnly: true,
	},
});
