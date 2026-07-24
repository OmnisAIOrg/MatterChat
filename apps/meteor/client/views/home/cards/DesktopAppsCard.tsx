import type { Card } from '@rocket.chat/fuselage';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { GenericCard, GenericCardButton } from '../../../components/GenericCard';
import { useExternalLink } from '../../../hooks/useExternalLink';
import { links } from '../../../lib/links';

// MatterChat's OWN desktop app — always the newest release (never a pinned version; the
// releases repo marks exactly one release Latest and the CI publishes non-draft by rule).
const DESKTOP_LATEST = 'https://github.com/OmnisAIOrg/MatterChat-Desktop-releases/releases/latest';
const WINDOWS_APP_URL = DESKTOP_LATEST;
const LINUX_APP_URL = DESKTOP_LATEST;
const MAC_APP_URL = DESKTOP_LATEST;

const DesktopAppsCard = (props: Omit<ComponentProps<typeof Card>, 'type'>) => {
	const { t } = useTranslation();
	const handleOpenLink = useExternalLink();

	return (
		<GenericCard
			title={t('Desktop_apps')}
			body={t('Install_rocket_chat_on_your_preferred_desktop_platform')}
			buttons={[
				<GenericCardButton key={1} onClick={() => handleOpenLink(WINDOWS_APP_URL)} role='link'>
					{t('Platform_Windows')}
				</GenericCardButton>,
				<GenericCardButton key={2} onClick={() => handleOpenLink(LINUX_APP_URL)} role='link'>
					{t('Platform_Linux')}
				</GenericCardButton>,
				<GenericCardButton key={3} onClick={() => handleOpenLink(MAC_APP_URL)} role='link'>
					{t('Platform_Mac')}
				</GenericCardButton>,
			]}
			width='x340'
			{...props}
		/>
	);
};

export default DesktopAppsCard;
