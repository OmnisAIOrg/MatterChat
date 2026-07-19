import type { IRoom } from '@rocket.chat/core-typings';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

// MATTERCHAT: Teams bridge panel — shows Microsoft Teams workspace, channels, and chats
// when viewing a Teams-bridged conversation. Displays with purple (#4B53BC) identity band.

type BridgeTeamsPanelProps = {
	room: IRoom;
};

const isTeamsBridgedRoom = (room: IRoom): boolean => {
	if ((room as any).teamsId) return true;
	if ((room as any).externalWorkspaceId?.provider === 'teams') return true;
	if (room.importIds?.some((id) => id.startsWith('teams:'))) return true;
	return false;
};

const BridgeTeamsPanel = ({ room }: BridgeTeamsPanelProps): ReactElement | null => {
	const isBridged = useMemo(() => isTeamsBridgedRoom(room), [room]);

	if (!isBridged) {
		return null;
	}

	return (
		<div
			style={{
				width: '236px',
				flexShrink: 0,
				backgroundColor: 'var(--railBg2)',
				borderRight: '1px solid var(--railLine)',
				display: 'flex',
				flexDirection: 'column',
				minHeight: '0',
			}}
		>
			{/* Header band with purple Teams identity */}
			<div
				style={{
					flexShrink: 0,
					display: 'flex',
					alignItems: 'center',
					gap: '9px',
					padding: '13px 14px',
					background: 'linear-gradient(135deg, #4B53BC, #39408F)',
				}}
			>
				<button
					style={{
						width: '26px',
						height: '26px',
						borderRadius: '8px',
						border: '0',
						background: 'rgba(255, 255, 255, 0.14)',
						color: '#fff',
						display: 'grid',
						placeItems: 'center',
						cursor: 'pointer',
						transition: 'background 0.15s',
						padding: '0',
					}}
					onMouseEnter={(e) => {
						(e.currentTarget.style as any).background = 'rgba(255, 255, 255, 0.25)';
					}}
					onMouseLeave={(e) => {
						(e.currentTarget.style as any).background = 'rgba(255, 255, 255, 0.14)';
					}}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.9"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M14 6 8 12l6 6"></path>
					</svg>
				</button>
				<div
					style={{
						width: '22px',
						height: '22px',
						borderRadius: '6px',
						backgroundColor: '#fff',
						display: 'inline-grid',
						placeItems: 'center',
						color: '#4B53BC',
						fontSize: '11px',
						fontWeight: 700,
					}}
				>
					T
				</div>
				<div
					style={{
						fontSize: '13.5px',
						fontWeight: 650,
						color: '#fff',
					}}
				>
					Microsoft Teams
				</div>
			</div>

			{/* Channels and chats list */}
			<div
				style={{
					flex: '1',
					minHeight: '0',
					overflow: 'auto',
					padding: '12px 10px',
				}}
			>
				{/* General channel */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '9px',
						padding: '6px 8px',
						borderRadius: '9px',
						color: 'var(--railInk)',
						cursor: 'pointer',
						transition: 'background 0.12s',
					}}
					onMouseEnter={(e) => {
						(e.currentTarget.style as any).background = 'var(--railHover)';
					}}
					onMouseLeave={(e) => {
						(e.currentTarget.style as any).background = 'transparent';
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
						style={{
							opacity: '0.55',
						}}
					>
						<path d="M9.5 4 7.5 20M16.5 4l-2 16M4.5 9.2h16M3.5 14.8h16"></path>
					</svg>
					<span style={{ fontSize: '13px' }}>General</span>
				</div>

				{/* Channel section label */}
				<div
					style={{
						fontFamily: "'Geist Mono', monospace",
						fontSize: '9.5px',
						letterSpacing: '0.14em',
						color: 'var(--railInk2)',
						padding: '12px 8px 6px',
					}}
				>
					NLF - CM
				</div>

				{/* Team/Group channel */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '9px',
						padding: '6px 8px',
						borderRadius: '9px',
						color: 'var(--railInk)',
						cursor: 'pointer',
						transition: 'background 0.12s',
					}}
					onMouseEnter={(e) => {
						(e.currentTarget.style as any).background = 'var(--railHover)';
					}}
					onMouseLeave={(e) => {
						(e.currentTarget.style as any).background = 'transparent';
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
						style={{
							opacity: '0.55',
						}}
					>
						<path d="M9.5 4 7.5 20M16.5 4l-2 16M4.5 9.2h16M3.5 14.8h16"></path>
					</svg>
					<span style={{ fontSize: '13px' }}>NLF - CM</span>
				</div>

				{/* Direct chats section */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '7px',
						padding: '14px 8px 8px',
						color: 'var(--railInk2)',
					}}
				>
					<span
						style={{
							fontFamily: "'Geist Mono', monospace",
							fontSize: '10px',
							letterSpacing: '0.16em',
						}}
					>
						CHATS
					</span>
					<span
						style={{
							fontFamily: "'Geist Mono', monospace",
							fontSize: '10px',
							color: 'var(--railInk2)',
						}}
					>
						17
					</span>
					<div
						style={{
							flex: '1',
							height: '1px',
							backgroundColor: 'var(--railLine)',
						}}
					/>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="m7 10 5 5 5-5"></path>
					</svg>
				</div>

				{/* Direct chats list (placeholder) */}
				{/* In production, this would iterate over actual chats from Teams API */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '9px',
						padding: '5.5px 8px',
						borderRadius: '9px',
						color: 'var(--railInk)',
						cursor: 'pointer',
						transition: 'background 0.12s',
					}}
					onMouseEnter={(e) => {
						(e.currentTarget.style as any).background = 'var(--railHover)';
					}}
					onMouseLeave={(e) => {
						(e.currentTarget.style as any).background = 'transparent';
					}}
				>
					<div
						style={{
							width: '24px',
							height: '24px',
							borderRadius: '8px',
							backgroundColor: '#5A63C8',
							display: 'inline-grid',
							placeItems: 'center',
							color: '#fff',
							fontSize: '9.5px',
							fontWeight: 600,
							flexShrink: 0,
						}}
					>
						ST
					</div>
					<span
						style={{
							fontSize: '12.5px',
							fontWeight: '500',
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					>
						Sally Tran
					</span>
				</div>
			</div>

			{/* Footer */}
			<div
				style={{
					flexShrink: 0,
					padding: '10px 18px 12px',
					borderTop: '1px solid var(--railLine)',
				}}
			>
				<div style={{ fontSize: '14px', fontWeight: 700 }}>
					<span style={{ color: '#F2F5F3' }}>Matter</span>
					<span style={{ color: '#E4484D' }}>Chat</span>
				</div>
				<a
					href="#"
					style={{
						fontSize: '11px',
						color: 'var(--railInk2)',
						textDecoration: 'underline',
					}}
				>
					Powered by Omnis AI
				</a>
			</div>
		</div>
	);
};

export default BridgeTeamsPanel;
