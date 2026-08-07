import type { IMessage, IRoom } from '@rocket.chat/core-typings';
import { usePermission, useSetting, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useTranslation } from 'react-i18next';

import type { MessageActionConfig } from '../../../../app/ui-utils/client/lib/MessageAction';
import { isAutoDocReadable, submitToAutoDoc } from '../../../omnis/autodoc/submit';

/**
 * "Process with AutoDoc" — the retro-active intake path, for a document somebody
 * already posted.
 *
 * Sits alongside `useCreateCardFromMessageAction`, which is the working
 * precedent for a custom Omnis entry in the message toolbar.
 *
 * Shown only when ALL of these hold, because an action that appears and then
 * fails is worse than one that never appears:
 *   - AutoDoc is enabled on the workspace;
 *   - the user holds `submit-documents`;
 *   - the message actually carries an attachment AutoDoc can read.
 *
 * `roomId` is passed so a matter channel binds the matter at intake, exactly as
 * a drop would. Nothing here supplies a matterId directly — the server resolves
 * it from the room.
 */
export const useProcessWithAutoDocAction = (message: IMessage, { room }: { room: IRoom }): MessageActionConfig | null => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();

	const autoDocEnabled = useSetting('AutoDoc_Enabled', false);
	const canSubmit = usePermission('submit-documents');

	const files = [...(message.files ?? []), ...(message.file ? [message.file] : [])];
	const readable = files.filter((file) => isAutoDocReadable({ type: file.type, name: file.name }));

	if (!autoDocEnabled || !canSubmit || readable.length === 0) {
		return null;
	}

	return {
		id: 'process-with-autodoc',
		icon: 'doc',
		label: 'AutoDoc_Process_with_AutoDoc',
		type: 'duplication',
		context: ['message', 'message-mobile', 'threads', 'starred', 'pinned', 'federated'],
		async action() {
			try {
				// The attachment already lives in Rocket.Chat's upload store, so we
				// fetch it back through the authenticated file route rather than
				// asking the user to re-pick it.
				let submitted = 0;
				for (const file of readable) {
					const response = await fetch(`/file-upload/${file._id}/${encodeURIComponent(file.name ?? 'document')}`);
					if (!response.ok) {
						continue;
					}
					const blob = await response.blob();
					await submitToAutoDoc(new File([blob], file.name ?? 'document', { type: file.type ?? blob.type }), room._id);
					submitted += 1;
				}

				if (submitted === 0) {
					dispatchToast({ type: 'error', message: t('AutoDoc_Submit_failed') });
					return;
				}
				// The submitter may not hold `view-document-queue`; this confirmation
				// plus the approve receipt in the channel are their only feedback.
				dispatchToast({ type: 'success', message: t('AutoDoc_Sent_for_processing_count', { count: submitted }) });
			} catch (error) {
				dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('AutoDoc_Submit_failed') });
			}
		},
		order: 7,
		group: 'menu',
	};
};
