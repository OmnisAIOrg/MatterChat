import { Box } from '@rocket.chat/fuselage';
import { ActionLink } from '@rocket.chat/layout';
import { useSetting } from '@rocket.chat/ui-contexts';
import { Trans } from 'react-i18next';

export const LoginPoweredBy = () => {
	const hidePoweredBy = useSetting('Layout_Login_Hide_Powered_By', false);
	// MatterChat white-label (Wave 2 login skin): the upstream "Powered by
	// Rocket.Chat" line is the loudest stock-RC tell on everyone's first screen.
	// MIT core requires no attribution display (see the fork strategy) — hidden
	// unconditionally rather than via the admin setting so a stock workspace
	// never regresses. Presentation only; nothing else in this component changed.
	const matterchatHidePoweredBy = true;
	if (hidePoweredBy || matterchatHidePoweredBy) {
		return null;
	}
	return (
		<Box mbe={18}>
			<Trans i18nKey='registration.page.poweredBy'>
				{'Powered by '}
				<ActionLink href='https://rocket.chat/' target='_blank' rel='noopener noreferrer'>
					Rocket.Chat
				</ActionLink>
			</Trans>
		</Box>
	);
};

export default LoginPoweredBy;
