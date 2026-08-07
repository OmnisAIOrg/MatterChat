import { Box, Button, ButtonGroup, Callout, Field, FieldLabel, FieldRow, Tag, TextInput } from '@rocket.chat/fuselage';
import {
	ContextualbarClose,
	ContextualbarContent,
	ContextualbarDialog,
	ContextualbarFooter,
	ContextualbarHeader,
	ContextualbarIcon,
	ContextualbarTitle,
} from '@rocket.chat/ui-client';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AutoDocDocument } from './useAutoDocFeed';
import { useOpenedRoom } from '../../lib/RoomManager';
import MatterContextField from '../shell/MatterContextField';
import { omnisPost } from '../shell/omnisRest';
import { useMatterContext } from '../shell/useMatterContext';

/**
 * The AutoDoc review panel — a contextual bar, the same pattern as Threads and
 * Files.
 *
 * **This was reversed from the first draft**, which opened AutoDoc's web app in
 * a new tab. Ejecting the user into a second application is exactly the context
 * switch the whole feature exists to remove, so review stays in MatterChat and
 * "Open in AutoDoc" survives only as a link for anyone who wants the full tool.
 *
 * Corrections are posted back to AutoDoc's correction API, which also feeds its
 * spatial extraction feedback loop — so a fix makes future extractions better
 * rather than being thrown away.
 */

/** Below this, a field is flagged and the human is expected to look at it. */
const LOW_CONFIDENCE = 0.75;

export type AutoDocReviewPanelProps = {
	document: AutoDocDocument;
	webUrl: string;
	onClose(): void;
	onDone(): void;
};

const AutoDocReviewPanel = ({ document, webUrl, onClose, onDone }: AutoDocReviewPanelProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();
	const roomId = useOpenedRoom();
	const matterContext = useMatterContext();

	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries((document.fields ?? []).map((field) => [field.name, field.value])),
	);
	const [busy, setBusy] = useState(false);

	// A document already bound to a matter needs no picker: the binding happened
	// at intake, in the channel it was dropped in.
	const boundMatterId = document.matterId;
	const resolvedMatterId = boundMatterId ?? matterContext.resolved?.matterId;

	const corrections = useMemo(
		() =>
			(document.fields ?? [])
				.filter((field) => values[field.name] !== undefined && values[field.name] !== field.value)
				.map((field) => ({ name: field.name, value: values[field.name] })),
		[document.fields, values],
	);

	const lowConfidenceRegion = useMemo(
		() => (document.fields ?? []).find((field) => field.confidence < LOW_CONFIDENCE && field.region)?.region,
		[document.fields],
	);

	const onFile = useCallback(() => {
		if (!resolvedMatterId) {
			return;
		}
		void (async () => {
			setBusy(true);
			try {
				await omnisPost('/v1/autodoc.approve', {
					documentId: document.id,
					matterId: resolvedMatterId,
					...(corrections.length ? { corrections } : {}),
					...(document.roomId ?? roomId ? { roomId: document.roomId ?? roomId } : {}),
				});
				dispatchToast({ type: 'success', message: t('AutoDoc_Filed_to_matter') });
				onDone();
			} catch (error) {
				dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('AutoDoc_Approve_failed') });
			} finally {
				setBusy(false);
			}
		})();
	}, [corrections, dispatchToast, document.id, document.roomId, onDone, resolvedMatterId, roomId, t]);

	const onReject = useCallback(() => {
		void (async () => {
			setBusy(true);
			try {
				await omnisPost('/v1/autodoc.reject', { documentId: document.id });
				dispatchToast({ type: 'success', message: t('AutoDoc_Rejected') });
				onDone();
			} catch (error) {
				dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('AutoDoc_Reject_failed') });
			} finally {
				setBusy(false);
			}
		})();
	}, [dispatchToast, document.id, onDone, t]);

	return (
		<ContextualbarDialog onClose={onClose}>
			<ContextualbarHeader>
				<ContextualbarIcon name='doc' />
				<ContextualbarTitle>{document.filename}</ContextualbarTitle>
				<ContextualbarClose onClick={onClose} />
			</ContextualbarHeader>

			<ContextualbarContent paddingInline={16} paddingBlock={16}>
				{/* Page preview, with the low-confidence region called out. */}
				<Box
					backgroundColor='surface-tint'
					position='relative'
					style={{ height: 200, borderRadius: 6, overflow: 'hidden', marginBlockEnd: 16 }}
				>
					{document.previewUrl ? (
						<Box
							is='img'
							src={document.previewUrl}
							alt={document.filename}
							style={{ width: '100%', height: '100%', objectFit: 'contain' }}
						/>
					) : (
						<Box display='flex' alignItems='center' justifyContent='center' height='100%' fontScale='c1' color='annotation'>
							{t('AutoDoc_No_preview')}
						</Box>
					)}
					{lowConfidenceRegion && (
						<Box
							position='absolute'
							style={{
								left: `${lowConfidenceRegion.x * 100}%`,
								top: `${lowConfidenceRegion.y * 100}%`,
								width: `${lowConfidenceRegion.width * 100}%`,
								height: `${lowConfidenceRegion.height * 100}%`,
								border: '2px solid var(--rcx-color-status-font-on-warning, #b68d00)',
								borderRadius: 3,
							}}
						/>
					)}
				</Box>

				{/* Matter — the field most often missing. */}
				<Field marginBlockEnd={16}>
					<FieldLabel>{t('Omnis_Matter')}</FieldLabel>
					{boundMatterId ? (
						<Box display='flex' alignItems='center' style={{ gap: 8 }}>
							<Tag variant='primary'>{t('AutoDoc_Matter_bound_at_intake')}</Tag>
						</Box>
					) : (
						<MatterContextField
							context={matterContext}
							{...(document.matterGuess
								? {
										guess: {
											matterId: document.matterGuess.matterId,
											matterName: document.matterGuess.matterName,
											confidence: document.matterGuess.confidence,
											source: 'guess' as const,
										},
									}
								: {})}
							personalLabel={t('AutoDoc_File_without_matter')}
						/>
					)}
				</Field>

				{/* Extracted fields. Low-confidence ones are flagged, all are editable. */}
				<Box fontScale='p2b' marginBlockEnd={8}>
					{t('AutoDoc_Extracted_fields')}
				</Box>
				{(document.fields ?? []).map((field) => {
					const low = field.confidence < LOW_CONFIDENCE;
					return (
						<Field key={field.name} marginBlockEnd={12}>
							<FieldLabel>
								<Box display='flex' alignItems='center' style={{ gap: 6 }}>
									{field.label}
									<Tag variant={low ? 'danger' : 'secondary'}>{Math.round(field.confidence * 100)}%</Tag>
								</Box>
							</FieldLabel>
							<FieldRow>
								<TextInput
									value={values[field.name] ?? ''}
									onChange={(event) =>
										setValues((current) => ({ ...current, [field.name]: (event.target as HTMLInputElement).value }))
									}
								/>
							</FieldRow>
						</Field>
					);
				})}

				{!resolvedMatterId && (
					<Callout type='warning' marginBlockStart={12}>
						{t('AutoDoc_Pick_a_matter_first')}
					</Callout>
				)}

				{webUrl && (
					<Box marginBlockStart={16}>
						<Box
							is='a'
							href={`${webUrl.replace(/\/+$/, '')}/documents/${document.id}`}
							target='_blank'
							rel='noopener noreferrer'
							fontScale='c1'
						>
							{t('AutoDoc_Open_in_AutoDoc')}
						</Box>
					</Box>
				)}
			</ContextualbarContent>

			<ContextualbarFooter>
				<ButtonGroup stretch>
					<Button danger secondary disabled={busy} onClick={onReject}>
						{t('AutoDoc_Reject')}
					</Button>
					<Button primary disabled={busy || !resolvedMatterId} onClick={onFile}>
						{t('AutoDoc_File_to_matter')}
					</Button>
				</ButtonGroup>
			</ContextualbarFooter>
		</ContextualbarDialog>
	);
};

export default AutoDocReviewPanel;
