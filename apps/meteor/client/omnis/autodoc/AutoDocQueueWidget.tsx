import { Box } from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoDocReviewPanel from './AutoDocReviewPanel';
import { submitToAutoDoc } from './submit';
import { useAutoDocFeed, useInvalidateAutoDocFeed } from './useAutoDocFeed';
import type { AutoDocDocument } from './useAutoDocFeed';
import { useOpenedRoom } from '../../lib/RoomManager';
import OmnisWidget from '../shell/OmnisWidget';
import OmnisWidgetRow from '../shell/OmnisWidgetRow';
import { omnisPost } from '../shell/omnisRest';

/**
 * The AutoDoc document-intake queue.
 *
 * The widget is an **intake surface, not a read-only list** — you can drop files
 * straight onto it. Its drop copy differs from the channel drop zone's on
 * purpose:
 *
 *   - Channel drop → *"Files are read and filed to Alvarez v. Diaz"*. Naming the
 *     matter is the point: it tells the user the binding is happening.
 *   - Widget drop → *"AutoDoc matches the matter itself, as it normally does."*
 *
 * Two entry points, honestly different outcomes. A widget drop may well land in
 * the queue needing a matter picked; a channel drop will not. Papering over
 * that difference would make the queue's "needs review" pile look arbitrary.
 */

function statusFor(document: AutoDocDocument, t: (key: string) => string): { label: string; variant?: 'primary' | 'danger' | 'secondary' } {
	switch (document.status) {
		case 'ready':
			return { label: t('AutoDoc_Status_Ready'), variant: 'primary' };
		case 'quick_confirm':
			return { label: t('AutoDoc_Status_Quick_confirm'), variant: 'secondary' };
		case 'processing':
			return { label: t('AutoDoc_Status_Processing'), variant: 'secondary' };
		case 'failed':
			return { label: t('AutoDoc_Status_Failed'), variant: 'danger' };
		case 'needs_review':
		default:
			return { label: t('AutoDoc_Status_Needs_review'), variant: 'danger' };
	}
}

function formatSize(bytes?: number): string {
	if (!bytes) {
		return '';
	}
	const mb = bytes / (1024 * 1024);
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const AutoDocQueueWidget = (): ReactElement | null => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();
	const roomId = useOpenedRoom();
	const invalidate = useInvalidateAutoDocFeed();

	const { data, isLoading } = useAutoDocFeed(true);
	const [reviewing, setReviewing] = useState<AutoDocDocument | undefined>(undefined);

	const onDrop = useCallback(
		(files: File[]) => {
			void (async () => {
				for (const file of files) {
					try {
						// NOTE: no roomId — a widget drop carries no channel context by
						// definition, so AutoDoc matches the matter itself.
						await submitToAutoDoc(file);
						dispatchToast({ type: 'success', message: t('AutoDoc_Sent_for_processing', { name: file.name }) });
					} catch (error) {
						dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('AutoDoc_Submit_failed') });
					}
				}
				await invalidate();
			})();
		},
		[dispatchToast, invalidate, t],
	);

	const onApprove = useCallback(
		(document: AutoDocDocument) => {
			void (async () => {
				try {
					await omnisPost('/v1/autodoc.approve', {
						documentId: document.id,
						matterId: document.matterId,
						...(document.roomId ?? roomId ? { roomId: document.roomId ?? roomId } : {}),
					});
					dispatchToast({ type: 'success', message: t('AutoDoc_Filed_to_matter') });
					await invalidate();
				} catch (error) {
					// AutoDoc's own behaviour on a failed approve: fall back to opening
					// the document for review rather than leaving the user stuck.
					dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('AutoDoc_Approve_failed') });
					setReviewing(document);
				}
			})();
		},
		[dispatchToast, invalidate, roomId, t],
	);

	// Renders nothing at all when the product is off. The mount also checks the
	// permission, so by the time we are here the user may see the queue.
	if (!data?.enabled) {
		return null;
	}

	const { items, summary } = data;

	return (
		<>
			<OmnisWidget
				title={t('AutoDoc_Document_intake')}
				product='AutoDoc'
				icon='doc'
				isLoading={isLoading}
				reachable={data.reachable}
				isDemoData={data.transport === 'stub'}
				counters={[
					{ value: summary.recent, label: t('AutoDoc_Counter_recent') },
					{ value: summary.ready, label: t('AutoDoc_Counter_ready') },
					{ value: summary.needsReview, label: t('AutoDoc_Counter_need_you'), emphasis: true },
				]}
				attentionCount={summary.needsReview}
				dropZone={{ hint: t('AutoDoc_Drop_to_process'), subHint: t('AutoDoc_Drop_widget_hint'), onDrop }}
				primaryAction={{
					label: t('AutoDoc_Review_queue'),
					onClick: () => setReviewing(items.find((i) => i.status !== 'ready') ?? items[0]),
				}}
			>
				{items.length === 0 && (
					<Box paddingInline={16} paddingBlock={16} fontScale='c1' color='annotation'>
						{t('AutoDoc_Queue_empty')}
					</Box>
				)}

				{items.map((document) => {
					const ready = document.status === 'ready';
					const parts = [
						document.documentType,
						formatSize(document.sizeBytes),
						document.pageCount ? t('AutoDoc_Page_count', { count: document.pageCount }) : undefined,
					].filter(Boolean);

					return (
						<OmnisWidgetRow
							key={document.id}
							icon='doc'
							primary={document.filename}
							secondary={parts.join(' · ')}
							status={statusFor(document, t)}
							onClick={() => setReviewing(document)}
							action={{
								// A `ready` document with a bound matter is one click. Anything
								// else needs the panel — including a `ready` one whose matter
								// AutoDoc had to guess, because approving that would file
								// against an unconfirmed match.
								label: ready && document.matterId ? t('AutoDoc_Approve') : t('AutoDoc_Review'),
								onClick: () => (ready && document.matterId ? onApprove(document) : setReviewing(document)),
								disabled: document.status === 'processing',
							}}
						/>
					);
				})}
			</OmnisWidget>

			{reviewing && (
				<AutoDocReviewPanel
					document={reviewing}
					webUrl={data.webUrl}
					onClose={() => setReviewing(undefined)}
					onDone={() => {
						setReviewing(undefined);
						void invalidate();
					}}
				/>
			)}
		</>
	);
};

export default AutoDocQueueWidget;
