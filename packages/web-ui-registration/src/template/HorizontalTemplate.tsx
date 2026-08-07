import { Box } from '@rocket.chat/fuselage';
import {
	HorizontalWizardLayout,
	HorizontalWizardLayoutAside,
	HorizontalWizardLayoutContent,
	HorizontalWizardLayoutTitle,
	HorizontalWizardLayoutFooter,
} from '@rocket.chat/layout';
import { useSetting, useAssetWithDarkModePath } from '@rocket.chat/ui-contexts';
import type { ReactNode } from 'react';

import LoginLedgerStyleTag from '../components/LoginLedgerStyleTag';
import LoginPoweredBy from '../components/LoginPoweredBy';
import LoginSwitchLanguageFooter from '../components/LoginSwitchLanguageFooter';
import LoginTerms from '../components/LoginTerms';
import MatterChatWordmark from '../components/MatterChatWordmark';
import { RegisterTitle } from '../components/RegisterTitle';

export type HorizontalTemplateProps = { children: ReactNode };

const HorizontalTemplate = ({ children }: HorizontalTemplateProps) => {
	const hideLogo = useSetting('Layout_Login_Hide_Logo', false);
	const customLogo = useAssetWithDarkModePath('logo');
	const customBackground = useAssetWithDarkModePath('background');

	return (
		// MatterChat ledger skin scope (presentation only) — see LoginLedgerStyleTag.
		<div className='mc-login'>
			<LoginLedgerStyleTag />
			<HorizontalWizardLayout
				background={customBackground}
				// An admin-uploaded logo asset still wins; the MatterChat wordmark is the branded fallback.
				logo={
					hideLogo ? (
						<></>
					) : (
						(customLogo && <Box is='img' maxHeight='x40' marginInline='neg-x8' src={customLogo} alt='Logo' />) || <MatterChatWordmark />
					)
				}
			>
				<HorizontalWizardLayoutAside>
					<HorizontalWizardLayoutTitle>
						<RegisterTitle />
					</HorizontalWizardLayoutTitle>
					<LoginPoweredBy />
				</HorizontalWizardLayoutAside>
				<HorizontalWizardLayoutContent>
					{children}
					<HorizontalWizardLayoutFooter>
						<LoginTerms />
						<LoginSwitchLanguageFooter />
					</HorizontalWizardLayoutFooter>
				</HorizontalWizardLayoutContent>
			</HorizontalWizardLayout>
		</div>
	);
};

export default HorizontalTemplate;
