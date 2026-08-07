import { Box } from '@rocket.chat/fuselage';
import { useLayout } from '@rocket.chat/ui-contexts';
import type { ReactNode } from 'react';
import { lazy } from 'react';

import FirmSetupCheck from './FirmSetupCheck';
import MainContent from './MainContent';
import { useRequire2faSetup } from '../../hooks/useRequire2faSetup';

const AccountSecurityPage = lazy(() => import('../../account/security/AccountSecurityPage'));

export type TwoFactorAuthSetupCheckProps = { children: ReactNode };

const TwoFactorAuthSetupCheck = ({ children }: TwoFactorAuthSetupCheckProps) => {
	const { isEmbedded: embeddedLayout } = useLayout();
	const require2faSetup = useRequire2faSetup();

	if (require2faSetup) {
		return (
			<Box backgroundColor='surface-light' id='rocket-chat' className={embeddedLayout ? 'embedded-view' : undefined}>
				<MainContent>
					<AccountSecurityPage />
				</MainContent>
			</Box>
		);
	}

	// MATTERCHAT: firm onboarding gate wraps the normal layout (self-serve firms)
	return <FirmSetupCheck>{children}</FirmSetupCheck>;
};

export default TwoFactorAuthSetupCheck;
