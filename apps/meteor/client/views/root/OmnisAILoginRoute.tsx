import { useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { Meteor } from 'meteor/meteor';
import { useEffect } from 'react';

// Lands here after /_omnisai/callback bounces the browser to /omnisai/:token.
// Redeems the one-time credentialToken into a real Meteor session, then goes home.
const OmnisAILoginRoute = () => {
	const router = useRouter();
	const dispatchToastMessage = useToastMessageDispatch();

	useEffect(() => {
		const { token } = router.getRouteParameters();

		Meteor.loginWithOmnisaiToken(token, (error?: unknown) => {
			if (error) {
				dispatchToastMessage({ type: 'error', message: error });
			}

			router.navigate({ pathname: '/home' }, { replace: true });
		});
	}, [dispatchToastMessage, router]);

	return null;
};

export default OmnisAILoginRoute;
