import { useRoomToolbox } from '@rocket.chat/ui-contexts';

import CatchMeUpPanel from './CatchMeUpPanel';
import type { CatchUpMessage } from './useCatchUp';
import { useCatchUp } from './useCatchUp';
import { setMessageJumpQueryStringParameter } from '../../../../lib/utils/setMessageJumpQueryStringParameter';
import { useRoom } from '../../contexts/RoomContext';

/** MATTERCHAT: "Catch me up" (F4) for THIS room, from the channel header. */
const CatchMeUpWithData = () => {
	const room = useRoom();
	const { closeTab } = useRoomToolbox();
	const label = `${room.t === 'd' ? '@' : '#'}${room.fname || room.name || ''}`;
	const { messages, unread, omitted, loading, error, reload, label: serverLabel } = useCatchUp(room._id, label);

	// In-app jump rather than following the permalink: the user is already in this room, and a
	// full navigation would reload the SPA to land two screens from where they started.
	const onJump = (message: CatchUpMessage) => setMessageJumpQueryStringParameter(message.id);

	return (
		<CatchMeUpPanel
			label={serverLabel || label}
			messages={messages}
			unread={unread}
			omitted={omitted}
			loading={loading}
			error={error}
			onRetry={reload}
			onJump={onJump}
			onClose={closeTab}
		/>
	);
};

export default CatchMeUpWithData;
