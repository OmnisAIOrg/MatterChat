import { Box, Button, Throbber, States, StatesIcon, StatesTitle, StatesSubtitle } from '@rocket.chat/fuselage';
import { useRouter } from '@rocket.chat/ui-contexts';
import { Meteor } from 'meteor/meteor';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Lands here after /_omnisai/callback bounces the browser to /omnisai/:token.
// Redeems the one-time credentialToken into a real Meteor session, then goes home.
// ISSUE 3: Renders a loading state while pending, and friendly error handling on failure.
const OmnisAILoginRoute = () => {
	const router = useRouter();
	const { t } = useTranslation();
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const { token } = router.getRouteParameters();

		Meteor.loginWithOmnisaiToken(token, (err?: unknown) => {
			if (err) {
				// Store the error to render a friendly card instead of toast + redirect
				setError('login-failed');
				return;
			}

			// Success: navigate to home
			router.navigate({ pathname: '/home' }, { replace: true });
		});
	}, [router]);

	const handleRetry = () => {
		setError(null);
		// Send user back through the authorize flow
		window.location.href = '/_omnisai/authorize';
	};

	const handleUseAnother = () => {
		// Send user back to the login page to try another method
		router.navigate({ pathname: '/login' }, { replace: true });
	};

	// Loading state: centered spinner with friendly message
	if (!error) {
		return (
			<Box display='flex' alignItems='center' justifyContent='center' height='100vh' width='100%' flexDirection='column' gap='x16'>
				<Throbber size='x48' />
				<Box fontSize='x16' fontWeight='500' color='neutral-800'>
					{t('registration.page.omnisai.signin')}
				</Box>
			</Box>
		);
	}

	// Error state: friendly card with recovery options
	return (
		<Box
			display='flex'
			alignItems='center'
			justifyContent='center'
			height='100vh'
			width='100%'
			flexDirection='column'
			gap='x16'
			padding='x24'
		>
			<States>
				<StatesIcon name='warning' />
				<StatesTitle>{t('registration.page.omnisai.signin_error')}</StatesTitle>
				<StatesSubtitle>{t('registration.page.omnisai.signin_error_desc')}</StatesSubtitle>
				<Box display='flex' gap='x8' marginBlockStart='x24' flexDirection='row' justifyContent='center'>
					<Button onClick={handleRetry} primary>
						{t('registration.page.omnisai.signin_error_retry')}
					</Button>
					<Button onClick={handleUseAnother}>{t('registration.page.omnisai.signin_error_another')}</Button>
				</Box>
			</States>
		</Box>
	);
};

export default OmnisAILoginRoute;
