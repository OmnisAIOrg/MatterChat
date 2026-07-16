/**
 * MatterChat fork — registers composer "+" menu actions via the built-in
 * `messageBox.actions` registry (zero edits to the composer/toolbar core).
 */
import { imperativeModal } from '@rocket.chat/ui-client';
import type { TranslationKey } from '@rocket.chat/ui-contexts';

import CannedRepliesModal from './CannedRepliesModal';
import LitBoxAttachModal from './LitBoxAttachModal';
import { rememberChat } from './composerRegistry';
import type { ChatAPI } from '../../../client/lib/chats/ChatAPI';
import { messageBox } from '../../ui-utils/client';

// Readable labels used directly as keys; i18next falls back to the key text when
// no translation is registered, so no i18n codegen / en.i18n.json edit is needed.
const GROUP = 'Legal tools' as TranslationKey;

const insertIntoComposer = (chat: ChatAPI, text: string): void => {
	chat.composer?.insertText(text);
	chat.composer?.focus();
};

const openCannedModal = (chat: ChatAPI): void => {
	imperativeModal.open({
		component: CannedRepliesModal,
		props: {
			userId: chat.uid,
			actionLabel: 'Insert',
			onPick: (text: string) => insertIntoComposer(chat, text),
			onClose: () => imperativeModal.close(),
		},
	});
};

const openLitBoxModal = async (chat: ChatAPI): Promise<void> => {
	const room = await chat.data.getRoom().catch(() => undefined);
	imperativeModal.open({
		component: LitBoxAttachModal,
		props: {
			room,
			onInsert: (text: string) => insertIntoComposer(chat, text),
			onClose: () => imperativeModal.close(),
		},
	});
};

export const registerComposerActions = (): void => {
	messageBox.actions.add(GROUP, 'Canned replies' as TranslationKey, {
		id: 'omnis-canned-replies',
		icon: 'quote',
		action: ({ rid, chat }): void => {
			rememberChat(rid, chat);
			openCannedModal(chat);
		},
	});

	messageBox.actions.add(GROUP, 'Attach from LitBox' as TranslationKey, {
		id: 'omnis-litbox-attach',
		icon: 'file-document',
		action: ({ rid, chat }): void => {
			rememberChat(rid, chat);
			void openLitBoxModal(chat);
		},
	});
};
