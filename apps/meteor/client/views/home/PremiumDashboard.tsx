/**
 * PremiumDashboard — Wave 3 refresh design
 *
 * Recreates the dashboard design from docs/design/premium-refresh/Dashboard.dc.html
 * Modern card-based layout with Geist typography and contemporary shadows.
 * Replaces MyDayHomePage.tsx with a pixel-faithful implementation of the premium design.
 */

import { Box, Button } from '@rocket.chat/fuselage';
import { Page, PageScrollableContent } from '@rocket.chat/ui-client';
import { useUser } from '@rocket.chat/ui-contexts';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

const timeGreeting = (): string => {
	const h = new Date().getHours();
	if (h < 12) {
		return 'Good morning';
	}
	if (h < 18) {
		return 'Good afternoon';
	}
	return 'Good evening';
};

const formatDate = (): string => {
	const d = new Date();
	const dayName = d.toLocaleDateString(undefined, { weekday: 'long' });
	const month = d.toLocaleDateString(undefined, { month: 'numeric' });
	const day = d.getDate();
	return `${dayName}, ${month}/${day}`;
};

// Stat tile component
const StatTile = ({ label, value, accent }: { label: string; value: number; accent?: boolean }) => (
	<Box
		paddingInline={12}
		paddingBlockStart={8}
		paddingBlockEnd={8}
		style={{
			cursor: 'pointer',
			transition: 'background 120ms',
			borderLeft: accent ? '3px solid var(--premium-dashboard-red)' : undefined,
		}}
		onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--premium-dashboard-border)')}
		onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
	>
		<Box
			style={{
				fontFamily: "'Geist Mono', monospace",
				fontSize: '10px',
				letterSpacing: '0.14em',
				color: accent ? 'var(--premium-dashboard-red)' : 'var(--premium-dashboard-ink3)',
				textTransform: 'uppercase',
				fontWeight: 600,
			}}
		>
			{label}
		</Box>
		<Box
			style={{
				marginTop: '6px',
				fontSize: '26px',
				fontWeight: 650,
				letterSpacing: '-0.02em',
				color: accent ? 'var(--premium-dashboard-red)' : 'var(--premium-dashboard-ink)',
				fontVariantNumeric: 'tabular-nums',
			}}
		>
			{value}
		</Box>
	</Box>
);

// Action card component
const ActionCard = ({
	icon,
	title,
	subtitle,
	action,
	link,
}: {
	icon: ReactNode;
	title: string;
	subtitle: ReactNode;
	action?: ReactNode;
	link?: boolean;
}) => (
	<Box
		padding={12}
		display='flex'
		alignItems='center'
		style={{
			background: 'var(--premium-dashboard-surface)',
			border: '1px solid var(--premium-dashboard-border)',
			borderRadius: '14px',
			gap: '14px',
			cursor: 'pointer',
			transition: 'all 150ms',
			boxShadow: '0 1px 2px rgba(23,29,25,.05), 0 1px 3px rgba(23,29,25,.04)',
		}}
		onMouseEnter={(e) => {
			e.currentTarget.style.boxShadow = '0 1px 2px rgba(23,29,25,.05), 0 8px 24px -8px rgba(23,29,25,.14)';
			e.currentTarget.style.transform = 'translateY(-1px)';
		}}
		onMouseLeave={(e) => {
			e.currentTarget.style.boxShadow = '0 1px 2px rgba(23,29,25,.05), 0 1px 3px rgba(23,29,25,.04)';
			e.currentTarget.style.transform = 'translateY(0)';
		}}
	>
		<Box
			style={{
				flexShrink: 0,
				width: '36px',
				height: '36px',
				borderRadius: '10px',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: 'var(--premium-dashboard-green-soft)',
				border: '1px solid var(--premium-dashboard-border)',
			}}
		>
			{icon}
		</Box>
		<Box style={{ flex: 1, minWidth: 0 }}>
			<Box style={{ fontSize: '14px', fontWeight: 600, color: 'var(--premium-dashboard-ink)' }}>{title}</Box>
			{link ? (
				<Box
					is='a'
					href='#'
					style={{
						marginTop: '2px',
						fontSize: '12.5px',
						fontWeight: 500,
						textDecoration: 'none',
						color: 'var(--premium-dashboard-green)',
						display: 'inline-flex',
						alignItems: 'center',
						gap: '4px',
					}}
				>
					{subtitle} <span style={{ fontSize: '13px' }}>{'→'}</span>
				</Box>
			) : (
				<Box style={{ marginTop: '2px', fontSize: '12.5px', color: 'var(--premium-dashboard-ink2)' }}>{subtitle}</Box>
			)}
		</Box>
		{action && <Box>{action}</Box>}
	</Box>
);

// Card section wrapper
const CardSection = ({
	icon,
	title,
	count,
	action,
	children,
}: {
	icon: ReactNode;
	title: string;
	count?: number;
	action?: ReactNode;
	children: ReactNode;
}) => (
	<Box
		style={{
			marginTop: '16px',
			background: 'var(--premium-dashboard-surface)',
			border: '1px solid var(--premium-dashboard-border)',
			borderRadius: '14px',
			boxShadow: '0 1px 2px rgba(23,29,25,.05), 0 1px 3px rgba(23,29,25,.04)',
			overflow: 'hidden',
		}}
	>
		<Box display='flex' alignItems='center' style={{ padding: '14px 20px', gap: '10px' }}>
			{icon}
			<Box style={{ fontSize: '14px', fontWeight: 600, color: 'var(--premium-dashboard-ink)' }}>{title}</Box>
			{typeof count === 'number' && count > 0 && (
				<Box
					style={{
						minWidth: '19px',
						height: '19px',
						padding: '0 6px',
						borderRadius: '999px',
						background: 'var(--premium-dashboard-red-soft)',
						border: '1px solid var(--premium-dashboard-red-line)',
						color: 'var(--premium-dashboard-red)',
						fontSize: '11px',
						fontWeight: 600,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					{count}
				</Box>
			)}
			{action && <Box style={{ marginLeft: 'auto' }}>{action}</Box>}
		</Box>
		<Box style={{ display: 'flex', flexDirection: 'column' }}>{children}</Box>
	</Box>
);

// Deadline row
const DeadlineRow = ({ title, subtitle, date, badge }: { title: string; subtitle: string; date: string; badge: string }) => (
	<Box
		display='flex'
		alignItems='center'
		paddingInline={12}
		paddingBlockStart={8}
		paddingBlockEnd={8}
		style={{
			padding: '11px 20px',
			borderTop: '1px solid var(--premium-dashboard-border)',
			cursor: 'pointer',
			transition: 'background 120ms',
		}}
		onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--premium-dashboard-border)')}
		onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
	>
		<Box
			style={{
				width: '7px',
				height: '7px',
				borderRadius: '999px',
				background: 'var(--premium-dashboard-red)',
				flexShrink: 0,
				boxShadow: '0 0 0 3px rgba(207, 68, 56, 0.12)',
			}}
		/>
		<Box style={{ fontSize: '13px', fontWeight: 600, color: 'var(--premium-dashboard-ink)' }}>{title}</Box>
		<Box style={{ fontSize: '12.5px', color: 'var(--premium-dashboard-ink3)' }}>{subtitle}</Box>
		<Box style={{ flex: 1 }} />
		<Box style={{ fontSize: '12px', color: 'var(--premium-dashboard-ink2)', fontVariantNumeric: 'tabular-nums' }}>{date}</Box>
		<Box
			style={{
				fontFamily: "'Geist Mono', monospace",
				fontSize: '10.5px',
				fontWeight: 600,
				padding: '3px 9px',
				borderRadius: '7px',
				background: 'var(--premium-dashboard-red-soft, rgba(207, 68, 56, 0.12))',
				border: '1px solid var(--premium-dashboard-red-line, rgba(207, 68, 56, 0.3))',
				color: 'var(--premium-dashboard-red)',
			}}
		>
			{badge}
		</Box>
	</Box>
);

// Matter row
const MatterRow = ({
	name,
	type,
	date,
	stage,
	stageBg,
	stageColor,
	stageBorder,
	sol,
}: {
	name: string;
	type: string;
	date: string;
	stage: string;
	stageBg: string;
	stageColor: string;
	stageBorder: string;
	sol: string;
}) => (
	<Box
		display='flex'
		alignItems='center'
		paddingInline={12}
		paddingBlockStart={8}
		paddingBlockEnd={8}
		style={{
			padding: '10px 20px',
			borderTop: '1px solid var(--premium-dashboard-border)',
			cursor: 'pointer',
			transition: 'background 120ms',
		}}
		onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--premium-dashboard-border)')}
		onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
	>
		<Box
			style={{
				width: '7px',
				height: '7px',
				borderRadius: '999px',
				background: 'var(--premium-dashboard-green)',
				flexShrink: 0,
			}}
		/>
		<Box
			style={{
				flex: 1,
				minWidth: 0,
				display: 'flex',
				alignItems: 'baseline',
				gap: '9px',
				whiteSpace: 'nowrap',
				overflow: 'hidden',
			}}
		>
			<Box style={{ fontSize: '13px', fontWeight: 600, color: 'var(--premium-dashboard-ink)', flexShrink: 0 }}>{name}</Box>
			<Box style={{ fontSize: '12.5px', color: 'var(--premium-dashboard-ink3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{type}</Box>
		</Box>
		<Box style={{ fontSize: '12px', color: 'var(--premium-dashboard-ink2)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
			{date}
		</Box>
		<Box
			style={{
				width: '106px',
				textAlign: 'center',
				fontSize: '11px',
				fontWeight: 600,
				padding: '3.5px 0',
				borderRadius: '999px',
				background: stageBg,
				color: stageColor,
				border: `1px solid ${stageBorder}`,
				flexShrink: 0,
			}}
		>
			{stage}
		</Box>
		<Box
			style={{
				fontFamily: "'Geist Mono', monospace",
				fontSize: '10.5px',
				color: 'var(--premium-dashboard-ink2)',
				padding: '3px 9px',
				borderRadius: '7px',
				border: '1px solid var(--premium-dashboard-border)',
				background: 'var(--premium-dashboard-border)',
				flexShrink: 0,
			}}
		>
			{sol}
		</Box>
		<Box style={{ fontSize: '14px', color: 'var(--premium-dashboard-ink3)', flexShrink: 0 }}>{'→'}</Box>
	</Box>
);

export const PremiumDashboard = () => {
	const user = useUser();

	const userName = user?.name || user?.username || 'there';

	// Mock data for demonstration
	const stats = useMemo(
		() => ({
			activeMatters: 99,
			dueToday: 0,
			dueThisWeek: 0,
			solLte30d: 2,
		}),
		[],
	);

	const deadlines = useMemo(
		() => [
			{ title: 'SOL — Test Test', sub: 'Motor Vehicle Accident', date: '02/03/2022', badge: '896D OVERDUE' },
			{ title: 'SOL — Judit Ferrer', sub: 'Motor Vehicle Accident', date: '12/30/2024', badge: '535D OVERDUE' },
		],
		[],
	);

	const matters = useMemo(
		() => [
			{
				name: 'Chauncey Frank',
				type: 'Motor Vehicle Accident',
				date: '07/11/2026',
				stage: 'Investigation',
				sol: 'SOL 24 MO',
				stageBg: 'var(--premium-dashboard-green-soft)',
				stageColor: 'var(--premium-dashboard-ink)',
				stageBorder: 'var(--premium-dashboard-border)',
			},
			{
				name: 'Candace Ann Moore',
				type: 'Motor Vehicle Accident',
				date: '07/11/2026',
				stage: 'Initial Review',
				sol: 'SOL 24 MO',
				stageBg: 'var(--premium-dashboard-amber-soft)',
				stageColor: 'var(--premium-dashboard-amber)',
				stageBorder: 'var(--premium-dashboard-border)',
			},
			{
				name: 'Knowledge Mims',
				type: 'Motor Vehicle Accident',
				date: '07/11/2026',
				stage: 'Investigation',
				sol: 'SOL 24 MO',
				stageBg: 'var(--premium-dashboard-green-soft)',
				stageColor: 'var(--premium-dashboard-ink)',
				stageBorder: 'var(--premium-dashboard-border)',
			},
			{
				name: 'Mark Embrey',
				type: 'Motor Vehicle Accident',
				date: '06/18/2026',
				stage: 'Pre-Litigation',
				sol: 'SOL 23 MO',
				stageBg: 'var(--premium-dashboard-blue-soft)',
				stageColor: 'var(--premium-dashboard-blue)',
				stageBorder: 'var(--premium-dashboard-border)',
			},
			{
				name: 'Kailyn Moron',
				type: 'Motor Vehicle Accident',
				date: '02/20/2026',
				stage: 'Pre-Lit Settled',
				sol: 'SOL 19 MO',
				stageBg: 'var(--premium-dashboard-border)',
				stageColor: 'var(--premium-dashboard-ink2)',
				stageBorder: 'var(--premium-dashboard-border)',
			},
			{
				name: 'Mycal Mims',
				type: 'Motor Vehicle Accident',
				date: '07/11/2026',
				stage: 'Investigation',
				sol: 'SOL 24 MO',
				stageBg: 'var(--premium-dashboard-green-soft)',
				stageColor: 'var(--premium-dashboard-ink)',
				stageBorder: 'var(--premium-dashboard-border)',
			},
		],
		[],
	);

	return (
		<Page>
			<PageScrollableContent>
				{/* Sticky header */}
				<Box
					style={{
						position: 'sticky',
						top: 0,
						zIndex: 20,
						backdropFilter: 'blur(14px)',
						WebkitBackdropFilter: 'blur(14px)',
						background: 'rgba(246, 246, 243, 0.82)',
						borderBottom: '1px solid var(--premium-dashboard-border)',
					}}
				>
					<Box
						style={{
							maxWidth: '1180px',
							margin: '0 auto',
							padding: '14px 36px',
							display: 'flex',
							alignItems: 'center',
							gap: '16px',
							flexWrap: 'wrap',
						}}
					>
						<Box style={{ flex: 1, minWidth: '300px' }}>
							<Box
								is='h1'
								style={{
									margin: 0,
									fontSize: '20px',
									fontWeight: 650,
									letterSpacing: '-0.02em',
									color: 'var(--premium-dashboard-ink)',
									fontFamily: "'Geist', system-ui, sans-serif",
								}}
							>
								{timeGreeting()}, {userName}
							</Box>
							<Box
								style={{
									margin: '3px 0 0',
									fontSize: '12.5px',
									color: 'var(--premium-dashboard-ink2)',
									fontFamily: "'Geist', system-ui, sans-serif",
								}}
							>
								{formatDate()} · <span style={{ color: 'var(--premium-dashboard-red)', fontWeight: 500 }}>{stats.solLte30d} matters</span>{' '}
								with a deadline within 30 days
							</Box>
						</Box>
						<Box style={{ display: 'flex', gap: '9px' }}>
							<Button primary>{'+ New matter'}</Button>
							<Button>{'+ New lead'}</Button>
						</Box>
					</Box>
				</Box>

				{/* Content */}
				<Box style={{ maxWidth: '1180px', margin: '0 auto', padding: '6px 36px 48px' }}>
					{/* Stat band */}
					<Box
						style={{
							marginTop: '24px',
							display: 'grid',
							gridTemplateColumns: 'repeat(4, 1fr)',
							background: 'var(--premium-dashboard-surface)',
							border: '1px solid var(--premium-dashboard-border)',
							borderRadius: '14px',
							boxShadow: '0 1px 2px rgba(23,29,25,.05), 0 1px 3px rgba(23,29,25,.04)',
							overflow: 'hidden',
						}}
					>
						<StatTile label='ACTIVE MATTERS' value={stats.activeMatters} />
						<Box style={{ borderLeft: '1px solid var(--premium-dashboard-border)' }}>
							<StatTile label='DUE TODAY' value={stats.dueToday} />
						</Box>
						<Box style={{ borderLeft: '1px solid var(--premium-dashboard-border)' }}>
							<StatTile label='DUE THIS WEEK' value={stats.dueThisWeek} />
						</Box>
						<Box style={{ borderLeft: '1px solid var(--premium-dashboard-border)' }}>
							<StatTile label='SOL ≤ 30D' value={stats.solLte30d} accent />
						</Box>
					</Box>

					{/* Due today + Activity */}
					<Box style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px' }}>
						<ActionCard icon={<CheckCircleIcon />} title='Due today' subtitle="Nothing due today — you're clear." />
						<ActionCard icon={<ActivityIcon />} title='Activity' subtitle='Open your activity inbox' link />
					</Box>

					{/* Approaching deadlines */}
					<CardSection
						icon={<ClockIcon />}
						title='Approaching deadlines'
						count={deadlines.length}
						action={
							<Box
								is='a'
								href='#'
								style={{ fontSize: '12.5px', fontWeight: 500, textDecoration: 'none', color: 'var(--premium-dashboard-green)' }}
							>
								{'View all →'}
							</Box>
						}
					>
						{deadlines.map((d) => (
							<DeadlineRow key={d.title} title={d.title} subtitle={d.sub} date={d.date} badge={d.badge} />
						))}
					</CardSection>

					{/* My matters */}
					<CardSection
						icon={<FolderIcon />}
						title='My matters'
						count={matters.length}
						action={
							<Box
								is='a'
								href='#'
								style={{ fontSize: '12.5px', fontWeight: 500, textDecoration: 'none', color: 'var(--premium-dashboard-green)' }}
							>
								{'View all →'}
							</Box>
						}
					>
						{matters.map((m) => (
							<MatterRow key={m.name} {...m} />
						))}
					</CardSection>
				</Box>
			</PageScrollableContent>
		</Page>
	);
};

// SVG Icon components
const CheckCircleIcon = () => (
	<svg
		width='17'
		height='17'
		viewBox='0 0 24 24'
		fill='none'
		stroke='#116240'
		strokeWidth='1.8'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<circle cx='12' cy='12' r='8.5' />
		<path d='m8.5 12.4 2.4 2.4 4.8-5.2' />
	</svg>
);

const ActivityIcon = () => (
	<svg
		width='17'
		height='17'
		viewBox='0 0 24 24'
		fill='none'
		stroke='var(--premium-dashboard-ink2)'
		strokeWidth='1.8'
		strokeLinecap='round'
		strokeLinejoin='round'
	>
		<path d='M6.3 9.2a5.7 5.7 0 0 1 11.4 0c0 4.4 1.9 5.6 1.9 5.6H4.4s1.9-1.2 1.9-5.6M10 18.8a2.1 2.1 0 0 0 4 0' />
	</svg>
);

const ClockIcon = () => (
	<svg
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='var(--premium-dashboard-ink2)'
		strokeWidth='1.8'
		strokeLinecap='round'
	>
		<circle cx='12' cy='12' r='8.5' />
		<path d='M12 7.5V12l3 2' />
	</svg>
);

const FolderIcon = () => (
	<svg
		width='16'
		height='16'
		viewBox='0 0 24 24'
		fill='none'
		stroke='var(--premium-dashboard-ink2)'
		strokeWidth='1.8'
		strokeLinejoin='round'
	>
		<path d='M3.5 7a2 2 0 0 1 2-2h4.2l2 2.4h7.8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2z' />
	</svg>
);
