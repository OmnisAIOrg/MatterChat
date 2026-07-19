import type { IRoom } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

// MATTERCHAT: Teams bridge badge — shows in the conversation header when a room
// is bridged with Microsoft Teams. Displays a purple pill with "T" icon + "Microsoft Teams" label.

type BridgeTeamsBadgeProps = {
	room: IRoom;
};

/**
 * Determines if a room is bridged with Microsoft Teams.
 * Currently checks for:
 * - Room has a teamsId field
 * - Room has external workspace metadata
 * - Room has import id prefixed with "teams:"
 *
 * TODO: Update detection logic based on actual Teams bridge field in IRoom
 */
const isTeamsBridgedRoom = (room: IRoom): boolean => {
	// Check if room has Teams bridge indicators
	if ((room as any).teamsId) return true;
	if ((room as any).externalWorkspaceId?.provider === 'teams') return true;
	if (room.importIds?.some((id) => id.startsWith('teams:'))) return true;
	return false;
};

const BridgeTeamsBadge = ({ room }: BridgeTeamsBadgeProps): ReactElement | null => {
	const isBridged = useMemo(() => isTeamsBridgedRoom(room), [room]);

	if (!isBridged) {
		return null;
	}

	return (
		<Box
			display="inline-flex"
			alignItems="center"
			gap={6}
			fontSize="12px"
			fontWeight={600}
			padding="5px 12px"
			borderRadius="99px"
			backgroundColor="#4B53BC"
			color="#fff"
			style={{
				flex: 'none',
			}}
		>
			<Box
				width="14px"
				height="14px"
				borderRadius="4px"
				backgroundColor="#fff"
				color="#4B53BC"
				fontSize="8.5px"
				fontWeight={700}
				style={{
					display: 'inline-grid',
					placeItems: 'center',
				}}
			>
				T
			</Box>
			<span>Microsoft Teams</span>
		</Box>
	);
};

export default BridgeTeamsBadge;
