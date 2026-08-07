import { Box } from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SendForSignaturePanel from './SendForSignaturePanel';
import { useOpenedRoom } from '../../lib/RoomManager';
import OmnisWidget from '../shell/OmnisWidget';
import OmnisWidgetRow from '../shell/OmnisWidgetRow';
import { omnisGet, omnisPost } from '../shell/omnisRest';

/**
 * The OmnisProof signatures widget.
 *
 * The secondary line carries **sent-age and viewed state**, and both earn their
 * place: "viewed twice" and "never opened" are what a paralegal chasing a
 * signature actually needs in order to decide whether to nudge or phone.
 */

type SignatureRow = {
	envelopeId: string;
	documentName: string;
	signerName: string;
	status: 'sent' | 'viewed' | 'signed' | 'declined' | 'voided';
	overdue: boolean;
	sentAt: string;
	viewCount: number;
	matterName?: string;
};

type SignatureFeed = {
	enabled: boolean;
	transport: 'stub' | 'native';
	reachable: boolean;
	webUrl: string;
	items: SignatureRow[];
	summary: { out: number; signed: number; overdue: number };
};

function ageLabel(iso: string): string {
	const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
	if (days < 1) {
		return 'sent today';
	}
	return `sent ${days}d ago`;
}

function viewLabel(row: SignatureRow, t: (k: string, o?: Record<string, unknown>) => string): string {
	if (row.status === 'signed') {
		return t('OmnisProof_Signed');
	}
	if (row.viewCount === 0) {
		return t('OmnisProof_Never_opened');
	}
	return t('OmnisProof_Viewed_count', { count: row.viewCount });
}

const SignaturesWidget = (): ReactElement | null => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();
	const roomId = useOpenedRoom();
	const [panelOpen, setPanelOpen] = useState(false);

	const { data, isLoading, refetch } = useQuery<SignatureFeed>({
		queryKey: ['omnis', 'omnisproof', 'feed', roomId ?? 'all'],
		queryFn: () => omnisGet<SignatureFeed>('/v1/omnisproof.feed', roomId ? { roomId } : {}),
		staleTime: 30_000,
	});

	const onRemind = useCallback(
		(envelopeId: string) => {
			void (async () => {
				try {
					await omnisPost('/v1/omnisproof.remind', { envelopeId });
					dispatchToast({ type: 'success', message: t('OmnisProof_Reminder_sent') });
				} catch (error) {
					dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('OmnisProof_Reminder_failed') });
				}
			})();
		},
		[dispatchToast, t],
	);

	if (!data?.enabled) {
		return null;
	}

	return (
		<>
			<OmnisWidget
				title={t('OmnisProof_Signatures')}
				product='OmnisProof'
				icon='pencil'
				isLoading={isLoading}
				reachable={data.reachable}
				isDemoData={data.transport === 'stub'}
				counters={[
					{ value: data.summary.out, label: t('OmnisProof_Counter_out') },
					{ value: data.summary.signed, label: t('OmnisProof_Counter_signed') },
					{ value: data.summary.overdue, label: t('OmnisProof_Counter_overdue'), emphasis: true },
				]}
				attentionCount={data.summary.overdue}
				primaryAction={{ label: t('OmnisProof_Send_for_signature'), onClick: () => setPanelOpen(true) }}
			>
				{data.items.length === 0 && (
					<Box paddingInline={16} paddingBlock={16} fontScale='c1' color='annotation'>
						{t('OmnisProof_Queue_empty')}
					</Box>
				)}

				{data.items.map((row) => {
					const signed = row.status === 'signed';
					return (
						<OmnisWidgetRow
							key={row.envelopeId}
							icon='pencil'
							primary={`${row.documentName} — ${row.signerName}`}
							secondary={[ageLabel(row.sentAt), viewLabel(row, t), row.matterName].filter(Boolean).join(' · ')}
							status={
								signed
									? { label: t('OmnisProof_Status_signed'), variant: 'primary' }
									: row.overdue
										? { label: t('OmnisProof_Status_overdue'), variant: 'danger' }
										: { label: t('OmnisProof_Status_awaiting'), variant: 'secondary' }
							}
							action={
								signed
									? data.webUrl
										? {
												label: t('OmnisProof_Open'),
												onClick: () => window.open(`${data.webUrl.replace(/\/+$/, '')}/envelopes/${row.envelopeId}`, '_blank'),
											}
										: undefined
									: { label: t('OmnisProof_Remind'), onClick: () => onRemind(row.envelopeId) }
							}
						/>
					);
				})}
			</OmnisWidget>

			{panelOpen && (
				<SendForSignaturePanel
					onClose={() => setPanelOpen(false)}
					onSent={() => {
						setPanelOpen(false);
						void refetch();
					}}
				/>
			)}
		</>
	);
};

export default SignaturesWidget;
