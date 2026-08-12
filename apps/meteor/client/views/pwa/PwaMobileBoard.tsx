import { useSurfaceMode } from '@rocket.chat/ui-client';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

import { MOBILE_PWA_PALETTE_DARK, MOBILE_PWA_PALETTE_LIGHT } from './mobilePwaStyles';

/**
 * PwaMobileBoard — Matters Board screen for mobile PWA.
 * Shows stage filter chips + matter cards with SOL bars + team avatars.
 */
const PwaMobileBoard = ({ onNavigate }: { onNavigate: (screen: string) => void }): ReactElement => {
	const theme = useSurfaceMode();
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

	const intake = [
		{ name: 'Candace Ann Moore', id: '#2', sol: '24 MO', solPct: '80%', team: ['KM', 'ST'] },
		{ name: 'Karina Martinez', id: '#16', sol: '24 MO', solPct: '76%', team: ['ST'] },
		{ name: 'Jordan Farrell', id: '#22', sol: '22 MO', solPct: '70%', team: ['LR', 'MS'] },
		{ name: 'Test Test 3', id: '#26', sol: '18 MO', solPct: '58%', team: ['YA'] },
		{ name: 'Yaritza Test', id: '#27', sol: '24 MO', solPct: '78%', team: ['KM', 'PN'] },
		{ name: 'English Test', id: '#55', sol: '23 MO', solPct: '74%', team: ['EB'] },
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
				<span style={{ fontSize: '15px', fontWeight: '650', color: '#F2F5F3' }}>Matters</span>
				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: '5px',
						fontSize: '10.5px',
						color: '#AEB8B1',
						padding: '3px 8px',
						borderRadius: '99px',
						border: `1px solid ${p.railLine}`,
					}}
				>
					<span
						style={{
							width: '6px',
							height: '6px',
							borderRadius: '99px',
							background: '#3FBC7C',
						}}
					></span>
					CasePro
				</span>
				<span style={{ flex: 1 }}></span>
				<button
					style={{
						height: '28px',
						padding: '0 11px',
						borderRadius: '8px',
						border: 0,
						background: p.green,
						color: p.onGreen,
						fontFamily: 'inherit',
						fontSize: '11.5px',
						fontWeight: '600',
						cursor: 'pointer',
					}}
				>
					+ New
				</button>
			</div>

			{/* STAGE FILTER CHIPS */}
			<div
				style={{
					flex: 'none',
					display: 'flex',
					gap: '7px',
					padding: '10px 16px',
					backgroundColor: p.railBg,
					borderBottom: `1px solid ${p.railLine}`,
					overflow: 'auto',
				}}
			>
				<span
					style={{
						flex: 'none',
						fontFamily: "'Geist Mono', monospace",
						fontSize: '10px',
						letterSpacing: '.08em',
						fontWeight: '600',
						padding: '5px 12px',
						borderRadius: '99px',
						backgroundColor: 'rgba(63,188,124,.16)',
						color: '#7CD8A8',
					}}
				>
					INTAKE · 17
				</span>
				<span
					style={{
						flex: 'none',
						fontFamily: "'Geist Mono', monospace",
						fontSize: '10px',
						letterSpacing: '.08em',
						padding: '5px 12px',
						borderRadius: '99px',
						border: `1px solid ${p.railLine}`,
						color: '#AEB8B1',
					}}
				>
					REVIEW · 2
				</span>
				<span
					style={{
						flex: 'none',
						fontFamily: "'Geist Mono', monospace",
						fontSize: '10px',
						letterSpacing: '.08em',
						padding: '5px 12px',
						borderRadius: '99px',
						border: `1px solid ${p.railLine}`,
						color: '#AEB8B1',
					}}
				>
					INVESTIGATION · 45
				</span>
			</div>

			{/* CARD LIST */}
			<div
				style={{
					flex: 1,
					overflow: 'auto',
					padding: '14px 16px 20px',
					display: 'flex',
					flexDirection: 'column',
					gap: '9px',
				}}
			>
				{intake.map((card, i) => (
					<div
						key={i}
						style={{
							backgroundColor: p.surface,
							border: `1px solid ${p.border}`,
							borderRadius: '13px',
							boxShadow: shadowVars.shadow1,
							padding: '12px 13px',
						}}
					>
						<div
							style={{
								display: 'flex',
								alignItems: 'flex-start',
								gap: '9px',
							}}
						>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div style={{ fontSize: '13px', fontWeight: '600', color: p.ink }}>{card.name}</div>
								<div style={{ marginTop: '1px', fontSize: '11px', color: p.ink3 }}>Motor Vehicle Accident</div>
							</div>
							<span
								style={{
									fontFamily: "'Geist Mono', monospace",
									fontSize: '9.5px',
									color: p.ink3,
									whiteSpace: 'nowrap',
								}}
							>
								{card.id}
							</span>
						</div>
						<div
							style={{
								marginTop: '9px',
								display: 'flex',
								alignItems: 'center',
								gap: '8px',
							}}
						>
							{/* SOL bar */}
							<div
								style={{
									flex: 1,
									height: '4px',
									borderRadius: '99px',
									backgroundColor: p.surface2,
									border: `1px solid ${p.border}`,
									overflow: 'hidden',
								}}
							>
								<div
									style={{
										height: '100%',
										background: p.green,
										width: card.solPct,
									}}
								></div>
							</div>
							<span
								style={{
									fontFamily: "'Geist Mono', monospace",
									fontSize: '9px',
									color: p.ink3,
									whiteSpace: 'nowrap',
								}}
							>
								{card.sol}
							</span>
							{/* Avatar stack */}
							<div
								style={{
									display: 'inline-flex',
									paddingLeft: '5px',
									gap: '-5px',
								}}
							>
								{card.team.map((t, j) => (
									<span
										key={j}
										style={{
											width: '18px',
											height: '18px',
											borderRadius: '99px',
											background: 'linear-gradient(135deg,#2FA268,#186B44)',
											border: `2px solid ${p.surface}`,
											display: 'inline-grid',
											placeItems: 'center',
											color: '#fff',
											fontSize: '7px',
											fontWeight: '600',
											marginLeft: j === 0 ? 0 : '-5px',
										}}
									>
										{t}
									</span>
								))}
							</div>
						</div>
					</div>
				))}
				<button
					style={{
						height: '38px',
						borderRadius: '11px',
						border: `1.5px dashed ${p.border2}`,
						backgroundColor: 'transparent',
						color: p.ink3,
						fontFamily: 'inherit',
						fontSize: '12px',
						fontWeight: '500',
						cursor: 'pointer',
					}}
				>
					+ Add card
				</button>
			</div>

			{/* FLOATING ACTION BUTTON */}
			<div
				style={{
					flex: 'none',
					padding: '0 16px 18px',
					backgroundColor: p.bg,
				}}
			>
				<button
					style={{
						width: '100%',
						height: '44px',
						borderRadius: '13px',
						border: 0,
						background: p.green,
						color: p.onGreen,
						fontFamily: 'inherit',
						fontSize: '13.5px',
						fontWeight: '600',
						cursor: 'pointer',
						boxShadow: shadowVars.shadow2,
					}}
				>
					+ New matter
				</button>
			</div>
		</div>
	);
};

export default PwaMobileBoard;
