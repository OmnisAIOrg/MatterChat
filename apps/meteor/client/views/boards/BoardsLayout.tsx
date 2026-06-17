import { useLayout } from '@rocket.chat/ui-contexts';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

import BoardsSidebar from './sidebar/BoardsSidebar';
import SidebarPortal from '../../portals/SidebarPortal';

type BoardsLayoutProps = {
	children?: ReactNode;
};

const BoardsLayout = ({ children }: BoardsLayoutProps) => {
	const { sidebar } = useLayout();

	// Overlap fix (Part B): Boards portals its own sidebar into `#sidebar-region`
	// (via SidebarPortal V1). Signal the layout that the region is overlayed so the
	// chat rooms list is pulled out of the flex column (see SidebarRegion's
	// `.is-overlayed` rule) instead of stacking beneath the boards sidebar. This
	// mirrors SidebarPortalV2's setOverlayed contract, but works in the default
	// (secondarySidebar OFF) path too. Restored on unmount / when leaving /boards.
	useEffect(() => {
		sidebar.setOverlayed(true);
		return () => sidebar.setOverlayed(false);
	}, [sidebar]);

	return (
		<>
			<SidebarPortal>
				<BoardsSidebar />
			</SidebarPortal>
			{children}
		</>
	);
};

export default BoardsLayout;
