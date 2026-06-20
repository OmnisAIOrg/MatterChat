import { NavBarItem } from '@rocket.chat/fuselage';
import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import { useRouter, useSetting, useCurrentRoutePath } from '@rocket.chat/ui-contexts';
import type { HTMLAttributes } from 'react';

type NavBarItemCrossFirmProps = Omit<HTMLAttributes<HTMLElement>, 'is'>;

// Cross-firm (Omnis Counsel) entry — gated on the public CrossFirm_Enabled setting (no permission needed).
const NavBarItemCrossFirm = (props: NavBarItemCrossFirmProps) => {
	const router = useRouter();
	const enabled = useSetting('CrossFirm_Enabled', false);
	const handleClick = useStableCallback(() => {
		router.navigate('/cross-firm');
	});
	const currentRoute = useCurrentRoutePath();
	const isActive = currentRoute?.includes('/cross-firm');

	if (!enabled) {
		return null;
	}

	return (
		<NavBarItem
			{...props}
			icon='balance'
			onClick={handleClick}
			aria-current={isActive ? 'page' : undefined}
			pressed={isActive}
		/>
	);
};

export default NavBarItemCrossFirm;
