import { Box, Button, ButtonGroup, Callout, Throbber } from '@rocket.chat/fuselage';
import { HeroLayout, HeroLayoutTitle } from '@rocket.chat/layout';
import { useEndpoint, useRouteParameter, useRouter } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { firmDomainsQueryKey } from './console/firmConsole';

/**
 * MATTERCHAT: the landing page for a domain-verification email link.
 *
 * `sendFirmDomainVerification` mails `<Site_Url>/firm-domain/verify/<token>`.
 * Until this route existed that link went to the 404 page — the claim could be
 * created and could never be completed, which made the whole domain feature
 * inert (there is a TODO to this effect in `server/lib/firms/firmDomains.ts`).
 *
 * ## Why a mutation fired from an effect, not a query
 *
 * Verification CONSUMES the token: the same token cannot be redeemed twice. A
 * `useQuery` would happily refetch on window focus or remount and turn a
 * successful verification into a spurious "invalid token" the second time the
 * user tabbed back. So it is a mutation, fired exactly once, guarded by a ref —
 * the same shape `InvitePage` uses for redeeming an invite token.
 *
 * Both outcomes are stated plainly and both are dead ends by design: there is
 * nothing useful to retry with a spent or forged token, so the only action
 * offered is going to the console, where the domain's real state is visible.
 */
const FirmDomainVerifyPage = (): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();
	const queryClient = useQueryClient();
	const token = useRouteParameter('token');
	const attemptedTokenRef = useRef<string | null>(null);

	const verifyDomain = useEndpoint('POST', '/v1/firms.domains.verify');

	const verifyMutation = useMutation({
		mutationFn: (value: string) => verifyDomain({ token: value }),
		onSuccess: async () => {
			// The console may already be mounted in another tab's cache; make sure
			// the domain shows as verified when the user gets there.
			await queryClient.invalidateQueries({ queryKey: firmDomainsQueryKey });
		},
	});

	const { mutate } = verifyMutation;

	useEffect(() => {
		if (!token || attemptedTokenRef.current === token) {
			return;
		}
		attemptedTokenRef.current = token;
		mutate(token);
	}, [mutate, token]);

	const goToConsole = (): void => router.navigate('/firm-console');

	if (!token) {
		return (
			<HeroLayout>
				<HeroLayoutTitle>{t('Firm_Domain_Verify_Title')}</HeroLayoutTitle>
				<Callout type='danger'>{t('Firm_Domain_Verify_Missing_Token')}</Callout>
			</HeroLayout>
		);
	}

	return (
		<HeroLayout>
			<HeroLayoutTitle>{t('Firm_Domain_Verify_Title')}</HeroLayoutTitle>

			{verifyMutation.isPending || verifyMutation.isIdle ? (
				<Box display='flex' alignItems='center' justifyContent='center' padding={16}>
					<Throbber />
					<Box marginInlineStart={8} fontScale='p2'>
						{t('Firm_Domain_Verify_Checking')}
					</Box>
				</Box>
			) : null}

			{verifyMutation.isSuccess && (
				<Callout type='success' title={t('Firm_Domain_Verify_Success', { domain: verifyMutation.data.domain.domain })}>
					{t('Firm_Domain_Confirmed')}
				</Callout>
			)}

			{verifyMutation.isError && (
				<Callout type='danger' title={t('Firm_Domain_Verify_Failed')}>
					<Box fontScale='c1'>{verifyMutation.error instanceof Error ? verifyMutation.error.message : String(verifyMutation.error)}</Box>
				</Callout>
			)}

			{(verifyMutation.isSuccess || verifyMutation.isError) && (
				<Box marginBlockStart={16}>
					<ButtonGroup>
						<Button primary onClick={goToConsole}>
							{t('Firm_Domain_Verify_Go_To_Console')}
						</Button>
					</ButtonGroup>
				</Box>
			)}
		</HeroLayout>
	);
};

export default FirmDomainVerifyPage;
