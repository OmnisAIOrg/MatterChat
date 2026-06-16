import type { ReactNode } from 'react';

import BoardsSidebar from './sidebar/BoardsSidebar';
import SidebarPortal from '../../portals/SidebarPortal';

type BoardsLayoutProps = {
	children?: ReactNode;
};

const BoardsLayout = ({ children }: BoardsLayoutProps) => {
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
