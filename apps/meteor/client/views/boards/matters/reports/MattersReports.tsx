import { Box, Button, Callout, Icon, Table, TableBody, TableCell, TableHead, TableRow, Throbber } from '@rocket.chat/fuselage';
import type { AgingReportDTO, FinancialReportDTO } from '@rocket.chat/rest-typings';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint, useRouter } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';
import { heatPill, monoLabel, serifCaption, tabularNums, useLedgerTones } from '../../lib/ledgerTheme';

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

const STUCK_MATTER_DAYS = 30; // mirrors server reports.ts STUCK_MATTER_DAYS

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

// A single headline metric — a paper ledger card with a green rail.
const Metric = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }): ReactElement => {
	const tones = useLedgerTones();
	return (
		<Box
			pb={10}
			pi={12}
			minWidth={160}
			flexGrow={1}
			flexBasis={160}
			style={{
				background: tones.card,
				border: `1px solid ${tones.stroke}`,
				borderRadius: 6,
				boxShadow: `inset 3px 0 0 0 ${tones.green}`,
			}}
		>
			<Box mbe={4} style={monoLabel(tones)}>
				{label}
			</Box>
			<Box fontScale='h3' color='default' style={tabularNums}>
				{value}
			</Box>
			{hint !== undefined && hint !== null && hint !== '' && (
				<Box fontScale='micro' mbs={2} style={{ ...tabularNums, color: tones.inkMuted }}>
					{hint}
				</Box>
			)}
		</Box>
	);
};

const SectionTitle = ({ children }: { children: ReactNode }): ReactElement => (
	<Box fontScale='h4' color='default' mbs={24} mbe={12} style={serifCaption}>
		{children}
	</Box>
);

const FinancialPanel = (): ReactElement => {
	const { t } = useTranslation();
	const getFinancial = useEndpoint('GET', '/v1/boards.matters.reports.financial');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'matters', 'reports', 'financial'],
		queryFn: () => getFinancial({}),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' p={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small mbs={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	const report = data.report as FinancialReportDTO;

	return (
		<Box>
			<Box display='flex' flexWrap='wrap' style={{ gap: '10px' }}>
				<Metric
					label={t('Boards_Matters_Demand_Outstanding', { defaultValue: 'Demand outstanding' })}
					value={fmtCurrency(report.demandOutstanding)}
				/>
				<Metric
					label={t('Boards_Matters_Settled_Value', { defaultValue: 'Settled value' })}
					value={fmtCurrency(report.settledValue)}
					hint={t('Boards_Matters_Settled_Matters_Count', {
						count: report.settledMatters,
						defaultValue: '{{count}} matters',
					})}
				/>
				<Metric
					label={t('Boards_Matters_Projected_Fees', { defaultValue: 'Projected fees' })}
					value={fmtCurrency(report.projectedFees)}
					hint={fmtPct(report.feePct)}
				/>
				<Metric label={t('Boards_Matters_Total_Billed', { defaultValue: 'Total billed' })} value={fmtCurrency(report.totalBilled)} />
				<Metric label={t('Boards_Matters_Total_Balance', { defaultValue: 'Total balance' })} value={fmtCurrency(report.totalBalance)} />
				<Metric label={t('Boards_Matters_Open_Matters', { defaultValue: 'Open matters' })} value={report.matterCount} />
			</Box>
		</Box>
	);
};

const AgingPanel = (): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const router = useRouter();
	const getAging = useEndpoint('GET', '/v1/boards.matters.reports.aging');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'matters', 'reports', 'aging'],
		queryFn: () => getAging({}),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' p={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small mbs={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	const report = data.report as AgingReportDTO;

	const openCard = (cardId: string): void => {
		router.navigate({ name: 'boards-matters', params: { cardId } });
	};

	const monoHead = (label: ReactNode): ReactElement => (
		<Box is='span' style={monoLabel(tones)}>
			{label}
		</Box>
	);

	return (
		<Box className='mcLedgerReports'>
			<Box style={{ background: tones.card, border: `1px solid ${tones.stroke}`, borderRadius: 6 }}>
				<Table fixed>
					<TableHead>
						<TableRow>
							<TableCell>{monoHead(t('Boards_Matters_Stage', { defaultValue: 'Stage' }))}</TableCell>
							<TableCell align='end'>{monoHead(t('Boards_Matters_Open_Matters', { defaultValue: 'Open matters' }))}</TableCell>
							<TableCell align='end'>{monoHead(t('Boards_Matters_Days_In_Stage', { defaultValue: 'Days in stage' }))}</TableCell>
							<TableCell align='end'>{monoHead('p90')}</TableCell>
							<TableCell align='end'>{monoHead(t('Boards_Matters_Stuck_Matters', { defaultValue: 'Stuck matters' }))}</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{report.stages.map((stage) => (
							<TableRow key={stage.listId}>
								<TableCell>{stage.stageName}</TableCell>
								<TableCell align='end'>{stage.count}</TableCell>
								<TableCell align='end'>{fmtDays(stage.avgDaysInStage)}</TableCell>
								<TableCell align='end'>{fmtDays(stage.p90DaysInStage)}</TableCell>
								<TableCell align='end'>
									{stage.stuck > 0 ? (
										<Box is='span' style={heatPill(tones.red, tones.redSoft)}>
											{stage.stuck}
										</Box>
									) : (
										<Box color='hint'>0</Box>
									)}
								</TableCell>
							</TableRow>
						))}
						{report.stages.length === 0 && (
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

			{report.stuckMatters.length > 0 && (
				<Box mbs={20}>
					<Box fontScale='p2b' color='default' mbe={8} style={serifCaption}>
						<Icon name='warning' size='x16' mie={4} style={{ color: tones.red }} />
						{t('Boards_Matters_Stuck_Matters', { defaultValue: 'Stuck matters' })}
						<Box is='span' fontScale='c1' style={{ color: tones.inkMuted, fontFamily: 'inherit' }}>
							{' '}
							({t('Boards_Matters_Stuck_Over_Days', { days: STUCK_MATTER_DAYS, defaultValue: '> {{days}}d in stage' })})
						</Box>
					</Box>
					<Box style={{ background: tones.card, border: `1px solid ${tones.stroke}`, borderRadius: 6 }}>
						<Table fixed>
							<TableHead>
								<TableRow>
									<TableCell>{monoHead(t('Boards_Matters_Matter', { defaultValue: 'Matter' }))}</TableCell>
									<TableCell>{monoHead(t('Boards_Matters_Stage', { defaultValue: 'Stage' }))}</TableCell>
									<TableCell align='end'>{monoHead(t('Boards_Matters_Days_In_Stage', { defaultValue: 'Days in stage' }))}</TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{report.stuckMatters.map((m) => (
									<TableRow key={m.cardId} action onClick={() => openCard(m.cardId)}>
										<TableCell style={{ boxShadow: `inset 3px 0 0 0 ${tones.red}` }}>{m.title}</TableCell>
										<TableCell>{m.stageName}</TableCell>
										<TableCell align='end'>
											<Box is='span' style={heatPill(tones.red, tones.redSoft)}>
												{fmtDays(m.daysInStage)}
											</Box>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</Box>
				</Box>
			)}
		</Box>
	);
};

const MattersReports = (): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();

	return (
		<Page style={{ background: tones.paper }}>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='dashboard' size='x24' mie={8} style={{ color: tones.green }} />
						<Box withTruncatedText style={serifCaption}>
							{t('Boards_Matters_Reports', { defaultValue: 'Reports' })}
						</Box>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				{/* Static, theme-derived constant string — the dense ruled-table skin. */}
				<style dangerouslySetInnerHTML={{ __html: buildLedgerTableCss(tones.strokeSoft, tones.cardAlt) }} />
				<CaseProStubBanner mbe={16} />

				<SectionTitle>{t('Boards_Matters_Report_Financial', { defaultValue: 'Financial' })}</SectionTitle>
				<FinancialPanel />

				<SectionTitle>{t('Boards_Matters_Report_Aging', { defaultValue: 'Pipeline aging' })}</SectionTitle>
				<AgingPanel />
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default MattersReports;
