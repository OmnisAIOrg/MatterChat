import { useTranslation, useLayout, useCurrentRoutePath } from '@rocket.chat/ui-contexts';
import { memo } from 'react';

import BoardsSidebarPages from './BoardsSidebarPages';
import Sidebar from '../../../components/Sidebar';
import BoardsChromeStyleTags from '../BoardsChromeStyleTags';

const BoardsSidebar = () => {
	const t = useTranslation();

	const { sidebar } = useLayout();

	const currentPath = useCurrentRoutePath();

	// BoardsChromeStyleTags mounts here because BoardsLayout portals this
	// sidebar on EVERY /boards route — one mount point puts the Ledger boards
	// chrome CSS (mc-* classes) in reach of the board headers, page shells,
	// CasePro strip, and this nav. Style only; nothing behavioral.
	return (
		<>
			<BoardsChromeStyleTags />
			<Sidebar className='mc-boards-sidebar' aria-label={t('Boards')}>
				<Sidebar.Header onClose={sidebar.close} title={t('Boards')} />
				<Sidebar.Content>
					<BoardsSidebarPages currentPath={currentPath || ''} />
				</Sidebar.Content>
			</Sidebar>
		</>
	);
};

export default memo(BoardsSidebar);
