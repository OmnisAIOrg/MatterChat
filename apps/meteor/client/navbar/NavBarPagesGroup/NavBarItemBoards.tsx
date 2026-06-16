import { NavBarItem } from '@rocket.chat/fuselage';
import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import { useRouter, usePermission, useCurrentRoutePath } from '@rocket.chat/ui-contexts';
import type { HTMLAttributes } from 'react';

type NavBarItemBoardsProps = Omit<HTMLAttributes<HTMLElement>, 'is'>;

const NavBarItemBoards = (props: NavBarItemBoardsProps) => {
	const router = useRouter();
	const canViewBoards = usePermission('boards-view');
	const handleBoards = useStableCallback(() => {
		router.navigate('/boards');
	});
	const currentRoute = useCurrentRoutePath();

	const boardsRoute = currentRoute?.includes('/boards');

	if (!canViewBoards) {
		return null;
	}

	return (
		<NavBarItem
			{...props}
			icon='squares'
			onClick={handleBoards}
			aria-current={boardsRoute ? 'page' : undefined}
			pressed={boardsRoute}
		/>
	);
};

export default NavBarItemBoards;
