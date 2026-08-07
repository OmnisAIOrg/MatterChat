import { Box, Button, ButtonGroup, Callout, Field, FieldLabel, FieldRow, IconButton, Select, TextInput } from '@rocket.chat/fuselage';
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
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOpenedRoom } from '../../lib/RoomManager';
import MatterContextField from '../shell/MatterContextField';
import { omnisGet, omnisPost } from '../shell/omnisRest';
import { useMatterContext } from '../shell/useMatterContext';

/**
 * Send a document for signature.
 *
 * Two rules govern this screen, and both come from the same place — this is the
 * moment a matter's status, fee percentage and limitations clock can all move
 * at once, and the person sending is often not the person who will notice if it
 * went to the wrong matter.
 *
 * ### 1. The document type is withheld until a matter is resolved
 *
 * A document type only means something relative to a matter. Offering "Letter
 * of Protection" before the user has said whose matter it belongs to is
 * offering a choice that cannot be honoured. Until then the consequence block
 * reads: *"Pick a matter first; the document type and its data entry depend on
 * it."*
 *
 * ### 2. The consequence text names the RESOLVED matter
 *
 * Never a placeholder, and never the channel that happens to be open. This was
 * a real bug in the mockup this spec came from: outside a matter channel,
 * picking *Duong v. Metro Transit* still promised to file into *Alvarez v.
 * Diaz*. On a screen whose only job is telling you what is about to happen,
 * that is the worst thing to get wrong. The preview is therefore rendered
 * SERVER-side from the same mapping records the automations will execute, keyed
 * on the resolved matter.
 */

type Signer = { name: string; email: string; role: 'client' | 'provider' | 'adjuster'; order: number };

const emptySigner = (order: number): Signer => ({ name: '', email: '', role: 'client', order });

const SendForSignaturePanel = ({ onClose, onSent }: { onClose(): void; onSent(): void }): ReactElement => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();
	const roomId = useOpenedRoom();
	const matterContext = useMatterContext();

	const [documentName, setDocumentName] = useState('');
	const [signers, setSigners] = useState<Signer[]>([emptySigner(1)]);
	const [isMatterDocument, setIsMatterDocument] = useState(true);
	const [documentTypeKey, setDocumentTypeKey] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	const { data: types } = useQuery<{ types: { key: string; label: string }[] }>({
		queryKey: ['omnis', 'omnisproof', 'document-types'],
		queryFn: () => omnisGet<{ types: { key: string; label: string }[] }>('/v1/omnisproof.documentTypes'),
		staleTime: 300_000,
	});

	const resolvedMatter = matterContext.resolved;
	// The type control does not exist until a matter does.
	const matterResolved = isMatterDocument && Boolean(resolvedMatter);

	const { data: preview } = useQuery<{ steps: { label: string }[]; matterName: string | null }>({
		queryKey: ['omnis', 'omnisproof', 'preview', documentTypeKey ?? '', resolvedMatter?.matterId ?? '', roomId ?? ''],
		queryFn: () =>
			omnisPost<{ steps: { label: string }[]; matterName: string | null }>('/v1/omnisproof.preview', {
				documentTypeKey,
				...(resolvedMatter ? { matterId: resolvedMatter.matterId, matterName: resolvedMatter.matterName } : {}),
				...(roomId ? { roomId } : {}),
			}),
		enabled: matterResolved && Boolean(documentTypeKey),
		staleTime: 60_000,
	});

	const updateSigner = useCallback((index: number, patch: Partial<Signer>) => {
		setSigners((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));
	}, []);

	const onSend = useCallback(() => {
		void (async () => {
			setBusy(true);
			try {
				await omnisPost('/v1/omnisproof.send', {
					documentName,
					signers: signers.filter((s) => s.name && s.email),
					isMatterDocument,
					...(isMatterDocument && resolvedMatter ? { matterId: resolvedMatter.matterId } : {}),
					...(isMatterDocument && documentTypeKey ? { documentTypeKey } : {}),
					...(roomId ? { roomId } : {}),
				});
				dispatchToast({ type: 'success', message: t('OmnisProof_Sent') });
				onSent();
			} catch (error) {
				dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('OmnisProof_Send_failed') });
			} finally {
				setBusy(false);
			}
		})();
	}, [documentName, documentTypeKey, dispatchToast, isMatterDocument, onSent, resolvedMatter, roomId, signers, t]);

	const canSend =
		Boolean(documentName) &&
		signers.some((s) => s.name && s.email) &&
		(!isMatterDocument || (Boolean(resolvedMatter) && Boolean(documentTypeKey)));

	return (
		<ContextualbarDialog onClose={onClose}>
			<ContextualbarHeader>
				<ContextualbarIcon name='pencil' />
				<ContextualbarTitle>{t('OmnisProof_Send_for_signature')}</ContextualbarTitle>
				<ContextualbarClose onClick={onClose} />
			</ContextualbarHeader>

			<ContextualbarContent paddingInline={16} paddingBlock={16}>
				<Field marginBlockEnd={16}>
					<FieldLabel>{t('OmnisProof_Document')}</FieldLabel>
					<FieldRow>
						<TextInput
							value={documentName}
							placeholder={t('OmnisProof_Document_placeholder')}
							onChange={(e) => setDocumentName((e.target as HTMLInputElement).value)}
						/>
					</FieldRow>
				</Field>

				{/* Signers, ordered. */}
				<Box fontScale='p2b' marginBlockEnd={8}>
					{t('OmnisProof_Signers')}
				</Box>
				{signers.map((signer, index) => (
					<Box key={index} display='flex' alignItems='flex-end' marginBlockEnd={8} style={{ gap: 6 }}>
						<Box flexGrow={1}>
							<TextInput
								value={signer.name}
								placeholder={t('OmnisProof_Signer_name')}
								onChange={(e) => updateSigner(index, { name: (e.target as HTMLInputElement).value })}
							/>
						</Box>
						<Box flexGrow={1}>
							<TextInput
								value={signer.email}
								placeholder={t('OmnisProof_Signer_email')}
								onChange={(e) => updateSigner(index, { email: (e.target as HTMLInputElement).value })}
							/>
						</Box>
						<Select
							value={signer.role}
							onChange={(value) => updateSigner(index, { role: value as Signer['role'] })}
							options={[
								['client', t('OmnisProof_Role_client')],
								['provider', t('OmnisProof_Role_provider')],
								['adjuster', t('OmnisProof_Role_adjuster')],
							]}
						/>
						{signers.length > 1 && (
							<IconButton
								icon='cross'
								tiny
								onClick={() => setSigners((current) => current.filter((_, i) => i !== index))}
								title={t('OmnisProof_Remove_signer')}
							/>
						)}
					</Box>
				))}
				<Button small secondary marginBlockEnd={16} onClick={() => setSigners((c) => [...c, emptySigner(c.length + 1)])}>
					{t('OmnisProof_Add_signer')}
				</Button>

				{/* The fork. */}
				<Field marginBlockEnd={16}>
					<FieldLabel>{t('OmnisProof_Tied_to_matter')}</FieldLabel>
					<FieldRow>
						<Select
							value={isMatterDocument ? 'matter' : 'general'}
							onChange={(value) => setIsMatterDocument(value === 'matter')}
							options={[
								['matter', t('OmnisProof_Matter_document')],
								['general', t('OmnisProof_General')],
							]}
						/>
					</FieldRow>
				</Field>

				{isMatterDocument && (
					<Field marginBlockEnd={16}>
						<FieldLabel>{t('Omnis_Matter')}</FieldLabel>
						<MatterContextField context={matterContext} personalLabel={t('OmnisProof_General')} />
					</Field>
				)}

				{/* Document type — ONLY once a matter is resolved. */}
				{matterResolved && (
					<Field marginBlockEnd={16}>
						<FieldLabel>{t('OmnisProof_Document_type')}</FieldLabel>
						<FieldRow>
							<Select
								value={documentTypeKey ?? ''}
								placeholder={t('OmnisProof_Choose_type')}
								onChange={(value) => setDocumentTypeKey(String(value))}
								options={(types?.types ?? []).map((type) => [type.key, type.label] as [string, string])}
							/>
						</FieldRow>
					</Field>
				)}

				{/* Consequence preview — live, and it names the resolved matter. */}
				<Callout type={matterResolved && documentTypeKey ? 'warning' : 'info'} title={t('OmnisProof_On_signature')}>
					{!isMatterDocument ? (
						<Box>{t('OmnisProof_Consequence_general')}</Box>
					) : !resolvedMatter ? (
						<Box>{t('OmnisProof_Consequence_pick_matter')}</Box>
					) : !documentTypeKey ? (
						<Box>{t('OmnisProof_Consequence_pick_type')}</Box>
					) : (
						<Box>
							{(preview?.steps ?? []).map((step) => (
								<Box key={step.label}>• {step.label}</Box>
							))}
							<Box>• {t('OmnisProof_Consequence_receipt')}</Box>
						</Box>
					)}
				</Callout>
			</ContextualbarContent>

			<ContextualbarFooter>
				<ButtonGroup stretch>
					<Button secondary onClick={onClose}>
						{t('Omnis_Cancel')}
					</Button>
					<Button primary disabled={busy || !canSend} onClick={onSend}>
						{t('OmnisProof_Send')}
					</Button>
				</ButtonGroup>
			</ContextualbarFooter>
		</ContextualbarDialog>
	);
};

export default SendForSignaturePanel;
