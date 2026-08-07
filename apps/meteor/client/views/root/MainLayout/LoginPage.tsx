import { useSession } from '@rocket.chat/ui-contexts';
import type { LoginRoutes } from '@rocket.chat/web-ui-registration';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LoggedOutBanner from '../../../components/deviceManagement/LoggedOutBanner';
import MatterChatLoginPage from './MatterChatLoginPage';
import { useIframe } from '../hooks/useIframe';

export type LoginPageProps = { defaultRoute?: LoginRoutes; children?: ReactNode };

const LoginPage = ({ defaultRoute, children }: LoginPageProps) => {
	const { t } = useTranslation();
	const showForcedLogoutBanner = useSession('forceLogout') as boolean | undefined;
	const { iframeLoginUrl, tryLogin, enabled: iframeEnabled } = useIframe();

	useEffect(() => {
		if (!iframeEnabled) {
			return;
		}

		tryLogin();
	}, [tryLogin, iframeEnabled]);

	if (iframeLoginUrl) {
		return <iframe title={t('Login')} src={iframeLoginUrl} style={{ height: '100%', width: '100%' }} />;
	}

	return (
		<>
			{showForcedLogoutBanner && <LoggedOutBanner />}
			{/* MATTERCHAT: the redesigned sign-in (brand chamber + cream card). It renders the
			    stock RegistrationRoute itself for every non-login flow (reset/register/secret). */}
			<MatterChatLoginPage defaultRoute={defaultRoute}>{children}</MatterChatLoginPage>
		</>
	);
};

export default LoginPage;
