import { Box, Button, Callout, Icon, Table, TableBody, TableCell, TableHead, TableRow, Throbber } from '@rocket.chat/fuselage';
import type { CaseloadReportDTO, CaseloadRowDTO } from '@rocket.chat/rest-typings';
import { Page, PageHeader, PageScrollableContentWithShadow, useThemeMode } from '@rocket.chat/ui-client';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';

/**
 * Caseload — the `/boards/matters/caseload` view (Premium Refresh, Wave 3).
 *
 * A modern Fuselage table grouped by assignee, read from
 * `GET /v1/boards.matters.caseload`. Each row = one attorney/case-manager:
 * open-matter count, the stage mix (stacked bar chart), the SOL-at-risk
 * count (red when > 0), and the average days-in-stage. The server bucket for
 * matters with no assignee is rendered as a dedicated "Unassigned" row.
 *
 * All numbers are computed server-side over the cached matter snapshot
 * (query-then-sum, never CasePro aggregate_data), so this is a pure read.
 * Assignee ids are rendered raw — name resolution is intentionally not wired
 * here (degrade gracefully; the integrator can layer avatar/name later).
 *
 * PREMIUM REFRESH SKIN (Wave 3): Modern Geist typography, clean table layout
 * with stacked bar chart for stage mix visualization. Uses CSS variables for
 * light/dark theme support. Per-row gradient accent bar (green for on-plan,
 * red for SOL at risk). Legend shows stage colors + counts.
 *
 * Wiring: register at route name `boards-matters-caseload`
 * (path `/boards/matters/caseload`) gated by `boards-matters-view`.
 * See return summary.
 */

// Premium Refresh theme tokens (light & dark)
type PremiumTheme = {
	bg: string;
	surface: string;
	surface2: string;
	border: string;
	border2: string;
	ink: string;
	ink2: string;
	ink3: string;
	green: string;
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
	purple: string;
	shadow1: string;
};

const LIGHT_THEME: PremiumTheme = {
	bg: '#F6F6F3',
	surface: '#FFFFFF',
	surface2: '#FAFAF7',
	border: '#E7E6E0',
	border2: '#DBDAD3',
	ink: '#171D19',
	ink2: '#57615B',
	ink3: '#8E968F',
	green: '#17804D',
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
	purple: '#7A5FB8',
	shadow1: '0 1px 2px rgba(23,29,25,.05),0 1px 3px rgba(23,29,25,.04)',
};

const DARK_THEME: PremiumTheme = {
	bg: '#0F1512',
	surface: '#151C17',
	surface2: '#19211C',
	border: '#242D27',
	border2: '#2D372F',
	ink: '#E9EDEA',
	ink2: '#A2ACA5',
	ink3: '#707B74',
	green: '#3FBC7C',
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
	purple: '#7A5FB8',
	shadow1: '0 1px 2px rgba(0,0,0,.35)',
};

const getTheme = (mode?: string): PremiumTheme => (mode === 'dark' ? DARK_THEME : LIGHT_THEME);

const fmtDays = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return `${Math.round(value)}d`;
};

// MATTERCHAT: Stage color mapping for stage mix visualization
const getStageColor = (stage: string, theme: PremiumTheme): string => {
	const lower = stage.toLowerCase();
	if (lower.includes('intake')) return theme.green;
	if (lower.includes('review')) return theme.amber;
	if (lower.includes('investigation')) return theme.blue;
	if (lower.includes('pre-litigation') || lower.includes('pre-lit')) return theme.purple;
	if (lower.includes('settled')) return theme.border2;
	return theme.ink3;
};

// Stacked bar chart visualization for stage mix
interface StageMixProps {
	mix: Record<string, number>;
	theme: PremiumTheme;
}

const StageMix = ({ mix, theme }: StageMixProps): ReactElement => {
	const entries = Object.entries(mix).filter(([, count]) => count > 0);
	if (entries.length === 0) {
		return <Box color='hint'>—</Box>;
	}

	const total = entries.reduce((sum, [, count]) => sum + count, 0);

	return (
		<Box display='flex' flexDirection='column' gap='8px'>
			{/* Stacked bar */}
			<Box
				display='flex'
				height='7px'
				borderRadius='99px'
				overflow='hidden'
				border={`1px solid ${theme.border}`}
				style={{ maxWidth: '260px' }}
			>
				{entries.map(([stage, count]) => {
					const percentage = (count / total) * 100;
					const color = getStageColor(stage, theme);
					return <Box key={stage} style={{ flex: `${percentage}%`, background: color, height: '100%' }} />;
				})}
			</Box>
		</Box>
	);
};

// Legend item for stage colors
interface LegendItemProps {
	stage: string;
	color: string;
	count: number;
	theme: PremiumTheme;
}

const LegendItem = ({ stage, color, count, theme }: LegendItemProps): ReactElement => (
	<Box display='inline-flex' alignItems='center' gap='6px' style={{ fontSize: '11.5px', color: theme.ink2 }}>
		<Box style={{ width: '8px', height: '8px', borderRadius: '3px', background: color, flexShrink: 0 }} />
		{stage}{' '}
		<Box is='span' style={{ fontFamily: "ui-monospace, 'SF Mono', monospace", fontSize: '10px', color: theme.ink3 }}>
			{count}
		</Box>
	</Box>
);

interface CaseloadRowProps {
	row: CaseloadRowDTO;
	label: ReactNode;
	theme: PremiumTheme;
}

const CaseloadRow = ({ row, label, theme }: CaseloadRowProps): ReactElement => {
	// The DTO carries the at-risk COUNT only (no per-matter solDate here): any
	// at-risk matter heats the row red; a clear row reads calm green.
	const heat = row.solAtRisk > 0 ? theme.red : theme.green;
	return (
		<TableRow>
			<TableCell style={{ boxShadow: `inset 3px 0 0 0 ${heat}`, paddingLeft: '11px' }}>
				<Box display='flex' alignItems='center' gap='10px'>
					<Box
						style={{
							width: '26px',
							height: '26px',
							borderRadius: '99px',
							border: `1.5px dashed ${theme.border2}`,
							display: 'grid',
							placeItems: 'center',
							color: theme.ink3,
							fontSize: '12px',
						}}
					>
						–
					</Box>
					<Box style={{ fontSize: '13px', fontWeight: 600, color: theme.ink }}>
						{label}
					</Box>
				</Box>
			</TableCell>
			<TableCell align='end' style={{ fontSize: '13px', fontWeight: 600, color: theme.ink, fontVariantNumeric: 'tabular-nums' }}>
				{row.openMatters}
			</TableCell>
			<TableCell style={{ paddingLeft: '24px' }}>
				<StageMix mix={row.stageMix} theme={theme} />
			</TableCell>
			<TableCell align='end'>
				{row.solAtRisk > 0 ? (
					<Box
						is='span'
						display='inline-flex'
						alignItems='center'
						gap='6px'
						style={{
							fontSize: '12.5px',
							color: theme.red,
							fontWeight: 600,
							fontVariantNumeric: 'tabular-nums',
						}}
					>
						<Box
							is='span'
							style={{
								width: '7px',
								height: '7px',
								borderRadius: '99px',
								background: theme.red,
								flexShrink: 0,
							}}
						/>
						{row.solAtRisk}
					</Box>
				) : (
					<Box
						is='span'
						display='inline-flex'
						alignItems='center'
						gap='6px'
						style={{
							fontSize: '12.5px',
							color: theme.ink2,
							fontVariantNumeric: 'tabular-nums',
						}}
					>
						<Box
							is='span'
							style={{
								width: '7px',
								height: '7px',
								borderRadius: '99px',
								background: theme.green,
								flexShrink: 0,
							}}
						/>
						0
					</Box>
				)}
			</TableCell>
			<TableCell align='end' style={{ fontSize: '12.5px', color: theme.ink2, fontVariantNumeric: 'tabular-nums' }}>
				{fmtDays(row.avgDaysInStage)}
			</TableCell>
		</TableRow>
	);
};

const Caseload = (): ReactElement => {
	const { t } = useTranslation();
	const [, , themeMode] = useThemeMode();
	const theme = getTheme(themeMode);
	const getCaseload = useEndpoint('GET', '/v1/boards.matters.caseload');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'matters', 'caseload'],
		queryFn: () => getCaseload({}),
	});

	const report = data?.report as CaseloadReportDTO | undefined;

	// Build the legend data from all rows
	const getLegendData = (): Array<{ stage: string; color: string; count: number }> => {
		const stageMap = new Map<string, number>();
		if (report?.rows) {
			report.rows.forEach((row) => {
				Object.entries(row.stageMix).forEach(([stage, count]) => {
					stageMap.set(stage, (stageMap.get(stage) || 0) + count);
				});
			});
		}
		return Array.from(stageMap.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([stage, count]) => ({
				stage,
				color: getStageColor(stage, theme),
				count,
			}));
	};

	// MATTERCHAT: Premium refresh table styling
	const tableStyleCss = `
		.mcCaseloadPremium .rcx-table__cell {
			padding-block: 11px;
			padding-inline: 18px;
			font-variant-numeric: tabular-nums;
			border-bottom: 1px solid ${theme.border};
			background: transparent;
		}
		.mcCaseloadPremium tbody tr:hover .rcx-table__cell {
			background: ${theme.surface2};
		}
		.mcCaseloadPremium .rcx-table__head {
			background: ${theme.surface2};
		}
		.mcCaseloadPremium .rcx-table__head .rcx-table__cell {
			border-bottom: 1px solid ${theme.border};
			font-family: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
			font-size: 10px;
			letter-spacing: 0.12em;
			color: ${theme.ink3};
			text-transform: uppercase;
			padding-block: 9px;
			padding-inline: 18px;
			font-weight: 500;
		}
	`;

	return (
		<Page style={{ background: theme.bg }}>
			<PageHeader
				title={
					<Box display='flex' alignItems='center' gap='8px'>
						<Box
							style={{
								width: '30px',
								height: '30px',
								borderRadius: '9px',
								background: theme.greenSoft,
								border: `1px solid ${theme.greenLine}`,
								display: 'grid',
								placeItems: 'center',
								color: theme.greenInk,
								flexShrink: 0,
							}}
						>
							<Icon name='team' size='x20' />
						</Box>
						<Box
							withTruncatedText
							style={{
								fontSize: '19px',
								fontWeight: 650,
								letterSpacing: '-0.02em',
								color: theme.ink,
								fontFamily: 'Geist, system-ui, -apple-system, sans-serif',
							}}
						>
							{t('Boards_Matters_Caseload', { defaultValue: 'Caseload' })}
						</Box>
						<Box style={{ flex: 1 }} />
						{report && report.unassigned > 0 && (
							<Box
								style={{
									display: 'inline-flex',
									alignItems: 'center',
									gap: '7px',
									fontSize: '12px',
									fontWeight: 600,
									padding: '5px 12px',
									borderRadius: '99px',
									background: theme.amberSoft,
									border: `1px solid ${theme.amberLine}`,
									color: theme.amber,
									fontFamily: 'Geist, system-ui, -apple-system, sans-serif',
								}}
							>
								{t('Boards_Matters_Unassigned', { defaultValue: 'Unassigned' })}: {report.unassigned}
							</Box>
						)}
						<Button
							primary
							style={{
								height: '31px',
								padding: '0 13px',
								borderRadius: '9px',
								background: theme.green,
								color: '#FFFFFF',
								fontFamily: 'Geist, system-ui, -apple-system, sans-serif',
								fontSize: '12.5px',
								fontWeight: 600,
								border: 'none',
								boxShadow: theme.shadow1,
								cursor: 'pointer',
							}}
						>
							{t('Assign_matters', { defaultValue: 'Assign matters' })}
						</Button>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				<style dangerouslySetInnerHTML={{ __html: tableStyleCss }} />
				<CaseProStubBanner mbe={16} />

				{isLoading && (
					<Box display='flex' justifyContent='center' p={24}>
						<Throbber />
					</Box>
				)}

				{isError && !isLoading && (
					<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
						<Button small mbs={8} onClick={() => refetch()}>
							{t('Reload_page')}
						</Button>
					</Callout>
				)}

				{!isLoading && !isError && report && (
					<Box style={{ maxWidth: '1000px', margin: '0 auto', padding: '22px 28px 60px' }}>
						{/* Section label and count */}
						<Box display='flex' alignItems='baseline' gap='10px' mbe={14}>
							<Box
								is='span'
								style={{
									fontFamily: "ui-monospace, 'SF Mono', monospace",
									fontSize: '10.5px',
									letterSpacing: '0.14em',
									color: theme.ink3,
									textTransform: 'uppercase',
									fontWeight: 500,
								}}
							>
								{t('Boards_Matters_Open_Matters', { defaultValue: 'Open matters' })}
							</Box>
							<Box
								is='span'
								style={{
									fontSize: '24px',
									fontWeight: 650,
									color: theme.ink,
									fontVariantNumeric: 'tabular-nums',
									fontFamily: 'Geist, system-ui, -apple-system, sans-serif',
								}}
							>
								{report.totalOpen}
							</Box>
						</Box>

						{/* Main table */}
						<Box
							className='mcCaseloadPremium'
							style={{
								background: theme.surface,
								border: `1px solid ${theme.border}`,
								borderRadius: '13px',
								boxShadow: theme.shadow1,
								overflow: 'hidden',
								marginBottom: '10px',
							}}
						>
							<Table fixed style={{ width: '100%' }}>
								<TableHead>
									<TableRow>
										<TableCell style={{ textAlign: 'left' }}>
											{t('Boards_Matters_Assignee', { defaultValue: 'Assignee' })}
										</TableCell>
										<TableCell align='end'>{t('Boards_Matters_Open_Matters', { defaultValue: 'Open matters' })}</TableCell>
										<TableCell>{t('Boards_Matters_Stage_Mix', { defaultValue: 'Stage mix' })}</TableCell>
										<TableCell align='end'>{t('Boards_Matters_SOL_At_Risk', { defaultValue: 'SOL at risk' })}</TableCell>
										<TableCell align='end'>{t('Boards_Matters_Days_In_Stage', { defaultValue: 'Days in stage' })}</TableCell>
									</TableRow>
								</TableHead>
								<TableBody>
									{report.rows.map((row) => (
										<CaseloadRow key={row.assigneeId} row={row} label={row.assigneeId} theme={theme} />
									))}
									{report.unassigned > 0 && (
										<CaseloadRow
											key='__unassigned'
											row={{
												assigneeId: '__unassigned',
												openMatters: report.unassigned,
												stageMix: {},
												solAtRisk: 0,
												avgDaysInStage: 0,
											}}
											label={t('Boards_Matters_Unassigned', { defaultValue: 'Unassigned' })}
											theme={theme}
										/>
									)}
									{report.rows.length === 0 && report.unassigned === 0 && (
										<TableRow>
											<TableCell colSpan={5}>
												<Box fontScale='c1' color='hint'>
													{t('No_results_found')}
												</Box>
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</Box>

						{/* Legend */}
						{getLegendData().length > 0 && (
							<Box display='flex' gap='16px' flexWrap='wrap' padding='2px 4px' mbe={20}>
								{getLegendData().map((item) => (
									<LegendItem key={item.stage} {...item} theme={theme} />
								))}
							</Box>
						)}

						{/* Empty state */}
						{report.rows.length === 0 && report.unassigned === 0 && (
							<Box
								style={{
									background: theme.surface,
									border: `1px solid ${theme.border}`,
									borderRadius: '13px',
									boxShadow: theme.shadow1,
									padding: '26px',
									display: 'flex',
									alignItems: 'center',
									gap: '18px',
								}}
							>
								<Box
									style={{
										width: '42px',
										height: '42px',
										borderRadius: '12px',
										background: theme.greenSoft,
										border: `1px solid ${theme.greenLine}`,
										display: 'grid',
										placeItems: 'center',
										color: theme.greenInk,
										flexShrink: 0,
									}}
								>
									<Icon name='team' size='x20' />
								</Box>
								<Box style={{ flex: 1 }}>
									<Box
										style={{
											fontSize: '14px',
											fontWeight: 650,
											color: theme.ink,
											fontFamily: 'Geist, system-ui, -apple-system, sans-serif',
										}}
									>
										{t('No_assignees_yet', { defaultValue: 'No assignees yet' })}
									</Box>
									<Box
										style={{
											marginTop: '3px',
											fontSize: '12.5px',
											color: theme.ink2,
											lineHeight: 1.5,
											fontFamily: 'Geist, system-ui, -apple-system, sans-serif',
										}}
									>
										{t('No_assignees_description', {
											defaultValue: 'Assign matters to teammates to see workload distribution, stage mix, and SOL risk per person.',
										})}
									</Box>
								</Box>
								<Button
									primary
									style={{
										height: '31px',
										padding: '0 13px',
										borderRadius: '9px',
										background: theme.green,
										color: '#FFFFFF',
										fontFamily: 'Geist, system-ui, -apple-system, sans-serif',
										fontSize: '12.5px',
										fontWeight: 600,
										border: 'none',
										boxShadow: theme.shadow1,
										cursor: 'pointer',
										flexShrink: 0,
									}}
								>
									{t('Assign_matters', { defaultValue: 'Assign matters' })}
								</Button>
							</Box>
						)}
					</Box>
				)}
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default Caseload;
