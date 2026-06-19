import { useTranslation, useLayout, useCurrentRoutePath } from '@rocket.chat/ui-contexts';
import { memo } from 'react';

import BoardsSidebarPages from './BoardsSidebarPages';
import Sidebar from '../../../components/Sidebar';

const BoardsSidebar = () => {
	const t = useTranslation();

	const { sidebar } = useLayout();

	const currentPath = useCurrentRoutePath();

	return (
		<Sidebar aria-label={t('Boards')}>
			<Sidebar.Header onClose={sidebar.close} title={t('Boards')} />
			<Sidebar.Content>
				<BoardsSidebarPages currentPath={currentPath || ''} />
			</Sidebar.Content>
		</Sidebar>
	);
};

export default memo(BoardsSidebar);
