import {
	Box,
	Button,
	ButtonGroup,
	Callout,
	Field,
	FieldLabel,
	FieldRow,
	PasswordInput,
	Select,
	Tag,
	TextInput,
	ToggleSwitch,
} from '@rocket.chat/fuselage';
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
import type { ChangeEvent, ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOpenedRoom } from '../../lib/RoomManager';
import MatterContextField from '../shell/MatterContextField';
import { omnisGet, omnisPost } from '../shell/omnisRest';
import { useMatterContext } from '../shell/useMatterContext';

/**
 * Create and manage upload links.
 *
 * The consequence block is the important part of this screen. Creating a link
 * hands out a **writable door into a matter workspace** to someone with no
 * account, and the three things that then happen automatically — filed here,
 * announced there, queued to AutoDoc — are exactly what the creator must be
 * able to see before they press the button.
 *
 * The last line is the payoff: a client-uploaded bill arrives already
 * matter-bound, so AutoDoc never has to guess. Naming the RESOLVED matter (not
 * the channel that happens to be open) is what makes that promise true.
 */

type LinkRecord = {
	_id: string;
	destination: { kind: 'matter'; matterId: string; matterName: string } | { kind: 'personal' };
	recipientLabel?: string;
	requiresPassword: boolean;
	maxFiles: number;
	usedCount: number;
	expiresAt?: string;
	revokedAt?: string;
	createdAt: string;
};

const UploadLinkPanel = ({ onClose }: { onClose(): void }): ReactElement => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();
	const roomId = useOpenedRoom();
	const matterContext = useMatterContext();

	const [recipientLabel, setRecipientLabel] = useState('');
	const [requestText, setRequestText] = useState('');
	const [expiryDays, setExpiryDays] = useState('30');
	const [notifyOnUpload, setNotifyOnUpload] = useState(true);
	const [sendToAutoDoc, setSendToAutoDoc] = useState(true);
	const [password, setPassword] = useState('');
	const [requirePassword, setRequirePassword] = useState(false);
	const [createdUrl, setCreatedUrl] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	const { data: existing, refetch } = useQuery<{ links: LinkRecord[] }>({
		queryKey: ['omnis', 'litbox', 'upload-links', roomId ?? 'personal'],
		queryFn: () => omnisGet<{ links: LinkRecord[] }>('/v1/litbox.uploadLinks', roomId ? { roomId } : {}),
		staleTime: 15_000,
	});

	const destination = matterContext.destination;
	// Consequence text names the RESOLVED matter — never the open channel. (In
	// the mockup this spec came from, picking "Duong v. Metro Transit" outside a
	// matter channel still promised to file into "Alvarez v. Diaz".)
	const matterName = matterContext.resolved?.matterName;

	const onCreate = useCallback(() => {
		if (!destination) {
			return;
		}
		void (async () => {
			setBusy(true);
			try {
				const result = await omnisPost<{ url: string }>('/v1/litbox.createUploadLink', {
					...(roomId ? { roomId } : {}),
					destination: destination.kind === 'personal' ? 'personal' : 'matter',
					...(destination.kind === 'matter'
						? { matterId: destination.matter.matterId, matterName: destination.matter.matterName }
						: {}),
					...(recipientLabel ? { recipientLabel } : {}),
					...(requestText ? { requestText } : {}),
					notifyOnUpload,
					sendToAutoDoc,
					...(requirePassword && password ? { password } : {}),
					expiryDays: Number(expiryDays),
				});
				// The plaintext token exists exactly once, in this response.
				setCreatedUrl(result.url);
				await refetch();
			} catch (error) {
				dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('Litbox_Link_create_failed') });
			} finally {
				setBusy(false);
			}
		})();
	}, [
		destination,
		dispatchToast,
		expiryDays,
		notifyOnUpload,
		password,
		recipientLabel,
		refetch,
		requestText,
		requirePassword,
		roomId,
		sendToAutoDoc,
		t,
	]);

	const onRevoke = useCallback(
		(linkId: string) => {
			void (async () => {
				try {
					await omnisPost('/v1/litbox.revokeUploadLink', { linkId });
					dispatchToast({ type: 'success', message: t('Litbox_Link_revoked') });
					await refetch();
				} catch (error) {
					dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('Litbox_Link_revoke_failed') });
				}
			})();
		},
		[dispatchToast, refetch, t],
	);

	return (
		<ContextualbarDialog onClose={onClose}>
			<ContextualbarHeader>
				<ContextualbarIcon name='link' />
				<ContextualbarTitle>{t('Litbox_Create_upload_link')}</ContextualbarTitle>
				<ContextualbarClose onClick={onClose} />
			</ContextualbarHeader>

			<ContextualbarContent paddingInline={16} paddingBlock={16}>
				{createdUrl ? (
					<>
						<Callout type='success' title={t('Litbox_Link_ready')}>
							{t('Litbox_Link_copy_now')}
						</Callout>
						<Box marginBlockStart={12}>
							<TextInput readOnly value={createdUrl} />
						</Box>
						<Button
							small
							primary
							marginBlockStart={8}
							onClick={() => {
								void navigator.clipboard?.writeText(createdUrl);
								dispatchToast({ type: 'success', message: t('Litbox_Link_copied') });
							}}
						>
							{t('Litbox_Copy_link')}
						</Button>
					</>
				) : (
					<>
						<Field marginBlockEnd={16}>
							<FieldLabel>{t('Litbox_Destination')}</FieldLabel>
							<MatterContextField
								context={matterContext}
								personalLabel={t('Litbox_My_LitBox')}
								personalHint={t('Litbox_My_LitBox_hint')}
							/>
						</Field>

						<Field marginBlockEnd={16}>
							<FieldLabel>{t('Litbox_Who_is_this_for')}</FieldLabel>
							<FieldRow>
								<TextInput
									value={recipientLabel}
									placeholder={t('Litbox_Who_placeholder')}
									onChange={(e: ChangeEvent<HTMLInputElement>) => setRecipientLabel(e.currentTarget.value)}
								/>
							</FieldRow>
						</Field>

						<Field marginBlockEnd={16}>
							<FieldLabel>{t('Litbox_What_are_you_asking_for')}</FieldLabel>
							<FieldRow>
								<TextInput
									value={requestText}
									placeholder={t('Litbox_What_placeholder')}
									onChange={(e: ChangeEvent<HTMLInputElement>) => setRequestText(e.currentTarget.value)}
								/>
							</FieldRow>
						</Field>

						<Field marginBlockEnd={16}>
							<FieldLabel>{t('Litbox_Expires')}</FieldLabel>
							<FieldRow>
								<Select
									value={expiryDays}
									onChange={(value) => setExpiryDays(String(value))}
									options={[
										['7', t('Litbox_Expiry_7')],
										['30', t('Litbox_Expiry_30')],
										['90', t('Litbox_Expiry_90')],
										['0', t('Litbox_Expiry_never')],
									]}
								/>
							</FieldRow>
						</Field>

						<Field marginBlockEnd={12}>
							<FieldRow>
								<FieldLabel>{t('Litbox_Notify_channel')}</FieldLabel>
								<ToggleSwitch checked={notifyOnUpload} onChange={() => setNotifyOnUpload((v) => !v)} />
							</FieldRow>
						</Field>

						<Field marginBlockEnd={12}>
							<FieldRow>
								<FieldLabel>{t('Litbox_Send_to_autodoc')}</FieldLabel>
								<ToggleSwitch
									checked={sendToAutoDoc && destination?.kind === 'matter'}
									disabled={destination?.kind !== 'matter'}
									onChange={() => setSendToAutoDoc((v) => !v)}
								/>
							</FieldRow>
							{destination?.kind === 'personal' && (
								<Box fontScale='micro' color='annotation'>
									{t('Litbox_Autodoc_needs_matter')}
								</Box>
							)}
						</Field>

						<Field marginBlockEnd={12}>
							<FieldRow>
								<FieldLabel>{t('Litbox_Require_password')}</FieldLabel>
								<ToggleSwitch checked={requirePassword} onChange={() => setRequirePassword((v) => !v)} />
							</FieldRow>
							{requirePassword && (
								<FieldRow>
									<PasswordInput
										value={password}
										onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.currentTarget.value)}
									/>
								</FieldRow>
							)}
						</Field>

						{/* Consequence block — shown BEFORE creating. */}
						<Callout type='info' title={t('Litbox_What_will_happen')} marginBlockStart={8}>
							{destination ? (
								<Box>
									<Box>
										•{' '}
										{destination.kind === 'matter'
											? t('Litbox_Consequence_file_matter', { matter: matterName })
											: t('Litbox_Consequence_file_personal')}
									</Box>
									{notifyOnUpload && roomId && <Box>• {t('Litbox_Consequence_posted')}</Box>}
									{sendToAutoDoc && destination.kind === 'matter' && (
										<Box>• {t('Litbox_Consequence_autodoc', { matter: matterName })}</Box>
									)}
								</Box>
							) : (
								<Box>{t('Litbox_Consequence_pick_destination')}</Box>
							)}
						</Callout>

						{/* Management: active links with usage, expiry and revoke. */}
						{existing?.links?.length ? (
							<Box marginBlockStart={20}>
								<Box fontScale='p2b' marginBlockEnd={8}>
									{t('Litbox_Active_links')}
								</Box>
								{existing.links.map((link) => (
									<Box
										key={link._id}
										display='flex'
										alignItems='center'
										paddingBlock={8}
										style={{ gap: 8, borderBottom: '1px solid var(--rcx-color-stroke-extra-light, #eee)' }}
									>
										<Box flexGrow={1} style={{ minWidth: 0 }}>
											<Box fontScale='p2' withTruncatedText>
												{link.recipientLabel ?? t('Litbox_Unnamed_link')}
											</Box>
											<Box fontScale='micro' color='annotation'>
												{link.destination.kind === 'matter' ? link.destination.matterName : t('Litbox_My_LitBox')} ·{' '}
												{t('Litbox_Used_count', { used: link.usedCount, max: link.maxFiles })}
												{link.expiresAt ? ` · ${new Date(link.expiresAt).toLocaleDateString()}` : ''}
											</Box>
										</Box>
										{link.revokedAt ? (
											<Tag variant='secondary'>{t('Litbox_Revoked')}</Tag>
										) : (
											<Button tiny danger secondary onClick={() => onRevoke(link._id)}>
												{t('Litbox_Revoke')}
											</Button>
										)}
									</Box>
								))}
							</Box>
						) : null}
					</>
				)}
			</ContextualbarContent>

			<ContextualbarFooter>
				<ButtonGroup stretch>
					<Button secondary onClick={onClose}>
						{createdUrl ? t('Litbox_Done') : t('Omnis_Cancel')}
					</Button>
					{!createdUrl && (
						<Button primary disabled={busy || !destination} onClick={onCreate}>
							{t('Litbox_Create_link')}
						</Button>
					)}
				</ButtonGroup>
			</ContextualbarFooter>
		</ContextualbarDialog>
	);
};

export default UploadLinkPanel;
