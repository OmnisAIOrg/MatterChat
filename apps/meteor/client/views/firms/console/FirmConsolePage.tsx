import { Box, Button, Callout, Skeleton } from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint, useUser } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import FirmConsoleSection from './FirmConsoleSection';
import FirmDomainsSection from './FirmDomainsSection';
import FirmInvitesSection from './FirmInvitesSection';
import FirmMembersSection from './FirmMembersSection';
import FirmProfileSection from './FirmProfileSection';
import FirmQrHandoffSection from './FirmQrHandoffSection';
import { firmMineQueryKey } from './firmConsole';

/**
 * MATTERCHAT: the Firm Console — one screen a firm owner can actually read.
 *
 * ## Why this exists
 *
 * Everything here is technically already doable in Rocket.Chat's administration
 * area. That area is built for server operators: it exposes hundreds of
 * workspace-wide settings, it is where you can break the deployment, and it
 * reliably intimidates the office manager who ends up owning the firm. This
 * screen covers the handful of things a firm actually needs — who is in it, how
 * people get in, which email domain belongs to it, and how to set up a phone —
 * and nothing else.
 *
 * ## Access
 *
 * `firms.mine` reports `isOwner`. Owners (and workspace admins, who the server
 * also authorizes) get the management sections; everybody else gets the
 * read-only half — the firm's identity and its roster — with a line explaining
 * why the rest is not shown. A non-owner must not meet a blank screen or a
 * wall of failed requests, but neither should they be shown controls that would
 * 403: `firms.invites.list` and `firms.domains.list` are owner/admin-only, so
 * for a member those sections are not rendered at all rather than rendered
 * broken.
 *
 * **Hiding is cosmetic.** Every one of these endpoints re-checks authorization
 * server-side in `requireFirmInviteAdmin` / the domains equivalent. Nothing here
 * is a security boundary; it is an attempt not to show somebody a button that
 * will only ever fail for them.
 */
const FirmConsolePage = (): ReactElement => {
	const { t } = useTranslation();
	const user = useUser();

	const getMyFirm = useEndpoint('GET', '/v1/firms.mine');

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: firmMineQueryKey,
		queryFn: () => getMyFirm(),
	});

	// Mirrors the server's own test: the firm owner OR a workspace admin. An
	// admin who is not the firm's owner can still administer it, so showing them
	// a read-only screen would be wrong in the other direction.
	const isWorkspaceAdmin = Boolean(user?.roles?.includes('admin'));
	const canManage = Boolean(data?.firm?.isOwner) || isWorkspaceAdmin;

	const renderBody = (): ReactElement => {
		if (isLoading) {
			return (
				<Box display='flex' flexDirection='column'>
					<Skeleton width='full' />
					<Skeleton width='full' />
					<Skeleton width='full' />
				</Box>
			);
		}

		if (isError) {
			return (
				<Callout type='danger' icon='warning' title={t('Firm_Console_Load_Failed')}>
					<Box marginBlockEnd={8} fontScale='c1'>
						{error instanceof Error ? error.message : String(error)}
					</Box>
					<Button small onClick={() => void refetch()}>
						{t('Retry')}
					</Button>
				</Callout>
			);
		}

		if (!data?.enabled) {
			return <Callout type='info'>{t('Firm_Console_Disabled')}</Callout>;
		}

		const { firm } = data;

		if (!firm) {
			return <Callout type='info'>{t('Firm_Console_No_Firm')}</Callout>;
		}

		return (
			<>
				{!canManage && (
					<Box marginBlockEnd={24}>
						<Callout type='info'>{t('Firm_Console_Readonly_Notice')}</Callout>
					</Box>
				)}

				<FirmConsoleSection title={t('Firm_Console_Firm_Section')}>
					<FirmProfileSection firm={firm} />
				</FirmConsoleSection>

				<FirmConsoleSection title={t('Members')} description={t('Firm_Members_Description')}>
					<FirmMembersSection firm={firm} />
				</FirmConsoleSection>

				{canManage && (
					<>
						<FirmConsoleSection title={t('Firm_Invites')} description={t('Firm_Invites_Description')}>
							<FirmInvitesSection />
						</FirmConsoleSection>

						<FirmConsoleSection title={t('Firm_QR_Title')} description={t('Firm_QR_Description')}>
							<FirmQrHandoffSection />
						</FirmConsoleSection>

						<FirmConsoleSection title={t('Firm_Domains')} description={t('Firm_Domains_Description')}>
							<FirmDomainsSection />
						</FirmConsoleSection>
					</>
				)}
			</>
		);
	};

	return (
		<Page data-qa-id='firm-console'>
			<PageHeader title={t('Firm_Console')} />
			<PageScrollableContentWithShadow>
				<Box maxWidth='x600' width='full' alignSelf='center' color='default'>
					{renderBody()}
				</Box>
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default FirmConsolePage;
