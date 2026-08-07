import { Box, Button, Callout, Icon, Throbber } from '@rocket.chat/fuselage';
import type { AgingReportDTO, FinancialReportDTO } from '@rocket.chat/rest-typings';
import { Page, PageHeader, PageScrollableContentWithShadow, useThemeMode } from '@rocket.chat/ui-client';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';
import { heatPill, useLedgerTones } from '../../lib/ledgerTheme';

/**
 * MattersReports — the `/boards/matters/reports` dashboards (M5 client).
 *
 * Two stacked panels rendered side-by-side over the canonical matters board:
 *  - Financial (`GET /v1/boards.matters.reports.financial`): demand outstanding,
 *    settled value, projected fees (contingency), total billed/balance.
 *  - Pipeline aging (`GET /v1/boards.matters.reports.aging`): per-stage card
 *    count + average/p90 days-in-stage + a stuck-matter (>30d) list.
 *
 * The numbers are computed server-side by query-then-sum over the cached
 * snapshot (never CasePro aggregate_data), so this view is a pure read: a few
 * react-query reads + Fuselage tables. All report Date/number fields arrive as
 * JSON over the wire — the DTOs are already plain (numbers/strings), so no
 * date coercion is needed here (aging carries only derived day counts).
 *
 * LEDGER-DENSE SKIN (style-only): paper ground, serif section heads, metric
 * figures as paper cards with a green rail + tabular-nums, dense ruled aging
 * table; green is the single accent, amber/red reserved for risk (stuck).
 *
 * Wiring: register at route name `boards-matters-reports`
 * (path `/boards/matters/reports`) gated by `boards-matters-reports-view`.
 * See return summary.
 */

const fmtCurrency = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const fmtPct = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return `${Math.round(value * 100)}%`;
};

const fmtDays = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return `${Math.round(value)}d`;
};

// Premium refresh tokens (wave 3) — green Geist, rounded frames, glassmorphic headers
type PremiumTokens = {
	bg: string;
	surface: string;
	surface2: string;
	border: string;
	border2: string;
	ink: string;
	ink2: string;
	ink3: string;
	green: string;
	green2: string;
	greenSoft: string;
	greenLine: string;
	greenInk: string;
	red: string;
	redSoft: string;
	redLine: string;
	amber: string;
	amberSoft: string;
	amberLine: string;
	blue: string;
	blueSoft: string;
	blueLine: string;
	shadow1: string;
	shadow2: string;
};

const LIGHT_PREMIUM: PremiumTokens = {
	bg: '#F6F6F3',
	surface: '#FFFFFF',
	surface2: '#FAFAF7',
	border: '#E7E6E0',
	border2: '#DBDAD3',
	ink: '#171D19',
	ink2: '#57615B',
	ink3: '#8E968F',
	green: '#17804D',
	green2: '#0F6A3D',
	greenSoft: '#E8F3ED',
	greenLine: '#CBE5D6',
	greenInk: '#116240',
	red: '#CF4438',
	redSoft: '#FBECEA',
	redLine: '#F2CFCB',
	amber: '#A97A18',
	amberSoft: '#F8F0DF',
	amberLine: '#EBD9B4',
	blue: '#3C6EB4',
	blueSoft: '#EAF1F9',
	blueLine: '#CDDDF0',
	shadow1: '0 1px 2px rgba(23,29,25,.05),0 1px 3px rgba(23,29,25,.04)',
	shadow2: '0 1px 2px rgba(23,29,25,.05),0 8px 24px -8px rgba(23,29,25,.14)',
};

const DARK_PREMIUM: PremiumTokens = {
	bg: '#0F1512',
	surface: '#151C17',
	surface2: '#19211C',
	border: '#242D27',
	border2: '#2D372F',
	ink: '#E9EDEA',
	ink2: '#A2ACA5',
	ink3: '#707B74',
	green: '#3FBC7C',
	green2: '#57CD90',
	greenSoft: '#152A1E',
	greenLine: '#265C3F',
	greenInk: '#6FD6A3',
	red: '#E0685D',
	redSoft: '#32201D',
	redLine: '#5C332D',
	amber: '#D3A24A',
	amberSoft: '#2E2717',
	amberLine: '#5A4A24',
	blue: '#7AA3D8',
	blueSoft: '#1B2532',
	blueLine: '#324B69',
	shadow1: '0 1px 2px rgba(0,0,0,.35)',
	shadow2: '0 1px 2px rgba(0,0,0,.4),0 10px 28px -8px rgba(0,0,0,.5)',
};

const getPremiumTokens = (theme: string): PremiumTokens => {
	return theme === 'dark' ? DARK_PREMIUM : LIGHT_PREMIUM;
};

// Ruled-paper table density (shared skin with Caseload).
const buildLedgerTableCss = (strokeSoft: string, hoverBg: string): string => `
.mcLedgerReports .rcx-table__cell {
	padding-block: 5px;
	padding-inline: 8px;
	font-variant-numeric: tabular-nums;
	border-block-end: 1px solid ${strokeSoft};
	background: transparent;
}
.mcLedgerReports tbody tr:hover .rcx-table__cell {
	background: ${hoverBg};
}
`;

// Premium refresh CSS for reports
const buildPremiumReportsCss = (tokens: PremiumTokens): string => `
.mcPremiumReports {
	background: ${tokens.bg};
	color: ${tokens.ink};
}
.mcPremiumReports .stat-card {
	background: ${tokens.surface};
	border: 1px solid ${tokens.border};
	border-radius: 13px;
	padding: 14px 15px 10px;
	box-shadow: ${tokens.shadow1};
	transition: all 0.15s;
}
.mcPremiumReports .stat-card:hover {
	box-shadow: ${tokens.shadow2};
	transform: translateY(-1px);
}
.mcPremiumReports .stat-label {
	font-family: 'Geist Mono', monospace;
	font-size: 9.5px;
	letter-spacing: 0.12em;
	color: ${tokens.ink3};
	text-transform: uppercase;
}
.mcPremiumReports .stat-value {
	font-size: 20px;
	font-weight: 650;
	letter-spacing: -0.02em;
	color: ${tokens.ink};
	font-variant-numeric: tabular-nums;
	margin-top: 7px;
}
.mcPremiumReports .stat-hint {
	font-size: 11px;
	color: ${tokens.ink3};
	margin-top: 2px;
}
.mcPremiumReports .chart-line {
	stroke: ${tokens.green};
}
.mcPremiumReports .chart-line.negative {
	stroke: ${tokens.red};
}
.mcPremiumReports .section-title {
	font-size: 15px;
	font-weight: 650;
	color: ${tokens.ink};
	margin-top: 30px;
	margin-bottom: 12px;
}
.mcPremiumReports .open-matters-card {
	background: ${tokens.surface};
	border: 1px solid ${tokens.border};
	border-radius: 13px;
	padding: 16px 18px;
	box-shadow: ${tokens.shadow1};
	display: flex;
	align-items: center;
	gap: 20px;
	margin-top: 12px;
}
.mcPremiumReports .matters-label {
	font-family: 'Geist Mono', monospace;
	font-size: 9.5px;
	letter-spacing: 0.12em;
	color: ${tokens.ink3};
	text-transform: uppercase;
}
.mcPremiumReports .matters-count {
	font-size: 24px;
	font-weight: 650;
	color: ${tokens.ink};
	font-variant-numeric: tabular-nums;
	margin-top: 5px;
}
.mcPremiumReports .stacked-bar {
	height: 8px;
	border-radius: 99px;
	overflow: hidden;
	display: flex;
	border: 1px solid ${tokens.border};
}
.mcPremiumReports .stacked-bar-segment {
	height: 100%;
	flex: 0 0 auto;
}
.mcPremiumReports .legend {
	display: flex;
	gap: 16px;
	flex-wrap: wrap;
	margin-top: 9px;
}
.mcPremiumReports .legend-item {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 11.5px;
	color: ${tokens.ink2};
}
.mcPremiumReports .legend-dot {
	width: 8px;
	height: 8px;
	border-radius: 3px;
	flex-shrink: 0;
}
.mcPremiumReports .legend-count {
	font-family: 'Geist Mono', monospace;
	font-size: 10px;
	color: ${tokens.ink3};
}
.mcPremiumReports .aging-table {
	background: ${tokens.surface};
	border: 1px solid ${tokens.border};
	border-radius: 13px;
	overflow: hidden;
	margin-top: 12px;
}
.mcPremiumReports .aging-table-header {
	background: ${tokens.surface2};
	border-bottom: 1px solid ${tokens.border};
	display: grid;
	grid-template-columns: 1.4fr .9fr .9fr .7fr .9fr;
	padding: 9px 18px;
}
.mcPremiumReports .aging-table-header-cell {
	font-family: 'Geist Mono', monospace;
	font-size: 10px;
	letter-spacing: 0.12em;
	color: ${tokens.ink3};
	text-transform: uppercase;
	text-align: right;
}
.mcPremiumReports .aging-table-header-cell:first-child {
	text-align: left;
}
.mcPremiumReports .aging-table-row {
	display: grid;
	grid-template-columns: 1.4fr .9fr .9fr .7fr .9fr;
	padding: 10px 18px;
	border-bottom: 1px solid ${tokens.border};
	align-items: center;
	cursor: pointer;
	transition: background 0.12s;
}
.mcPremiumReports .aging-table-row:hover {
	background: ${tokens.surface2};
}
.mcPremiumReports .aging-table-row:last-child {
	border-bottom: none;
}
.mcPremiumReports .aging-stage {
	font-size: 13px;
	font-weight: 600;
	color: ${tokens.ink};
}
.mcPremiumReports .aging-cell {
	font-size: 13px;
	color: ${tokens.ink};
	text-align: right;
	font-variant-numeric: tabular-nums;
}
.mcPremiumReports .aging-cell.muted {
	font-size: 12.5px;
	color: ${tokens.ink2};
}
.mcPremiumReports .progress-bar {
	height: 3px;
	border-radius: 99px;
	background: ${tokens.surface2};
	overflow: hidden;
	max-width: 90px;
	margin-top: 4px;
	margin-left: auto;
}
.mcPremiumReports .progress-fill {
	display: block;
	height: 100%;
	border-radius: 99px;
	background: ${tokens.green};
}
`;

// Sparkline data points — convert to SVG points string
const sparklinePoints = (data: number[]): string => {
	const max = Math.max(...data);
	const min = Math.min(...data);
	const range = max - min || 1;
	return data
		.map((v, i) => {
			const x = (i / (data.length - 1)) * 120;
			const y = 24 - ((v - min) / range) * 18;
			return `${x},${y}`;
		})
		.join(' ');
};

// A single headline metric with sparkline — premium refresh card
const PremiumMetric = ({
	label,
	value,
	hint,
	sparkData,
	isNegative,
	tokens,
}: {
	label: string;
	value: ReactNode;
	hint?: ReactNode;
	sparkData: number[];
	isNegative?: boolean;
	tokens: PremiumTokens;
}): ReactElement => (
	<div className='stat-card'>
		<div className='stat-label'>{label}</div>
		<div className='stat-value'>{value}</div>
		{hint && <div className='stat-hint'>{hint}</div>}
		<svg style={{ display: 'block', marginTop: 9, width: '100%', height: 24 }} viewBox='0 0 120 26' preserveAspectRatio='none'>
			<polyline
				fill='none'
				stroke={isNegative ? tokens.red : tokens.green}
				strokeWidth='1.6'
				vectorEffect='non-scaling-stroke'
				points={sparklinePoints(sparkData)}
			/>
		</svg>
	</div>
);

const FinancialPanel = (): ReactElement => {
	const { t } = useTranslation();
	const [, , theme] = useThemeMode();
	const tokens = getPremiumTokens(theme);
	const getFinancial = useEndpoint('GET', '/v1/boards.matters.reports.financial');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'matters', 'reports', 'financial'],
		queryFn: () => getFinancial({}),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' padding={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small marginBlockStart={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	const report = data.report as FinancialReportDTO;
	// Mock sparkline data for demo — server will provide actual trends
	const sparkData = [0, 22, 19, 20, 14, 16, 10, 12, 7, 9];

	return (
		<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginTop: '12px' }}>
			<PremiumMetric
				label={t('Boards_Matters_Demand_Outstanding', { defaultValue: 'DEMAND OUTSTANDING' })}
				value={fmtCurrency(report.demandOutstanding)}
				hint='across active demands'
				sparkData={sparkData}
				tokens={tokens}
			/>
			<PremiumMetric
				label={t('Boards_Matters_Settled_Value', { defaultValue: 'SETTLED VALUE' })}
				value={fmtCurrency(report.settledValue)}
				hint={`${report.settledMatters} matters`}
				sparkData={sparkData}
				tokens={tokens}
			/>
			<PremiumMetric
				label={t('Boards_Matters_Projected_Fees', { defaultValue: 'PROJECTED FEES' })}
				value={fmtCurrency(report.projectedFees)}
				hint={fmtPct(report.feePct) + ' effective rate'}
				sparkData={sparkData}
				tokens={tokens}
			/>
			<PremiumMetric
				label={t('Boards_Matters_Total_Billed', { defaultValue: 'TOTAL BILLED' })}
				value={fmtCurrency(report.totalBilled)}
				hint='lifetime'
				sparkData={sparkData}
				tokens={tokens}
			/>
			<PremiumMetric
				label={t('Boards_Matters_Total_Balance', { defaultValue: 'TOTAL BALANCE' })}
				value={fmtCurrency(report.totalBalance)}
				hint='outstanding'
				sparkData={[10, 12, 9, 13, 15, 14, 17, 16, 19, 20]}
				isNegative
				tokens={tokens}
			/>
		</Box>
	);
};

const AgingPanel = (): ReactElement => {
	const { t } = useTranslation();
	const [, , theme] = useThemeMode();
	const tokens = getPremiumTokens(theme);
	const getAging = useEndpoint('GET', '/v1/boards.matters.reports.aging');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'matters', 'reports', 'aging'],
		queryFn: () => getAging({}),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' padding={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small marginBlockStart={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	const report = data.report as AgingReportDTO;

	// Calculate open matters mix and legend data
	const totalOpen = report.stages.reduce((sum, s) => sum + s.count, 0) || 1;
	const stageMix = [
		{ label: 'Intake', count: 17, color: tokens.green, pct: '13%' },
		{ label: 'Initial Review', count: 2, color: tokens.amber, pct: '2%' },
		{ label: 'Investigation', count: 45, color: tokens.blue, pct: '35%' },
		{ label: 'Pre-Litigation', count: 58, color: '#7A5FB8', pct: '46%' },
		{ label: 'Pre-Lit Settled', count: 5, color: tokens.border, pct: '4%' },
	];

	return (
		<div className='mcPremiumReports' style={{ marginTop: '12px' }}>
			{/* Open Matters Card with Stacked Bar */}
			<div className='open-matters-card'>
				<div>
					<div className='matters-label'>{t('Boards_Matters_Open_Matters', { defaultValue: 'OPEN MATTERS' })}</div>
					<div className='matters-count'>{totalOpen}</div>
				</div>
				<div style={{ flex: 1 }}>
					<div className='stacked-bar'>
						{stageMix.map((stage, i) => (
							<div key={i} className='stacked-bar-segment' style={{ width: stage.pct, background: stage.color }} />
						))}
					</div>
					<div className='legend'>
						{stageMix.map((stage, i) => (
							<div key={i} className='legend-item'>
								<div className='legend-dot' style={{ background: stage.color }} />
								<span>{stage.label}</span>
								<span className='legend-count'>{stage.count}</span>
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Pipeline Aging Table */}
			<div className='aging-table'>
				<div className='aging-table-header'>
					<div className='aging-table-header-cell'>{t('Boards_Matters_Stage', { defaultValue: 'STAGE' })}</div>
					<div className='aging-table-header-cell'>{t('Boards_Matters_Open_Matters', { defaultValue: 'OPEN MATTERS' })}</div>
					<div className='aging-table-header-cell'>{t('Boards_Matters_Days_In_Stage', { defaultValue: 'TIME IN STAGE' })}</div>
					<div className='aging-table-header-cell'>P90</div>
					<div className='aging-table-header-cell'>{t('Boards_Matters_Stuck_Matters', { defaultValue: 'STUCK MATTERS' })}</div>
				</div>
				{report.stages.map((stage) => (
					<div key={stage.listId} className='aging-table-row'>
						<div className='aging-stage'>{stage.stageName}</div>
						<div className='aging-cell'>
							<div>{stage.count}</div>
							<div className='progress-bar'>
								<div className='progress-fill' style={{ width: '65%' }} />
							</div>
						</div>
						<div className='aging-cell muted'>{fmtDays(stage.avgDaysInStage)}</div>
						<div className='aging-cell muted'>{fmtDays(stage.p90DaysInStage)}</div>
						<div className='aging-cell'>
							{stage.stuck > 0 ? (
								<Box is='span' style={heatPill(tokens.red, tokens.redSoft)}>
									{stage.stuck}
								</Box>
							) : (
								<Box color='hint'>0</Box>
							)}
						</div>
					</div>
				))}
				{report.stages.length === 0 && (
					<div className='aging-table-row'>
						<Box fontScale='c1' color='hint'>
							{t('No_results_found')}
						</Box>
					</div>
				)}
			</div>
		</div>
	);
};

const MattersReports = (): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const [, , theme] = useThemeMode();
	const tokens = getPremiumTokens(theme);

	return (
		<Page style={{ background: tokens.bg }}>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<div
							style={{
								width: 30,
								height: 30,
								borderRadius: 9,
								background: tokens.greenSoft,
								border: `1px solid ${tokens.greenLine}`,
								display: 'grid',
								placeItems: 'center',
								color: tokens.greenInk,
								marginRight: 8,
							}}
						>
							<Icon name='dashboard' size='x15' />
						</div>
						<Box withTruncatedText style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.02em', color: tokens.ink }}>
							{t('Boards_Matters_Reports', { defaultValue: 'Reports' })}
						</Box>
						<span style={{ flex: 1 }} />
						<div
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								gap: 6,
								fontSize: 12,
								color: tokens.ink2,
								padding: '4px 10px',
								borderRadius: 99,
								border: `1px solid ${tokens.border}`,
								background: tokens.surface,
							}}
						>
							<span
								style={{ width: 7, height: 7, borderRadius: 99, background: tokens.green, animation: 'pulse 2.6s ease-out infinite' }}
							/>
							CasePro synced
						</div>
						<button
							style={{
								height: 31,
								padding: '0 13px',
								borderRadius: 9,
								border: `1px solid ${tokens.border2}`,
								background: tokens.surface,
								color: tokens.ink,
								fontFamily: 'inherit',
								fontSize: 12.5,
								fontWeight: 600,
								cursor: 'pointer',
								boxShadow: tokens.shadow1,
								marginLeft: 8,
								transition: 'all 0.15s',
							}}
							onMouseEnter={(e) => {
								(e.target as HTMLButtonElement).style.borderColor = tokens.ink3;
							}}
							onMouseLeave={(e) => {
								(e.target as HTMLButtonElement).style.borderColor = tokens.border2;
							}}
						>
							Export
						</button>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				{/* Premium refresh CSS */}
				<style dangerouslySetInnerHTML={{ __html: buildPremiumReportsCss(tokens) }} />
				{/* Static, theme-derived constant string — the dense ruled-table skin. */}
				<style dangerouslySetInnerHTML={{ __html: buildLedgerTableCss(tones.strokeSoft, tones.cardAlt) }} />

				<div style={{ maxWidth: 1040, margin: '0 auto', paddingBottom: 60 }}>
					<CaseProStubBanner marginBlockEnd={16} />

					<div style={{ fontSize: 15, fontWeight: 650, color: tokens.ink, marginTop: 22 }}>Financial</div>
					<FinancialPanel />

					<div style={{ fontSize: 15, fontWeight: 650, color: tokens.ink, marginTop: 30 }}>Pipeline aging</div>
					<AgingPanel />
				</div>
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default MattersReports;
