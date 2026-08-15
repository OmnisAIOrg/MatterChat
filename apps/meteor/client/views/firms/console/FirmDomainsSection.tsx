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
	Skeleton,
	Tag,
	TextInput,
} from '@rocket.chat/fuselage';
import type { FirmDomainDTO } from '@rocket.chat/rest-typings';
import { useEndpoint, useSetModal, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChangeEvent, ReactElement } from 'react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { firmDomainsQueryKey } from './firmConsole';
import WarningModal from '../../../components/WarningModal';
import { useFormatDate } from '../../../hooks/useFormatDate';

/**
 * MATTERCHAT: claimed email domains — list, claim, remove.
 *
 * ## The pending state is the whole story
 *
 * A claim does NOTHING until it is verified. `verifyFirmDomain` is what flips
 * the switch, and only a link mailed to an address AT the domain can call it.
 * An owner who claims `smithlaw.com` and then watches nobody auto-join has hit
 * exactly this, so "Awaiting confirmation" is not a quiet grey label here: an
 * unverified claim carries an inline explanation naming the address the link
 * went to and stating plainly that nothing happens until it is used.
 *
 * ## Removal confirms first
 *
 * Releasing a domain is not destructive to people — members who already joined
 * stay members — but it silently changes what happens to every future signup at
 * that domain, which is the kind of change that should not be one stray click
 * away. `WarningModal` names the domain in the prompt.
 */
const FirmDomainsSection = (): ReactElement => {
	const { t } = useTranslation();
	const setModal = useSetModal();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const formatDate = useFormatDate();
	const domainFieldId = useId();
	const emailFieldId = useId();

	const listDomains = useEndpoint('GET', '/v1/firms.domains.list');
	const claimDomain = useEndpoint('POST', '/v1/firms.domains.claim');
	const removeDomain = useEndpoint('POST', '/v1/firms.domains.remove');

	const [domain, setDomain] = useState('');
	const [verificationEmail, setVerificationEmail] = useState('');
	const [formError, setFormError] = useState<string | null>(null);

	const domainsQuery = useQuery({
		queryKey: firmDomainsQueryKey,
		queryFn: () => listDomains(),
	});

	const claimMutation = useMutation({
		mutationFn: () =>
			claimDomain({
				domain: domain.trim(),
				// Omitted rather than sent empty: the server falls back to the
				// caller's own address when that is already at the domain, and an
				// empty string would fail its "must be at the domain" check.
				...(verificationEmail.trim() ? { verificationEmail: verificationEmail.trim() } : {}),
			}),
		onSuccess: async ({ sentTo }) => {
			setDomain('');
			setVerificationEmail('');
			setFormError(null);
			dispatchToastMessage({ type: 'success', message: t('Firm_Domain_Verification_Sent', { email: sentTo }) });
			await queryClient.invalidateQueries({ queryKey: firmDomainsQueryKey });
		},
		onError: (error: unknown) => setFormError(error instanceof Error ? error.message : String(error)),
	});

	const removeMutation = useMutation({
		mutationFn: (domainId: string) => removeDomain({ domainId }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: firmDomainsQueryKey });
		},
		onError: (error: unknown) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const handleClaim = (): void => {
		if (domain.trim().length === 0) {
			setFormError(t('Firm_Domain_Required'));
			return;
		}
		setFormError(null);
		claimMutation.mutate();
	};

	const handleRemove = (entry: FirmDomainDTO): void => {
		setModal(
			<WarningModal
				text={t('Firm_Domain_Remove_Confirm', { domain: entry.domain })}
				confirmText={t('Firm_Domain_Remove')}
				cancelText={t('Cancel')}
				close={() => setModal(null)}
				confirm={() => {
					setModal(null);
					removeMutation.mutate(entry._id);
				}}
			/>,
		);
	};

	const domains = domainsQuery.data?.domains ?? [];

	return (
		<>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={domainFieldId}>{t('Domain')}</FieldLabel>
					<FieldRow>
						<TextInput
							id={domainFieldId}
							value={domain}
							onChange={(e: ChangeEvent<HTMLInputElement>) => setDomain(e.currentTarget.value)}
							placeholder={t('Firm_Domain_Placeholder')}
							disabled={claimMutation.isPending}
						/>
					</FieldRow>
					<FieldHint>{t('Firm_Domain_Hint')}</FieldHint>
				</Field>

				<Field>
					<FieldLabel htmlFor={emailFieldId}>{t('Firm_Domain_Verification_Email')}</FieldLabel>
					<FieldRow>
						<TextInput
							id={emailFieldId}
							value={verificationEmail}
							onChange={(e: ChangeEvent<HTMLInputElement>) => setVerificationEmail(e.currentTarget.value)}
							placeholder={t('Firm_Domain_Verification_Email_Placeholder')}
							disabled={claimMutation.isPending}
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
					<Button primary loading={claimMutation.isPending} onClick={handleClaim}>
						{t('Firm_Domain_Claim')}
					</Button>
				</ButtonGroup>
			</Box>

			<Box marginBlockStart={24}>
				{domainsQuery.isLoading && (
					<Box display='flex' flexDirection='column'>
						<Skeleton width='full' />
						<Skeleton width='full' />
					</Box>
				)}

				{domainsQuery.isError && (
					<Callout type='danger' icon='warning' title={t('Firm_Domains_Load_Failed')}>
						<Box marginBlockEnd={8} fontScale='c1'>
							{domainsQuery.error instanceof Error ? domainsQuery.error.message : String(domainsQuery.error)}
						</Box>
						<Button small onClick={() => void domainsQuery.refetch()}>
							{t('Retry')}
						</Button>
					</Callout>
				)}

				{domainsQuery.isSuccess && domains.length === 0 && (
					<Box fontScale='p2' color='hint'>
						{t('Firm_Domains_Empty')}
					</Box>
				)}

				{domains.length > 0 && (
					<Box is='ul' role='list' display='flex' flexDirection='column' style={{ listStyle: 'none', margin: 0, padding: 0 }}>
						{domains.map((entry) => (
							<Box key={entry._id} is='li' paddingBlock={8}>
								<Box display='flex' alignItems='center' justifyContent='space-between'>
									<Box display='flex' alignItems='center' minWidth={0} marginInlineEnd={8}>
										<Box fontScale='p2m' color='default' withTruncatedText marginInlineEnd={8}>
											{entry.domain}
										</Box>
										<Tag variant={entry.verified ? 'primary' : 'secondary-warning'}>
											{entry.verified ? t('Firm_Domain_Verified') : t('Firm_Domain_Pending_Verification')}
										</Tag>
									</Box>
									<Button
										small
										danger
										flexShrink={0}
										disabled={removeMutation.isPending}
										onClick={() => handleRemove(entry)}
										aria-label={t('Firm_Domain_Remove')}
									>
										{t('Firm_Domain_Remove')}
									</Button>
								</Box>
								{/* The pending state is where owners get stuck, so it explains itself
								    in place rather than relying on the reader to know what a claim is. */}
								{!entry.verified && (
									<Box marginBlockStart={4}>
										<Callout type='warning'>
											<Box fontScale='c1'>
												{entry.verificationEmail
													? t('Firm_Domain_Pending_Explainer_With_Email', { email: entry.verificationEmail })
													: t('Firm_Domain_Pending_Explainer')}
											</Box>
											{entry.verificationExpiresAt && (
												<Box fontScale='c1' marginBlockStart={4}>
													{t('Firm_Domain_Pending_Expires', { date: formatDate(entry.verificationExpiresAt) })}
												</Box>
											)}
										</Callout>
									</Box>
								)}
							</Box>
						))}
					</Box>
				)}
			</Box>
		</>
	);
};

export default FirmDomainsSection;
