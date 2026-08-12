import { useSurfaceMode } from '@rocket.chat/ui-client';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

import { MOBILE_PWA_PALETTE_DARK, MOBILE_PWA_PALETTE_LIGHT } from './mobilePwaStyles';

/**
 * PwaMobileHome — Home screen for mobile PWA (390px viewport).
 * Shows greeting, stats (Active Matters, SOL ≤ 30D), Due Today, Approaching Deadlines, My Matters.
 * Bottom tab bar for navigation.
 */
const PwaMobileHome = ({ onNavigate }: { onNavigate: (screen: string) => void }): ReactElement => {
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
					padding: '12px 16px 10px',
					display: 'flex',
					alignItems: 'center',
					gap: '10px',
				}}
			>
				{/* App icon/avatar */}
				<div
					style={{
						width: '30px',
						height: '30px',
						borderRadius: '9px',
						background: 'linear-gradient(135deg,#22A957,#0F7A3C)',
						display: 'grid',
						placeItems: 'center',
						color: '#fff',
						fontWeight: '700',
						fontSize: '13px',
					}}
				>
					M
				</div>
				{/* Search bar */}
				<div
					style={{
						flex: 1,
						height: '32px',
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
						padding: '0 12px',
						borderRadius: '9px',
						backgroundColor: p.railHover,
						border: `1px solid ${p.railLine}`,
						color: p.railInk2,
						fontSize: '12px',
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
						<circle cx="11" cy="11" r="6.5"></circle>
						<path d="M20 20l-4.2-4.2"></path>
					</svg>
					<span>Search</span>
				</div>
				{/* User avatar with presence */}
				<div style={{ position: 'relative' }}>
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
			</div>

			{/* SCROLLABLE CONTENT */}
			<div
				style={{
					flex: 1,
					overflow: 'auto',
					padding: '18px 16px 20px',
				}}
			>
				{/* Greeting */}
				<div style={{ fontSize: '19px', fontWeight: '650', letterSpacing: '-.02em', color: p.ink }}>
					Good evening, Chi-Hung
				</div>
				<div style={{ marginTop: '3px', fontSize: '12px', color: p.ink2 }}>
					Saturday, July 18 · <span style={{ color: p.red, fontWeight: '500' }}>2 matters</span> near deadline
				</div>

				{/* STATS GRID */}
				<div
					style={{
						marginTop: '14px',
						display: 'grid',
						gridTemplateColumns: '1fr 1fr',
						gap: '9px',
					}}
				>
					{/* Active Matters */}
					<div
						style={{
							backgroundColor: p.surface,
							border: `1px solid ${p.border}`,
							borderRadius: '13px',
							boxShadow: shadowVars.shadow1,
							padding: '13px 14px',
						}}
					>
						<div
							style={{
								fontFamily: "'Geist Mono', monospace",
								fontSize: '9px',
								letterSpacing: '.12em',
								color: p.ink3,
							}}
						>
							ACTIVE MATTERS
						</div>
						<div style={{ marginTop: '4px', fontSize: '22px', fontWeight: '650', color: p.ink }}>
							99
						</div>
					</div>
					{/* SOL ≤ 30D */}
					<div
						style={{
							backgroundColor: p.surface,
							border: `1px solid ${p.border}`,
							borderRadius: '13px',
							boxShadow: shadowVars.shadow1,
							padding: '13px 14px',
							position: 'relative',
							overflow: 'hidden',
						}}
					>
						<span
							style={{
								position: 'absolute',
								left: 0,
								top: '10px',
								bottom: '10px',
								width: '3px',
								borderRadius: '0 3px 3px 0',
								background: p.red,
							}}
						></span>
						<div
							style={{
								fontFamily: "'Geist Mono', monospace",
								fontSize: '9px',
								letterSpacing: '.12em',
								color: p.red,
							}}
						>
							SOL ≤ 30D
						</div>
						<div style={{ marginTop: '4px', fontSize: '22px', fontWeight: '650', color: p.red }}>
							2
						</div>
					</div>
				</div>

				{/* DUE TODAY CARD */}
				<div
					style={{
						marginTop: '12px',
						backgroundColor: p.surface,
						border: `1px solid ${p.border}`,
						borderRadius: '13px',
						boxShadow: shadowVars.shadow1,
						padding: '13px 14px',
						display: 'flex',
						alignItems: 'center',
						gap: '11px',
					}}
				>
					<div
						style={{
							width: '32px',
							height: '32px',
							borderRadius: '9px',
							backgroundColor: p.greenSoft,
							border: `1px solid ${p.greenLine}`,
							display: 'grid',
							placeItems: 'center',
							color: p.greenInk,
						}}
					>
						<svg
							width="15"
							height="15"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<circle cx="12" cy="12" r="8.5"></circle>
							<path d="m8.5 12.4 2.4 2.4 4.8-5.2"></path>
						</svg>
					</div>
					<div>
						<div style={{ fontSize: '13px', fontWeight: '600', color: p.ink }}>Due today</div>
						<div style={{ fontSize: '11.5px', color: p.ink2 }}>Nothing due — you're clear.</div>
					</div>
				</div>

				{/* APPROACHING DEADLINES */}
				<div
					style={{
						marginTop: '12px',
						backgroundColor: p.surface,
						border: `1px solid ${p.border}`,
						borderRadius: '13px',
						boxShadow: shadowVars.shadow1,
						overflow: 'hidden',
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '8px',
							padding: '12px 14px',
						}}
					>
						<span style={{ fontSize: '13px', fontWeight: '600', color: p.ink }}>Approaching deadlines</span>
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
							2
						</span>
					</div>
					{[
						{ title: 'SOL — Test Test', date: 'Due 02/03/2022', badge: '896D' },
						{ title: 'SOL — Judit Ferrer', date: 'Due 12/30/2024', badge: '535D' },
					].map((d, i) => (
						<div
							key={i}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '9px',
								padding: '10px 14px',
								borderTop: `1px solid ${p.border}`,
							}}
						>
							<span
								style={{
									width: '6px',
									height: '6px',
									borderRadius: '99px',
									background: p.red,
									boxShadow: `0 0 0 3px ${p.redSoft}`,
									flex: 'none',
								}}
							></span>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div style={{ fontSize: '12.5px', fontWeight: '600', color: p.ink }}>{d.title}</div>
								<div style={{ fontSize: '11px', color: p.ink3 }}>{d.date}</div>
							</div>
							<span
								style={{
									fontFamily: "'Geist Mono', monospace",
									fontSize: '9px',
									fontWeight: '600',
									padding: '2.5px 7px',
									borderRadius: '6px',
									backgroundColor: p.redSoft,
									border: `1px solid ${p.redLine}`,
									color: p.red,
								}}
							>
								{d.badge}
							</span>
						</div>
					))}
				</div>

				{/* MY MATTERS */}
				<div
					style={{
						marginTop: '12px',
						backgroundColor: p.surface,
						border: `1px solid ${p.border}`,
						borderRadius: '13px',
						boxShadow: shadowVars.shadow1,
						overflow: 'hidden',
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '8px',
							padding: '12px 14px',
						}}
					>
						<span style={{ fontSize: '13px', fontWeight: '600', color: p.ink }}>My matters</span>
						<span
							style={{
								fontFamily: "'Geist Mono', monospace",
								fontSize: '10px',
								color: p.ink3,
							}}
						>
							99
						</span>
						<span style={{ flex: 1 }}></span>
						<a href="#" style={{ fontSize: '11.5px', fontWeight: '500', textDecoration: 'none', color: p.green }}>
							View all →
						</a>
					</div>
					{[
						{ name: 'Chauncey Frank', type: 'Motor Vehicle Accident', stage: 'Investigation', bg: p.blueSoft, fg: p.greenInk, line: p.blueLine },
						{ name: 'Candace Ann Moore', type: 'Motor Vehicle Accident', stage: 'Initial Review', bg: p.amberSoft, fg: p.amber, line: p.amberLine },
						{ name: 'Knowledge Mims', type: 'Motor Vehicle Accident', stage: 'Investigation', bg: p.blueSoft, fg: p.greenInk, line: p.blueLine },
						{ name: 'Mark Embrey', type: 'Motor Vehicle Accident', stage: 'Pre-Litigation', bg: p.blueSoft, fg: p.blue, line: p.blueLine },
					].map((m, i) => (
						<div
							key={i}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '10px',
								padding: '10px 14px',
								borderTop: `1px solid ${p.border}`,
							}}
						>
							<span
								style={{
									width: '6px',
									height: '6px',
									borderRadius: '99px',
									background: p.green,
									flex: 'none',
								}}
							></span>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div style={{ fontSize: '12.5px', fontWeight: '600', color: p.ink }}>{m.name}</div>
								<div style={{ fontSize: '11px', color: p.ink3 }}>{m.type}</div>
							</div>
							<span
								style={{
									fontSize: '10px',
									fontWeight: '600',
									padding: '2.5px 9px',
									borderRadius: '99px',
									backgroundColor: m.bg,
									color: m.fg,
									border: `1px solid ${m.line}`,
									whiteSpace: 'nowrap',
								}}
							>
								{m.stage}
							</span>
						</div>
					))}
				</div>
			</div>

			{/* BOTTOM TAB BAR */}
			<div
				style={{
					flex: 'none',
					display: 'flex',
					backgroundColor: p.surface,
					borderTop: `1px solid ${p.border}`,
					padding: '8px 6px 18px',
				}}
			>
				{[
					{ icon: 'home', label: 'Home', active: true, badge: null },
					{ icon: 'chat', label: 'Chats', active: false, badge: null },
					{ icon: 'board', label: 'Boards', active: false, badge: null },
					{ icon: 'activity', label: 'Activity', active: false, badge: '6' },
					{ icon: 'admin', label: 'Admin', active: false, badge: null },
				].map((tab) => (
					<div
						key={tab.label}
						onClick={() => onNavigate(tab.label.toLowerCase())}
						style={{
							flex: 1,
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: '3px',
							color: tab.active ? p.green : p.ink3,
							cursor: 'pointer',
							position: 'relative',
						}}
					>
						{tab.icon === 'home' && (
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5h-5v5H4z"></path>
							</svg>
						)}
						{tab.icon === 'chat' && (
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.7"
								strokeLinejoin="round"
							>
								<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9.5L4 20.5z"></path>
							</svg>
						)}
						{tab.icon === 'board' && (
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
								<rect x="4" y="4" width="6.6" height="6.6" rx="1.8"></rect>
								<rect x="13.4" y="4" width="6.6" height="6.6" rx="1.8"></rect>
								<rect x="4" y="13.4" width="6.6" height="6.6" rx="1.8"></rect>
								<rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.8"></rect>
							</svg>
						)}
						{tab.icon === 'activity' && (
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.7"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M6.3 9.2a5.7 5.7 0 0 1 11.4 0c0 4.4 1.9 5.6 1.9 5.6H4.4s1.9-1.2 1.9-5.6M10 18.8a2.1 2.1 0 0 0 4 0"></path>
							</svg>
						)}
						{tab.icon === 'admin' && (
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.7"
								strokeLinecap="round"
							>
								<circle cx="12" cy="12" r="3.2"></circle>
								<path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"></path>
							</svg>
						)}
						<span style={{ fontSize: '9.5px', fontWeight: tab.active ? '600' : '500' }}>{tab.label}</span>
						{tab.badge && (
							<span
								style={{
									position: 'absolute',
									top: '-3px',
									right: '24%',
									minWidth: '15px',
									height: '15px',
									borderRadius: '99px',
									background: '#D5375B',
									color: '#fff',
									fontSize: '9px',
									fontWeight: '600',
									display: 'grid',
									placeItems: 'center',
									padding: '0 4px',
								}}
							>
								{tab.badge}
							</span>
						)}
					</div>
				))}
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

export default PwaMobileHome;
