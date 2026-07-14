import { useRoomToolbox } from '@rocket.chat/ui-contexts';

import { useRoom } from '../../contexts/RoomContext';
import CrossFirmPanel from './CrossFirmPanel';

// The cross-firm conversation, scoped to THIS room (channel) — keyed by room._id, no CasePro required.
const CrossFirmWithData = () => {
	const room = useRoom();
	const { closeTab } = useRoomToolbox();
	return <CrossFirmPanel rid={room._id} onClose={closeTab} />;
};

export default CrossFirmWithData;
