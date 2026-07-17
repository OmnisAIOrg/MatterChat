import { NavBarGroup } from '@rocket.chat/fuselage';
import { useLayout } from '@rocket.chat/ui-contexts';
import { useTranslation } from 'react-i18next';

import NavBarItemCreateNew from './NavBarItemCreateNew';
import NavBarItemDirectoryPage from './NavBarItemDirectoryPage';
import NavBarItemSort from './NavBarItemSort';
import NavBarPagesStackMenu from './NavBarPagesStackMenu';

// The AppLeftRail owns primary navigation (Chats/Boards/Files/Activity/Search) —
// the NavBar keeps only what the rail doesn't carry: Directory, sort, create-new
// and the search box. Home/Boards/notification-bell duplicates and the
// Rocket.Chat Marketplace menu were removed with the rail's arrival.
const NavBarPagesGroup = () => {
	const { t } = useTranslation();
	const { isTablet, isMobile } = useLayout();

	return (
		<NavBarGroup aria-label={t('Pages_and_actions')}>
			{isTablet && <NavBarPagesStackMenu />}
			{!isTablet && <NavBarItemDirectoryPage title={t('Directory')} />}
			{!isMobile && <NavBarItemSort />}
			<NavBarItemCreateNew />
		</NavBarGroup>
	);
};

export default NavBarPagesGroup;
