import type { IBoardCard, Serialized } from '@rocket.chat/core-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

import { roomCoordinator } from '../../../../lib/rooms/roomCoordinator';

export type LinkedRoomInfo = { _id?: string; t?: string; name?: string; caseProCommsLog?: { enabled?: boolean } } & Record<string, unknown>;

/**
 * The card's linked matter channel, shared by MatterHeader ("Jump to channel")
 * and ChannelSection (link/unlink + comms-log status). Reads rooms.info for the
 * linked roomId; both consumers share the same react-query cache entry.
 *
 * The matter channel is created as a private group ('p') whose route resolves
 * by NAME, so `canJump` only turns true once rooms.info has loaded.
 */
export const useMatterChannel = (
	link: Serialized<IBoardCard>['link'],
): { roomId: string | undefined; room: LinkedRoomInfo | undefined; canJump: boolean; jumpToChannel: () => void } => {
	const roomId = link?.kind === 'matter' ? link.roomId : undefined;

	const getRoomInfo = useEndpoint('GET', '/v1/rooms.info');
	const { data } = useQuery({
		queryKey: ['boards', 'matter-channel-info', roomId],
		queryFn: () => getRoomInfo({ roomId: roomId as string }),
		enabled: Boolean(roomId),
	});
	const room = data?.room as LinkedRoomInfo | undefined;

	const canJump = Boolean(roomId && room?.name);
	const jumpToChannel = (): void => {
		if (!roomId || !room?.name) {
			return;
		}
		const roomType: 'c' | 'p' = room.t === 'c' ? 'c' : 'p';
		roomCoordinator.openRouteLink(roomType, { rid: roomId, name: room.name });
	};

	return { roomId, room, canJump, jumpToChannel };
};
