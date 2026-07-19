import { useThemeMode } from '@rocket.chat/ui-client';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

import { MOBILE_PWA_PALETTE_DARK, MOBILE_PWA_PALETTE_LIGHT } from './mobilePwaStyles';

/**
 * PwaMobileChat — Chat conversation screen for mobile PWA.
 * Shows day dividers, messages with avatars, timestamps, read receipts.
 * Composer with formatting + send button.
 */
const PwaMobileChat = ({ onNavigate }: { onNavigate: (screen: string) => void }): ReactElement => {
	const [, , theme] = useThemeMode();
	const isDark = theme === 'dark';
	const p = isDark ? MOBILE_PWA_PALETTE_DARK : MOBILE_PWA_PALETTE_LIGHT;

	const shadowVars = useMemo(
		() =>
			isDark
				? {
						shadow1: '0 1px 2px rgba(0,0,0,.35)',
						shadow2: '0 1px 2px rgba(0,0,0,.4),0 10px 28px -8px rgba(0,0,0,.5)',
					}
				: {
						shadow1: '0 1px 2px rgba(23,29,25,.05),0 1px 3px rgba(23,29,25,.04)',
						shadow2: '0 1px 2px rgba(23,29,25,.05),0 8px 24px -8px rgba(23,29,25,.14)',
					},
		[isDark],
	);

	const chatDays = [
		{ day: 'JULY 16TH, 2026', msgs: [{ time: '12:16 PM', lines: ['Hi', 'wyd'] }] },
		{ day: 'JULY 17TH, 2026', msgs: [{ time: '8:08 PM', lines: ['Hey', 'Hey'] }, { time: '9:01 PM', lines: ['Hey', 'Wyd'] }] },
		{ day: 'TODAY', msgs: [{ time: '8:03 PM', lines: ['hi'] }] },
	];

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				backgroundColor: p.bg,
				color: p.ink,
				fontFamily: "'Geist', system-ui, sans-serif",
				WebkitFontSmoothing: 'antialiased',
			}}
		>
			{/* TOP BAR */}
			<div
				style={{
					flex: 'none',
					backgroundColor: p.railBg,
					padding: '14px 16px 12px',
					display: 'flex',
					alignItems: 'center',
					gap: '10px',
				}}
			>
				{/* Back arrow */}
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="#AEB8B1"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					onClick={() => onNavigate('home')}
					style={{ cursor: 'pointer' }}
				>
					<path d="M14.5 6 9 12l5.5 6"></path>
				</svg>
				{/* Avatar + status */}
				<div style={{ position: 'relative', flex: 'none' }}>
					<div
						style={{
							width: '30px',
							height: '30px',
							borderRadius: '9px',
							background: 'linear-gradient(135deg,#2FA268,#186B44)',
							display: 'grid',
							placeItems: 'center',
							color: '#fff',
							fontSize: '10.5px',
							fontWeight: '600',
						}}
					>
						CN
					</div>
					<span
						style={{
							position: 'absolute',
							right: '-2px',
							bottom: '-2px',
							width: '8px',
							height: '8px',
							borderRadius: '99px',
							background: '#3FBC7C',
							border: `2px solid ${p.railBg}`,
							animation: 'mcPulse 2.6s ease-out infinite',
						}}
					></span>
				</div>
				{/* Username + status */}
				<div>
					<div style={{ fontSize: '14px', fontWeight: '650', color: '#F2F5F3' }}>cnguyen</div>
					<div style={{ fontSize: '10.5px', color: '#6E7A73' }}>Online · Admin</div>
				</div>
				<span style={{ flex: 1 }}></span>
				{/* Search + menu icons */}
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="#6E7A73"
					strokeWidth="1.7"
					strokeLinecap="round"
				>
					<circle cx="11" cy="11" r="6.5"></circle>
					<path d="M20 20l-4.2-4.2"></path>
				</svg>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="#6E7A73"
					strokeWidth="2"
					strokeLinecap="round"
				>
					<circle cx="12" cy="5.5" r="1"></circle>
					<circle cx="12" cy="12" r="1"></circle>
					<circle cx="12" cy="18.5" r="1"></circle>
				</svg>
			</div>

			{/* MESSAGE LIST */}
			<div
				style={{
					flex: 1,
					overflow: 'auto',
					padding: '16px 14px 8px',
				}}
			>
				{chatDays.map((day, di) => (
					<div key={di}>
						{/* Day divider */}
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '10px',
								padding: '10px 0 8px',
							}}
						>
							<span style={{ flex: 1, height: '1px', background: p.border }}></span>
							<span
								style={{
									fontFamily: "'Geist Mono', monospace",
									fontSize: '9px',
									letterSpacing: '.1em',
									color: p.ink3,
									padding: '2.5px 9px',
									borderRadius: '99px',
									border: `1px solid ${p.border}`,
									backgroundColor: p.surface,
								}}
							>
								{day.day}
							</span>
							<span style={{ flex: 1, height: '1px', background: p.border }}></span>
						</div>
						{/* Messages in this day */}
						{day.msgs.map((msg, mi) => (
							<div key={mi} style={{ display: 'flex', gap: '9px', padding: '7px 4px' }}>
								{/* Avatar */}
								<div
									style={{
										width: '28px',
										height: '28px',
										borderRadius: '8px',
										background: 'linear-gradient(135deg,#2FA268,#186B44)',
										display: 'grid',
										placeItems: 'center',
										color: '#fff',
										fontSize: '9.5px',
										fontWeight: '600',
										flex: 'none',
									}}
								>
									CN
								</div>
								{/* Message content */}
								<div style={{ flex: 1, minWidth: 0 }}>
									{/* Header: username + time */}
									<div
										style={{
											display: 'flex',
											alignItems: 'baseline',
											gap: '7px',
										}}
									>
										<span style={{ fontSize: '12.5px', fontWeight: '650', color: p.ink }}>cnguyen</span>
										<span style={{ fontSize: '10px', color: p.ink3 }}>{msg.time}</span>
									</div>
									{/* Message lines */}
									{msg.lines.map((line, li) => (
										<div
											key={li}
											style={{
												marginTop: '1px',
												fontSize: '13px',
												color: p.ink,
												lineHeight: '1.45',
											}}
										>
											{line}
										</div>
									))}
								</div>
								{/* Read receipt (double check) */}
								<svg
									style={{ flex: 'none', marginTop: '3px' }}
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke={p.green}
									strokeWidth="1.9"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="m3 13 4 4 7.5-8.5M12.5 17 21 7.5"></path>
								</svg>
							</div>
						))}
					</div>
				))}
			</div>

			{/* COMPOSER */}
			<div
				style={{
					flex: 'none',
					padding: '10px 14px 18px',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '9px',
						backgroundColor: p.surface,
						border: `1px solid ${p.border2}`,
						borderRadius: '13px',
						boxShadow: shadowVars.shadow1,
						padding: '9px 12px',
					}}
				>
					{/* Emoji button */}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={p.ink3} strokeWidth="1.7" strokeLinecap="round">
						<circle cx="12" cy="12" r="8.5"></circle>
						<path d="M9 10h.01M15 10h.01M8.5 14.2c.9 1.1 2.1 1.7 3.5 1.7s2.6-.6 3.5-1.7"></path>
					</svg>
					{/* Text input */}
					<span style={{ flex: 1, fontSize: '13px', color: p.ink3 }}>Message @cnguyen</span>
					{/* Attachment button */}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={p.ink3} strokeWidth="1.7" strokeLinecap="round">
						<path d="M20 12.5 12.6 20a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.4-7.4"></path>
					</svg>
					{/* Send button */}
					<span
						style={{
							width: '30px',
							height: '30px',
							borderRadius: '9px',
							background: p.green,
							display: 'grid',
							placeItems: 'center',
							color: p.onGreen,
							cursor: 'pointer',
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
							<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"></path>
						</svg>
					</span>
				</div>
			</div>

			{/* ANIMATIONS */}
			<style>
				{`
					@keyframes mcPulse {
						0% {
							box-shadow: 0 0 0 0 rgba(63, 188, 124, 0.55);
						}
						70% {
							box-shadow: 0 0 0 5px rgba(63, 188, 124, 0);
						}
						100% {
							box-shadow: 0 0 0 0 rgba(63, 188, 124, 0);
						}
					}
				`}
			</style>
		</div>
	);
};

export default PwaMobileChat;
