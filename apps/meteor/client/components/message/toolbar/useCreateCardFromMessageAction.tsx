import type { IMessage } from '@rocket.chat/core-typings';
import { usePermission, useSetModal } from '@rocket.chat/ui-contexts';

import CreateCardFromMessageModal from './CreateCardFromMessageModal';
import type { MessageActionConfig } from '../../../../app/ui-utils/client/lib/MessageAction';

/**
 * "Create task" message action (message→card Fusion). Adds a menu entry that opens a
 * modal to drop the message onto a board as a task card. Gated by the `boards-view`
 * permission so it only appears for users who have the Boards feature.
 */
export const useCreateCardFromMessageAction = (message: IMessage): MessageActionConfig | null => {
	const setModal = useSetModal();
	const canViewBoards = usePermission('boards-view');

	if (!canViewBoards) {
		return null;
	}

	return {
		id: 'create-card-from-message',
		icon: 'squares',
		label: 'Create_task_from_message',
		type: 'duplication',
		context: ['message', 'message-mobile', 'threads', 'starred', 'pinned', 'mentions', 'federated'],
		action() {
			setModal(<CreateCardFromMessageModal message={message} onClose={() => setModal(undefined)} />);
		},
		order: 6,
		group: 'menu',
	};
};
