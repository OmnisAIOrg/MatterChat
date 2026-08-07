import { Box } from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UploadLinkPanel from './UploadLinkPanel';
import { useOpenedRoom } from '../../lib/RoomManager';
import OmnisWidget from '../shell/OmnisWidget';
import OmnisWidgetRow from '../shell/OmnisWidgetRow';
import { omnisGet, omnisUpload } from '../shell/omnisRest';

/**
 * The LitBox matter-files widget.
 *
 * Scope follows the shared context rule: in a matter channel it shows that
 * matter's workspace; elsewhere it shows the user's own LitBox.
 *
 * **Attach is a reference operation.** MatterChat and CasePro point at the same
 * LitBox tenant, so a `documentId` is org-resolvable server-side by anyone
 * holding a LitBox credential for that org. Attaching therefore puts a
 * `documentId` + `organizationId` into the composer and moves ZERO bytes. One
 * physical file, many app-links; nobody re-uploads.
 */

type LitboxFileRow = {
	id: string;
	name: string;
	sizeBytes: number;
	uploadedBy?: string;
	uploadedAt: string;
	state: 'synced' | 'processing' | 'needs_ocr' | 'failed';
	organizationId?: string;
};

type LitboxFilesResponse = {
	connected: boolean;
	reachable: boolean;
	isDemoData: boolean;
	files: LitboxFileRow[];
	summary: { files: number; thisWeek: number; needsOcr: number };
	scope: { matterId: string; matterName: string } | null;
};

function formatSize(bytes: number): string {
	if (!bytes) {
		return '';
	}
	const mb = bytes / (1024 * 1024);
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function relativeAge(iso: string): string {
	const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
	if (hours < 1) {
		return 'just now';
	}
	if (hours < 24) {
		return `${hours}h ago`;
	}
	return `${Math.round(hours / 24)}d ago`;
}

const LitboxFilesWidget = (): ReactElement | null => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();
	const roomId = useOpenedRoom();
	const [panelOpen, setPanelOpen] = useState(false);

	const { data, isLoading, refetch } = useQuery<LitboxFilesResponse>({
		queryKey: ['omnis', 'litbox', 'files', roomId ?? 'personal'],
		queryFn: () => omnisGet<LitboxFilesResponse>('/v1/litbox.matterFiles', roomId ? { roomId } : {}),
		staleTime: 30_000,
	});

	const onAttach = useCallback(
		(file: LitboxFileRow) => {
			// Reference only: the composer receives a LitBox deep-link, not bytes.
			const reference = `litbox://${file.organizationId ?? 'org'}/${file.id}`;
			void navigator.clipboard?.writeText(reference).catch(() => undefined);
			dispatchToast({ type: 'success', message: t('Litbox_Reference_copied', { name: file.name }) });
		},
		[dispatchToast, t],
	);

	const onDrop = useCallback(
		(files: File[]) => {
			void (async () => {
				for (const file of files) {
					const form = new FormData();
					form.append('file', file, file.name);
					if (roomId) {
						form.append('roomId', roomId);
					}
					try {
						await omnisUpload('/v1/litbox.matterUpload', form);
					} catch (error) {
						dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('Litbox_Upload_failed') });
					}
				}
				await refetch();
			})();
		},
		[dispatchToast, refetch, roomId, t],
	);

	if (!data) {
		return null;
	}

	const scopeName = data.scope?.matterName;

	return (
		<>
			<OmnisWidget
				title={scopeName ? t('Litbox_Matter_files_scoped', { matter: scopeName }) : t('Litbox_My_files')}
				product='LitBox'
				icon='folder'
				isLoading={isLoading}
				reachable={data.reachable}
				isDemoData={data.isDemoData}
				counters={[
					{ value: data.summary.files, label: t('Litbox_Counter_files') },
					{ value: data.summary.thisWeek, label: t('Litbox_Counter_this_week') },
					{ value: data.summary.needsOcr, label: t('Litbox_Counter_needs_ocr'), emphasis: true },
				]}
				attentionCount={data.summary.needsOcr}
				dropZone={{
					hint: t('Litbox_Drop_to_upload'),
					subHint: scopeName ? t('Litbox_Drop_hint_matter', { matter: scopeName }) : t('Litbox_Drop_hint_personal'),
					onDrop,
				}}
				primaryAction={{ label: t('Litbox_Create_upload_link'), onClick: () => setPanelOpen(true) }}
			>
				{!data.connected && (
					<Box paddingInline={16} paddingBlock={16} fontScale='c1' color='annotation'>
						{t('Litbox_Not_connected')}
					</Box>
				)}

				{data.connected && data.files.length === 0 && data.reachable && (
					<Box paddingInline={16} paddingBlock={16} fontScale='c1' color='annotation'>
						{t('Litbox_No_files')}
					</Box>
				)}

				{data.files.map((file) => (
					<OmnisWidgetRow
						key={file.id}
						icon='clip'
						primary={file.name}
						secondary={[formatSize(file.sizeBytes), file.uploadedBy, relativeAge(file.uploadedAt)].filter(Boolean).join(' · ')}
						status={
							file.state === 'needs_ocr'
								? { label: t('Litbox_State_needs_ocr'), variant: 'danger' }
								: file.state === 'processing'
									? { label: t('Litbox_State_processing'), variant: 'secondary' }
									: file.state === 'failed'
										? { label: t('Litbox_State_failed'), variant: 'danger' }
										: { label: t('Litbox_State_synced'), variant: 'primary' }
						}
						action={{ label: t('Litbox_Attach'), onClick: () => onAttach(file) }}
					/>
				))}
			</OmnisWidget>

			{panelOpen && <UploadLinkPanel onClose={() => setPanelOpen(false)} />}
		</>
	);
};

export default LitboxFilesWidget;
