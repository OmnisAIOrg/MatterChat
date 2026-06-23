import { NavBarItem } from '@rocket.chat/fuselage';
import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import { useRouter, useCurrentRoutePath } from '@rocket.chat/ui-contexts';
import type { HTMLAttributes } from 'react';

type NavBarItemFilesProps = Omit<HTMLAttributes<HTMLElement>, 'is'>;

/**
 * Top-nav entry point to the embedded LitBox "Files" screen (`/litbox`).
 * Mirrors NavBarItemBoards. Shown to any signed-in user; the LitBox proxy
 * enforces the actual file permissions server-side.
 */
const NavBarItemFiles = (props: NavBarItemFilesProps) => {
	const router = useRouter();
	const handleFiles = useStableCallback(() => {
		router.navigate('/litbox');
	});
	const currentRoute = useCurrentRoutePath();
	const filesRoute = currentRoute?.includes('/litbox');

	return <NavBarItem {...props} icon='folder' onClick={handleFiles} aria-current={filesRoute ? 'page' : undefined} pressed={filesRoute} />;
};

export default NavBarItemFiles;
