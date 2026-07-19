import type { IRoom } from '@rocket.chat/core-typings';
import { Button } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

// MATTERCHAT: Bridge into MatterChat button — shown in Teams-bridged conversations
// to allow users to bridge the conversation into MatterChat for team collaboration.

type BridgeIntoMatterChatButtonProps = {
	room: IRoom;
	onBridge?: () => void;
};

const isTeamsBridgedRoom = (room: IRoom): boolean => {
	if ((room as any).teamsId) return true;
	if ((room as any).externalWorkspaceId?.provider === 'teams') return true;
	if (room.importIds?.some((id) => id.startsWith('teams:'))) return true;
	return false;
};

const BridgeIntoMatterChatButton = ({ room, onBridge }: BridgeIntoMatterChatButtonProps): ReactElement | null => {
	const isBridged = useMemo(() => isTeamsBridgedRoom(room), [room]);

	if (!isBridged) {
		return null;
	}

	return (
		<Button
			display="flex"
			alignItems="center"
			gap={7}
			height="31px"
			padding="0 13px"
			borderRadius="99px"
			borderColor="var(--greenLine)"
			backgroundColor="var(--greenSoft)"
			color="var(--greenInk)"
			fontFamily="inherit"
			fontSize="12.5px"
			fontWeight={600}
			onClick={onBridge}
			style={{
				cursor: 'pointer',
				transition: 'all 0.15s',
				border: '1px solid var(--greenLine)',
			}}
			onMouseEnter={(e) => {
				(e.currentTarget.style as any).backgroundColor = 'var(--green)';
				(e.currentTarget.style as any).color = 'var(--onGreen)';
				(e.currentTarget.style as any).borderColor = 'var(--green)';
			}}
			onMouseLeave={(e) => {
				(e.currentTarget.style as any).backgroundColor = 'var(--greenSoft)';
				(e.currentTarget.style as any).color = 'var(--greenInk)';
				(e.currentTarget.style as any).borderColor = 'var(--greenLine)';
			}}
		>
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
			>
				<path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.5-5.5l-1.7 1.7M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.5 5.5l1.7-1.7"></path>
			</svg>
			<span>Bridge into MatterChat</span>
		</Button>
	);
};

export default BridgeIntoMatterChatButton;
