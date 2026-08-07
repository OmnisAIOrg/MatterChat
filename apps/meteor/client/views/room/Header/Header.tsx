import { isInviteSubscription } from '@rocket.chat/core-typings';
import type { IRoom, ISubscription } from '@rocket.chat/core-typings';
import { useLayout, useSetting } from '@rocket.chat/ui-contexts';
import { lazy, memo } from 'react';

const RoomInviteHeader = lazy(() => import('./RoomInviteHeader'));
const OmnichannelRoomHeader = lazy(() => import('./Omnichannel/OmnichannelRoomHeader'));
const RoomHeaderE2EESetup = lazy(() => import('./RoomHeaderE2EESetup'));
const RoomHeader = lazy(() => import('./RoomHeader'));
// MATTERCHAT: phone-only back arrow in the header start slot (opens the room-list drawer).
const MobileBackToChatsButton = lazy(() => import('./MobileBackToChatsButton'));

export type HeaderProps = {
	room: IRoom;
	subscription?: ISubscription;
};

const Header = ({ room, subscription }: HeaderProps) => {
	const { isEmbedded, showTopNavbarEmbeddedLayout, isMobile } = useLayout();
	const encrypted = Boolean(room.encrypted);
	const unencryptedMessagesAllowed = useSetting('E2E_Allow_Unencrypted_Messages', false);
	const shouldDisplayE2EESetup = encrypted && !unencryptedMessagesAllowed;

	if (isEmbedded && !showTopNavbarEmbeddedLayout) {
		return null;
	}

	if (subscription && isInviteSubscription(subscription)) {
		return <RoomInviteHeader room={room} />;
	}

	if (room.t === 'l') {
		return <OmnichannelRoomHeader />;
	}

	if (shouldDisplayE2EESetup) {
		return <RoomHeaderE2EESetup room={room} />;
	}

	// MATTERCHAT: on phones, mount a back arrow in the header's start slot (the same additive
	// slot mechanism OmnichannelRoomHeader uses) — standalone PWAs have no edge-swipe back.
	return <RoomHeader room={room} slots={isMobile ? { start: <MobileBackToChatsButton /> } : undefined} />;
};

export default memo(Header);
