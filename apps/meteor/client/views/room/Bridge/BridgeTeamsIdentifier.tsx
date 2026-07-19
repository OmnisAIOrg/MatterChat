import type { IRoom } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

// MATTERCHAT: Teams bridge identifier — shows "VIA TEAMS" in the composer area when
// a message is being sent to a Teams-bridged conversation. Uses Teams purple identity.

type BridgeTeamsIdentifierProps = {
	room: IRoom;
};

/**
 * Determines if a room is bridged with Microsoft Teams.
 */
const isTeamsBridgedRoom = (room: IRoom): boolean => {
	if ((room as any).teamsId) return true;
	if ((room as any).externalWorkspaceId?.provider === 'teams') return true;
	if (room.importIds?.some((id) => id.startsWith('teams:'))) return true;
	return false;
};

const BridgeTeamsIdentifier = ({ room }: BridgeTeamsIdentifierProps): ReactElement | null => {
	const isBridged = useMemo(() => isTeamsBridgedRoom(room), [room]);

	if (!isBridged) {
		return null;
	}

	return (
		<Box
			display="inline-flex"
			alignItems="center"
			justifyContent="center"
			fontSize="9px"
			fontWeight={600}
			padding="3px 8px"
			borderRadius="6px"
			fontFamily="'Geist Mono', monospace"
			letterSpacing="0.08em"
			backgroundColor="#EDEFFB"
			color="#4B53BC"
			borderColor="#D4D8F4"
			borderWidth="1px"
			borderStyle="solid"
			style={{
				flex: 'none',
				textTransform: 'uppercase',
			}}
		>
			Via Teams
		</Box>
	);
};

export default BridgeTeamsIdentifier;
