import { SidebarV2 } from '@rocket.chat/fuselage';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SidebarRoomList from './RoomList';
import SidebarFooter from '../../../sidebar/footer';
import BannerSection from '../../../sidebar/sections/BannerSection';
import SlackWorkspaceBanner from '../../../sidebar/sections/SlackWorkspaceBanner';

const Sidebar = () => {
	const { t } = useTranslation();

	return (
		<SidebarV2 aria-label={t('Sidebar')} className='rcx-sidebar--main rcx-sidebar'>
			<BannerSection />
			<SlackWorkspaceBanner />
			<SidebarRoomList />
			<SidebarFooter />
		</SidebarV2>
	);
};

export default memo(Sidebar);
