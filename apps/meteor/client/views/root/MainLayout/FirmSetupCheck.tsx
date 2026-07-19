import { useSetting, useUserId, useUserSubscriptions } from '@rocket.chat/ui-contexts';
import type { ReactNode } from 'react';
import { Suspense, lazy, useMemo, useState } from 'react';

import LayoutWithSidebar from './LayoutWithSidebar';
import { useUserInfoQuery } from '../../../hooks/useUserInfoQuery';

const FirmOnboardingPage = lazy(() => import('../../firms/FirmOnboardingPage'));

/**
 * MATTERCHAT: self-serve firms onboarding gate.
 *
 * When `Firms_SelfServe_Enabled` is on, a freshly registered user who has no
 * firm stamp AND no room subscriptions (i.e. neither invited into a firm team
 * nor part of the pre-existing workspace) is shown the firm onboarding screen
 * before the normal layout. Admins are exempt. Dismissal is remembered for the
 * session so "Continue on my own" is not a trap.
 */
const FirmSetupCheck = ({ children }: { children: ReactNode }) => {
	const selfServeEnabled = useSetting('Firms_SelfServe_Enabled', false);
	const userId = useUserId();
	const { data: userData, isLoading } = useUserInfoQuery({ userId: userId || '' }, { enabled: !!userId && selfServeEnabled === true });
	const subscriptions = useUserSubscriptions(useMemo(() => ({}), []));
	const [dismissed, setDismissed] = useState(false);

	const user = userData?.user as { customFields?: Record<string, unknown>; roles?: string[] } | undefined;

	const shouldOnboard =
		selfServeEnabled === true &&
		!!userId &&
		!isLoading &&
		!!user &&
		!user.customFields?.firmId &&
		!user.roles?.includes('admin') &&
		subscriptions.length === 0 &&
		!dismissed;

	if (shouldOnboard) {
		return (
			<Suspense fallback={null}>
				<FirmOnboardingPage onDone={() => setDismissed(true)} />
			</Suspense>
		);
	}

	return <LayoutWithSidebar>{children}</LayoutWithSidebar>;
};

export default FirmSetupCheck;
