import { Box } from '@rocket.chat/fuselage';
import { memo, useSyncExternalStore } from 'react';

import SidebarItemsAssembler from '../../../components/Sidebar/SidebarItemsAssembler';
import { subscribeToBoardsSidebarItems, getBoardsSidebarItems } from '../sidebarItems';

type BoardsSidebarPagesProps = {
	currentPath: string;
};

const BoardsSidebarPages = ({ currentPath }: BoardsSidebarPagesProps) => {
	const items = useSyncExternalStore(subscribeToBoardsSidebarItems, getBoardsSidebarItems);

	return (
		<Box display='flex' flexDirection='column' flexShrink={0} pb={8}>
			<SidebarItemsAssembler items={items} currentPath={currentPath} />
		</Box>
	);
};

export default memo(BoardsSidebarPages);
