import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import { HeaderToolbarAction } from '@rocket.chat/ui-client';
import { useLayout } from '@rocket.chat/ui-contexts';
import { useTranslation } from 'react-i18next';

/**
 * MATTERCHAT mobile: the room header's back affordance on phones.
 *
 * iOS standalone PWAs have no browser chrome and no edge-swipe back, and the stock room header
 * renders nothing in its start slot for normal rooms — so inside a room the only ways back to the
 * room list were the NavBar hamburger and the bottom Chats tab, neither of which reads as "back".
 * This mirrors the Omnichannel BackButton slot pattern (Header/Omnichannel/OmnichannelRoomHeader):
 * a single arrow at the header start that opens the room-list drawer, exactly like Slack mobile's
 * in-channel back arrow. Mounted from Header.tsx only when `isMobile`.
 */
const MobileBackToChatsButton = () => {
	const { t } = useTranslation();
	const { sidebar } = useLayout();

	const back = useStableCallback(() => {
		sidebar.expand();
	});

	return <HeaderToolbarAction icon='arrow-back' title={t('Back')} onClick={back} />;
};

export default MobileBackToChatsButton;
