import { Throbber } from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContent } from '@rocket.chat/ui-client';
import { useUserId } from '@rocket.chat/ui-contexts';
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';

// Lazy so the heavy LitBox package only loads when the user opens Files.
const LitboxEmbed = lazy(() => import('./LitboxEmbed'));

/**
 * The "Files" screen — the user's LitBox account embedded inside MatterChat.
 * Mounts the LitBox file browser (lazy) against MatterChat's /api/litbox proxy.
 */
const LitboxFilesView = () => {
	const { t } = useTranslation();
	const userId = useUserId();

	// The browser-side token is the caller's own MatterChat session; the /api/litbox
	// proxy validates it and injects the real LitBox credential server-side.
	const authToken = userId ? (window.localStorage.getItem('Meteor.loginToken') ?? '') : '';

	return (
		<Page data-qa='litbox-files'>
			<PageHeader title={t('Files', { defaultValue: 'Files' })} />
			<PageScrollableContent>
				<Suspense fallback={<Throbber />}>
					<LitboxEmbed authToken={authToken} />
				</Suspense>
			</PageScrollableContent>
		</Page>
	);
};

export default LitboxFilesView;
