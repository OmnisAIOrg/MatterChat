import {
	Box,
	Button,
	ButtonGroup,
	Callout,
	Field,
	FieldGroup,
	FieldHint,
	FieldLabel,
	FieldRow,
	Select,
	Skeleton,
	TextAreaInput,
} from '@rocket.chat/fuselage';
import type { FirmInviteDTO } from '@rocket.chat/rest-typings';
import { useEndpoint, useSetModal, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChangeEvent, ReactElement } from 'react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	INVITE_DAYS_OPTIONS,
	INVITE_DEFAULT_DAYS,
	INVITE_DEFAULT_MAX_USES,
	INVITE_MAX_USES_OPTIONS,
	firmInvitesQueryKey,
} from './firmConsole';
import TextCopy from '../../../components/TextCopy';
import WarningModal from '../../../components/WarningModal';
import { useFormatDate } from '../../../hooks/useFormatDate';

/**
 * MATTERCHAT: the firm's live invite links — list, create, revoke.
 *
 * ## Selects, not number inputs
 *
 * `days` and `maxUses` are whitelists on the server (0/1/7/15/30 and
 * 0/1/5/10/25/50/100). Out-of-whitelist values are REJECTED, not rounded — see
 * `validateInviteOptions` — so a free-text field would let an owner type "14"
 * and receive an error with no way to act on it. Offering only the legal values
 * makes the invalid state unreachable from the UI.
 *
 * ## Why creating a link asks for email addresses
 *
 * `firms.invite` mails the link and throws `error-email-send-failed` when no
 * valid address is supplied, so there is no server path to "mint a link and
 * show it to me". Rather than fake one, the form is honest about what it does:
 * you invite people, and the link it used is then listed here (and rendered as
 * a QR code below) for anyone you would rather hand it to in person.
 *
 * ## Revoking asks first
 *
 * Revocation is irreversible and silently breaks a link that may already be
 * pasted into somebody's email, so it goes through `WarningModal`. The endpoint
 * is not called until the modal is confirmed.
 */
const FirmInvitesSection = (): ReactElement => {
	const { t } = useTranslation();
	const setModal = useSetModal();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const formatDate = useFormatDate();
	const emailsFieldId = useId();
	const daysFieldId = useId();
	const maxUsesFieldId = useId();

	const listInvites = useEndpoint('GET', '/v1/firms.invites.list');
	const createInvite = useEndpoint('POST', '/v1/firms.invite');
	const revokeInvite = useEndpoint('POST', '/v1/firms.invites.revoke');

	const [emailsRaw, setEmailsRaw] = useState('');
	const [days, setDays] = useState(String(INVITE_DEFAULT_DAYS));
	const [maxUses, setMaxUses] = useState(String(INVITE_DEFAULT_MAX_USES));
	const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);

	const invitesQuery = useQuery({
		queryKey: firmInvitesQueryKey,
		queryFn: () => listInvites(),
	});

	// 0 means "no limit" in both whitelists, and 1 needs a singular — hence the
	// two special cases before the general label.
	const daysLabel = (value: number): string => {
		if (value === 0) {
			return t('Firm_Invite_Never_Expires');
		}
		if (value === 1) {
			return t('Firm_Invite_Expiry_One_Day');
		}
		return t('Firm_Invite_Expiry_Days', { days: value });
	};

	const maxUsesLabel = (value: number): string => {
		if (value === 0) {
			return t('Firm_Invite_Unlimited_Uses');
		}
		if (value === 1) {
			return t('Firm_Invite_Uses_Max_One');
		}
		return t('Firm_Invite_Uses_Max', { maxUses: value });
	};

	const daysOptions: [string, string][] = INVITE_DAYS_OPTIONS.map((value) => [String(value), daysLabel(value)]);
	const maxUsesOptions: [string, string][] = INVITE_MAX_USES_OPTIONS.map((value) => [String(value), maxUsesLabel(value)]);

	const createMutation = useMutation({
		mutationFn: (emails: string[]) => createInvite({ emails, days: Number(days), maxUses: Number(maxUses) }),
		onSuccess: async (result) => {
			setLastCreatedUrl(result.inviteUrl);
			setEmailsRaw('');
			if (result.sent.length > 0) {
				dispatchToastMessage({ type: 'success', message: t('Firm_invites_sent', { count: result.sent.length }) });
			}
			if (result.invalid.length > 0) {
				dispatchToastMessage({ type: 'warning', message: t('Firm_invites_failed', { emails: result.invalid.join(', ') }) });
			}
			await queryClient.invalidateQueries({ queryKey: firmInvitesQueryKey });
		},
		onError: (error: unknown) => {
			setFormError(error instanceof Error ? error.message : String(error));
		},
	});

	const revokeMutation = useMutation({
		mutationFn: (inviteId: string) => revokeInvite({ inviteId }),
		onSuccess: async () => {
			dispatchToastMessage({ type: 'success', message: t('Firm_Invite_Revoked') });
			await queryClient.invalidateQueries({ queryKey: firmInvitesQueryKey });
		},
		onError: (error: unknown) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const handleCreate = (): void => {
		const emails = emailsRaw
			.split(/[\s,;]+/)
			.map((email) => email.trim())
			.filter(Boolean);

		if (emails.length === 0) {
			// Matches the server's own rule so the failure is explained here rather
			// than arriving as `error-email-send-failed` from a round trip.
			setFormError(t('Firm_Invite_Emails_Required'));
			return;
		}

		setFormError(null);
		createMutation.mutate(emails);
	};

	const handleRevoke = (invite: FirmInviteDTO): void => {
		setModal(
			<WarningModal
				text={t('Firm_Invite_Revoke_Confirm')}
				confirmText={t('Firm_Invite_Revoke')}
				cancelText={t('Cancel')}
				close={() => setModal(null)}
				confirm={() => {
					setModal(null);
					revokeMutation.mutate(invite._id);
				}}
			/>,
		);
	};

	const invites = invitesQuery.data?.invites ?? [];

	return (
		<>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={emailsFieldId}>{t('Firm_invite_emails')}</FieldLabel>
					<FieldRow>
						<TextAreaInput
							id={emailsFieldId}
							rows={3}
							value={emailsRaw}
							onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEmailsRaw(e.currentTarget.value)}
							placeholder={t('Firm_invite_emails_placeholder')}
							disabled={createMutation.isPending}
						/>
					</FieldRow>
					<FieldHint>{t('Firm_Invite_Create_Hint')}</FieldHint>
				</Field>

				<Field>
					<FieldLabel htmlFor={daysFieldId}>{t('Firm_Invite_Expires_In')}</FieldLabel>
					<FieldRow>
						{/* react-aria's Select does not pick up the FieldLabel's htmlFor, so the
						    accessible name has to be stated outright or the control announces
						    only its current value. */}
						<Select
							id={daysFieldId}
							aria-label={t('Firm_Invite_Expires_In')}
							options={daysOptions}
							value={days}
							onChange={(value) => setDays(String(value))}
							disabled={createMutation.isPending}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel htmlFor={maxUsesFieldId}>{t('Firm_Invite_Max_Uses')}</FieldLabel>
					<FieldRow>
						<Select
							id={maxUsesFieldId}
							aria-label={t('Firm_Invite_Max_Uses')}
							options={maxUsesOptions}
							value={maxUses}
							onChange={(value) => setMaxUses(String(value))}
							disabled={createMutation.isPending}
						/>
					</FieldRow>
				</Field>
			</FieldGroup>

			{formError && (
				<Box marginBlockStart={8}>
					<Callout type='danger'>{formError}</Callout>
				</Box>
			)}

			{/* ButtonGroup takes no Fuselage styling props, so the spacing lives on a Box. */}
			<Box marginBlockStart={12}>
				<ButtonGroup>
					<Button primary loading={createMutation.isPending} onClick={handleCreate}>
						{t('Firm_invite_send_action')}
					</Button>
				</ButtonGroup>
			</Box>

			{lastCreatedUrl && (
				<Box marginBlockStart={12}>
					<Callout type='success' title={t('Firm_Invite_Created')}>
						<Box fontScale='c1' marginBlockEnd={4}>
							{t('Firm_Invite_Created_Hint')}
						</Box>
						<TextCopy text={lastCreatedUrl} />
					</Callout>
				</Box>
			)}

			<Box marginBlockStart={24}>
				{invitesQuery.isLoading && (
					<Box display='flex' flexDirection='column'>
						<Skeleton width='full' />
						<Skeleton width='full' />
					</Box>
				)}

				{invitesQuery.isError && (
					<Callout type='danger' icon='warning' title={t('Firm_Invites_Load_Failed')}>
						<Box marginBlockEnd={8} fontScale='c1'>
							{invitesQuery.error instanceof Error ? invitesQuery.error.message : String(invitesQuery.error)}
						</Box>
						<Button small onClick={() => void invitesQuery.refetch()}>
							{t('Retry')}
						</Button>
					</Callout>
				)}

				{invitesQuery.isSuccess && invites.length === 0 && (
					<Box fontScale='p2' color='hint'>
						{t('Firm_Invites_Empty')}
					</Box>
				)}

				{invites.length > 0 && (
					<Box is='ul' role='list' display='flex' flexDirection='column' style={{ listStyle: 'none', margin: 0, padding: 0 }}>
						{invites.map((invite) => (
							<Box key={invite._id} is='li' display='flex' alignItems='flex-start' justifyContent='space-between' paddingBlock={8}>
								<Box display='flex' flexDirection='column' minWidth={0} marginInlineEnd={8}>
									<Box fontScale='p2m' color='default' style={{ wordBreak: 'break-all' }}>
										{invite.url}
									</Box>
									<Box fontScale='c1' color='hint'>
										{invite.maxUses === 0
											? t('Firm_Invite_Uses_Unlimited_Count', { uses: invite.uses })
											: t('Firm_Invite_Uses_Count', { uses: invite.uses, maxUses: invite.maxUses })}
										{' · '}
										{invite.expires ? t('Firm_Invite_Expires_On', { date: formatDate(invite.expires) }) : t('Firm_Invite_Never_Expires')}
									</Box>
								</Box>
								<Button
									small
									danger
									flexShrink={0}
									disabled={revokeMutation.isPending}
									onClick={() => handleRevoke(invite)}
									aria-label={t('Firm_Invite_Revoke')}
								>
									{t('Firm_Invite_Revoke')}
								</Button>
							</Box>
						))}
					</Box>
				)}
			</Box>
		</>
	);
};

export default FirmInvitesSection;
