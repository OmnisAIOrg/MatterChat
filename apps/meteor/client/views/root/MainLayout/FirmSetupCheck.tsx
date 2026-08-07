import { useSetting, useUserId } from '@rocket.chat/ui-contexts';
import type { ReactNode } from 'react';
import { Suspense, lazy } from 'react';

import LayoutWithSidebar from './LayoutWithSidebar';
import { useUserInfoQuery } from '../../../hooks/useUserInfoQuery';

const FirmOnboardingPage = lazy(() => import('../../firms/FirmOnboardingPage'));

/**
 * MATTERCHAT: the firm-setup gate.
 *
 * Shows the firm wizard to a brand-new account that has no firm yet, and keeps
 * showing it until they have one. A MatterChat user without a firm has no
 * colleagues, no matter channels and no directory cohort — the product does not
 * work in that state, so it is not offered as a choice.
 *
 * ## What changed, and why the old gate was wrong
 *
 * Previously: `!user.customFields.firmId && subscriptions.length === 0`, with
 * "Continue on my own" remembered in React `useState`.
 *
 *  - **`subscriptions.length === 0` is not a test for "new".** Any workspace
 *    that auto-joins new users to a default channel gives them a subscription
 *    immediately, so the wizard silently never appeared — which is why the flow
 *    behaved differently between deployments for no visible reason.
 *  - **`useState` does not survive a reload**, so the skip was not a real
 *    choice; the wizard returned on every refresh until a subscription appeared.
 *  - **Skipping dropped the user into the shared workspace**, alongside other
 *    firms' default channels. For a legal product that is the wrong default.
 *
 * Now the gate reads ONE durable server-side flag,
 * `customFields.needsFirmSetup`, stamped at account creation (see
 * `server/lib/firms/firmsOnboarding.ts`) and cleared the moment the user
 * creates a firm, redeems a firm invite, or is linked to an Omnis org by
 * CentralAuth. Existing users on established workspaces never carry the flag,
 * so they are never trapped behind a wizard that is not for them.
 */
const FirmSetupCheck = ({ children }: { children: ReactNode }) => {
	const selfServeEnabled = useSetting('Firms_SelfServe_Enabled', false);
	const userId = useUserId();
	const { data: userData, isLoading } = useUserInfoQuery({ userId: userId || '' }, { enabled: !!userId && selfServeEnabled === true });

	const user = userData?.user as { customFields?: Record<string, unknown>; roles?: string[] } | undefined;

	// Mirrors `needsFirmSetup()` on the server. Admins are exempt — someone has
	// to be able to reach the admin area to configure the workspace, and locking
	// the owner behind firm setup would be a footgun during initial setup.
	const shouldOnboard =
		selfServeEnabled === true &&
		!!userId &&
		!isLoading &&
		!!user &&
		user.customFields?.needsFirmSetup === true &&
		!user.customFields?.firmId &&
		!user.roles?.includes('admin');

	if (shouldOnboard) {
		return (
			<Suspense fallback={null}>
				<FirmOnboardingPage />
			</Suspense>
		);
	}

	return <LayoutWithSidebar>{children}</LayoutWithSidebar>;
};

export default FirmSetupCheck;
