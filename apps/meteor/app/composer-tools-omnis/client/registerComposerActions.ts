/**
 * MatterChat fork — registers composer "+" menu actions via the built-in
 * `messageBox.actions` registry (zero edits to the composer/toolbar core).
 */
import type { IRoom } from '@rocket.chat/core-typings';
import { imperativeModal } from '@rocket.chat/ui-client';
import type { TranslationKey } from '@rocket.chat/ui-contexts';

import CannedRepliesModal from './CannedRepliesModal';
import LitBoxAttachModal from './LitBoxAttachModal';
import { rememberChat } from './composerRegistry';
import type { ChatAPI } from '../../../client/lib/chats/ChatAPI';
import MatterFilesModal from '../../../client/views/boards/card/MatterFilesModal';
import { messageBox } from '../../ui-utils/client';
import { sdk } from '../../utils/client/lib/SDKClient';

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

/**
 * Rooms do NOT carry a LitBox workspace id — they carry `matterId`/`matterCardId`.
 * Resolve the workspace the same way the room's matter surfaces do: read the
 * matter's CasePro snapshot (`GET /v1/boards.casepro.matterSnapshot`) and take
 * `snapshot.litboxWorkspaceId`. Defensive by design: ANY failure (no matter on
 * the room, no boards-casepro-view permission, CasePro/connector down, matter
 * without a workspace) resolves to `undefined` and the caller falls back to the
 * org `/litbox` link — nothing here ever throws into the composer.
 */
const resolveMatterWorkspaceId = async (room?: IRoom): Promise<string | undefined> => {
	const matterId = room?.matterId;
	if (!matterId) {
		return undefined;
	}
	try {
		const { snapshot } = await sdk.rest.get('/v1/boards.casepro.matterSnapshot', { matterId });
		return snapshot?.litboxWorkspaceId || undefined;
	} catch {
		return undefined;
	}
};

const openLitBoxModal = async (chat: ChatAPI): Promise<void> => {
	const room = await chat.data.getRoom().catch(() => undefined);
	const workspaceId = await resolveMatterWorkspaceId(room).catch(() => undefined);

	// Matter-scoped room with a resolvable workspace → browse the matter's files
	// in-place (the same embedded browser the board card uses) instead of linking out.
	if (workspaceId) {
		imperativeModal.open({
			component: MatterFilesModal,
			props: {
				workspaceId,
				label: room?.fname || room?.name,
				onClose: () => imperativeModal.close(),
			},
		});
		return;
	}

	// Org fallback (or unresolvable matter workspace) → insert a `/litbox` Files link.
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
			// belt-and-braces: the async open path is already fully defensive, but a
			// rejection here must never surface as an unhandled error in the composer.
			void openLitBoxModal(chat).catch(() => undefined);
		},
	});
};
