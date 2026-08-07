import type { Card } from '@rocket.chat/fuselage';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { GenericCard, GenericCardButton } from '../../../components/GenericCard';
import { useExternalLink } from '../../../hooks/useExternalLink';
import { links } from '../../../lib/links';

// MatterChat's OWN desktop app — always the newest release (never a pinned version; the
// releases repo marks exactly one release Latest and the CI publishes non-draft by rule).
//
// These are DIRECT downloads, not links to the releases page. Previously all three buttons
// opened the same GitHub page, where a non-technical user has to pick the right file out of
// twelve assets — including blockmaps and .yml files that mean nothing to them.
//
// The version-less filenames are deliberate. Our real artifacts carry the version
// (MatterChat-Setup-1.0.0.exe), so a direct URL would break on every release, and GitHub's
// /releases/latest/download/<name> supports no wildcard. The desktop CI therefore publishes
// a stable-named copy of each installer alongside the versioned originals
// (.github/workflows/build.yml → "Publish stable-named download aliases"), so these URLs
// keep resolving to the newest release forever.
const DESKTOP_LATEST = 'https://github.com/OmnisAIOrg/MatterChat-Desktop-releases/releases/latest';
const WINDOWS_APP_URL = `${DESKTOP_LATEST}/download/MatterChat-windows.exe`;
const LINUX_APP_URL = `${DESKTOP_LATEST}/download/MatterChat-linux.AppImage`;
const MAC_APP_URL = `${DESKTOP_LATEST}/download/MatterChat-mac.dmg`;

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
