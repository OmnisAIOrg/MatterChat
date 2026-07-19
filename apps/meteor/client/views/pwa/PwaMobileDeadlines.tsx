import { useThemeMode } from '@rocket.chat/ui-client';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

import { MOBILE_PWA_PALETTE_DARK, MOBILE_PWA_PALETTE_LIGHT } from './mobilePwaStyles';

/**
 * PwaMobileDeadlines — Deadlines screen for mobile PWA.
 * Shows Overdue and Later sections with deadline cards.
 */
const PwaMobileDeadlines = ({ onNavigate }: { onNavigate: (screen: string) => void }): ReactElement => {
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

	const overdue = [
		{ date: '2/3/2024', days: '896D PAST' },
		{ date: '1/29/2025', days: '535D PAST' },
	];

	const later = [
		{ date: '10/29/2026', days: '103D LEFT' },
		{ date: '5/29/2027', days: '315D LEFT' },
		{ date: '7/1/2027', days: '348D LEFT' },
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
				<span style={{ fontSize: '15px', fontWeight: '650', color: '#F2F5F3' }}>Deadlines</span>
				<span style={{ flex: 1 }}></span>
				{/* SOL at risk badge */}
				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: '5px',
						fontSize: '10.5px',
						fontWeight: '600',
						padding: '3px 9px',
						borderRadius: '99px',
						backgroundColor: 'rgba(224,104,93,.15)',
						border: '1px solid rgba(224,104,93,.35)',
						color: '#E0685D',
					}}
				>
					<span
						style={{
							width: '6px',
							height: '6px',
							borderRadius: '99px',
							background: '#E0685D',
						}}
					></span>
					SOL at risk: 2
				</span>
			</div>

			{/* SCROLLABLE CONTENT */}
			<div
				style={{
					flex: 1,
					overflow: 'auto',
					padding: '16px 16px 20px',
				}}
			>
				{/* OVERDUE SECTION */}
				<div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<span style={{ fontSize: '13.5px', fontWeight: '650', color: p.ink }}>Overdue</span>
						<span
							style={{
								minWidth: '18px',
								height: '18px',
								padding: '0 5px',
								borderRadius: '99px',
								backgroundColor: p.redSoft,
								border: `1px solid ${p.redLine}`,
								color: p.red,
								fontSize: '10.5px',
								fontWeight: '600',
								display: 'grid',
								placeItems: 'center',
							}}
						>
							{overdue.length}
						</span>
					</div>
					<div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
						{overdue.map((d, i) => (
							<div
								key={i}
								style={{
									position: 'relative',
									backgroundColor: p.surface,
									border: `1px solid ${p.border}`,
									borderRadius: '13px',
									boxShadow: shadowVars.shadow1,
									padding: '13px 14px 13px 18px',
								}}
							>
								{/* Left bar (red) */}
								<span
									style={{
										position: 'absolute',
										left: 0,
										top: '11px',
										bottom: '11px',
										width: '3px',
										borderRadius: '0 3px 3px 0',
										background: p.red,
									}}
								></span>
								{/* Tags */}
								<div style={{ display: 'flex', gap: '6px' }}>
									<span
										style={{
											fontSize: '9.5px',
											fontWeight: '600',
											padding: '2px 8px',
											borderRadius: '99px',
											backgroundColor: p.redSoft,
											border: `1px solid ${p.redLine}`,
											color: p.red,
										}}
									>
										Statute of limitations
									</span>
									<span
										style={{
											fontSize: '9.5px',
											fontWeight: '600',
											padding: '2px 8px',
											borderRadius: '99px',
											backgroundColor: p.surface2,
											border: `1px solid ${p.border2}`,
											color: p.ink2,
										}}
									>
										High risk
									</span>
								</div>
								{/* Title */}
								<div style={{ marginTop: '7px', fontSize: '13px', fontWeight: '650', color: p.ink }}>
									Statute of limitations
								</div>
								{/* Date + countdown */}
								<div style={{ marginTop: '3px', fontSize: '11.5px', color: p.ink2 }}>
									Due: {d.date}{' '}
									<span
										style={{
											fontFamily: "'Geist Mono', monospace",
											fontSize: '9px',
											fontWeight: '600',
											color: p.red,
										}}
									>
										{d.days}
									</span>
								</div>
								{/* Action buttons */}
								<div style={{ marginTop: '10px', display: 'flex', gap: '7px' }}>
									<button
										style={{
											flex: 1,
											height: '30px',
											borderRadius: '9px',
											border: `1px solid ${p.border2}`,
											backgroundColor: p.surface,
											color: p.ink,
											fontFamily: 'inherit',
											fontSize: '11.5px',
											fontWeight: '600',
											cursor: 'pointer',
										}}
									>
										Open
									</button>
									<button
										style={{
											flex: 1,
											height: '30px',
											borderRadius: '9px',
											border: 0,
											background: p.green,
											color: p.onGreen,
											fontFamily: 'inherit',
											fontSize: '11.5px',
											fontWeight: '600',
											cursor: 'pointer',
										}}
									>
										Acknowledge
									</button>
								</div>
							</div>
						))}
					</div>
				</div>

				{/* LATER SECTION */}
				<div style={{ marginTop: '20px' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<span style={{ fontSize: '13.5px', fontWeight: '650', color: p.ink }}>Later</span>
						<span
							style={{
								fontFamily: "'Geist Mono', monospace",
								fontSize: '10px',
								color: p.ink3,
							}}
						>
							{later.length}
						</span>
					</div>
					<div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
						{later.map((d, i) => (
							<div
								key={i}
								style={{
									position: 'relative',
									backgroundColor: p.surface,
									border: `1px solid ${p.border}`,
									borderRadius: '13px',
									boxShadow: shadowVars.shadow1,
									padding: '13px 14px 13px 18px',
									display: 'flex',
									alignItems: 'center',
									gap: '10px',
								}}
							>
								{/* Left bar (green line) */}
								<span
									style={{
										position: 'absolute',
										left: 0,
										top: '11px',
										bottom: '11px',
										width: '3px',
										borderRadius: '0 3px 3px 0',
										background: p.greenLine,
									}}
								></span>
								{/* Content */}
								<div style={{ flex: 1, minWidth: 0 }}>
									<div style={{ fontSize: '13px', fontWeight: '600', color: p.ink }}>Statute of limitations</div>
									<div style={{ marginTop: '2px', fontSize: '11.5px', color: p.ink2 }}>Due: {d.date}</div>
								</div>
								{/* Days left badge */}
								<span
									style={{
										fontFamily: "'Geist Mono', monospace",
										fontSize: '9px',
										fontWeight: '600',
										padding: '2.5px 7px',
										borderRadius: '6px',
										backgroundColor: p.greenSoft,
										border: `1px solid ${p.greenLine}`,
										color: p.greenInk,
										whiteSpace: 'nowrap',
									}}
								>
									{d.days}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
};

export default PwaMobileDeadlines;
