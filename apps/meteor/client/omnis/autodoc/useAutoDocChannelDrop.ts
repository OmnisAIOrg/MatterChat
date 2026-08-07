import type { IRoom } from '@rocket.chat/core-typings';
import { usePermission, useSetting, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isAutoDocReadable, submitToAutoDoc } from './submit';
import { useInvalidateAutoDocFeed } from './useAutoDocFeed';

/**
 * AutoDoc's contribution to the room drop target.
 *
 * In a matter channel the overlay stops saying "Drop to upload file" and says
 * **"Drop to process with AutoDoc" / "Files are read and filed to Alvarez v.
 * Diaz"**. Naming the matter is the point — it tells the user the binding is
 * happening, which is the difference between this and a widget drop.
 *
 * The file is still uploaded to the channel as normal. AutoDoc submission is
 * additive, so a failed submit leaves an ordinary attachment behind rather than
 * losing the file: the user re-tries with "Process with AutoDoc" from the
 * message menu.
 */

export type AutoDocDropCopy = {
	/** True when this room should show AutoDoc copy instead of the generic upload copy. */
	active: boolean;
	title?: string;
	subtitle?: string;
	/** Fire-and-forget AutoDoc submission, to run alongside the normal upload. */
	submit(files: File[]): void;
};

export const useAutoDocChannelDrop = (room: IRoom): AutoDocDropCopy => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();
	const invalidate = useInvalidateAutoDocFeed();

	const autoDocEnabled = useSetting('AutoDoc_Enabled', false);
	const canSubmit = usePermission('submit-documents');

	// Only matter channels get the AutoDoc treatment: outside one there is no
	// binding to promise, and the generic copy is the honest one.
	const active = Boolean(autoDocEnabled && canSubmit && room.matterId);
	const matterName = room.fname ?? room.name ?? '';

	const submit = useCallback(
		(files: File[]) => {
			if (!active) {
				return;
			}
			void (async () => {
				const readable = files.filter(isAutoDocReadable);
				if (readable.length === 0) {
					return;
				}
				let submitted = 0;
				for (const file of readable) {
					try {
						await submitToAutoDoc(file, room._id);
						submitted += 1;
					} catch (error) {
						dispatchToast({
							type: 'error',
							message: error instanceof Error ? error.message : t('AutoDoc_Submit_failed'),
						});
					}
				}
				if (submitted > 0) {
					// The submitter may not hold `view-document-queue`, so this toast
					// plus the approve receipt in the channel are their only feedback.
					dispatchToast({ type: 'success', message: t('AutoDoc_Sent_for_processing_count', { count: submitted }) });
					await invalidate();
				}
			})();
		},
		[active, dispatchToast, invalidate, room._id, t],
	);

	return useMemo(
		() => ({
			active,
			...(active
				? {
						title: t('AutoDoc_Drop_to_process_with_AutoDoc'),
						subtitle: t('AutoDoc_Drop_filed_to_matter', { matter: matterName }),
					}
				: {}),
			submit,
		}),
		[active, matterName, submit, t],
	);
};
