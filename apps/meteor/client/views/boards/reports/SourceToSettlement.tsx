import {
	Box,
	Button,
	Callout,
	Icon,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Tag,
	Throbber,
} from '@rocket.chat/fuselage';
import type { SourceToSettlementResultDTO, SourceToSettlementRowDTO } from '@rocket.chat/rest-typings';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../casepro';

/**
 * SourceToSettlement — the `/boards/reports/source-to-settlement` cross-pipeline
 * attribution dashboard (M8, differentiators.md §7 "closed loop").
 *
 * Reads `GET /v1/boards.reports.sourceToSettlement` (gated `boards-view-reports`,
 * optional capture-date window) and renders the leads -> signed -> settlement
 * join most CRMs lose at "signed": per marketing source/campaign — leads, signed,
 * conversion %, spend, cost-per-lead, cost-per-signed, revenue (the converted
 * matter's cached CasePro settlement/demand value), ROAS and ROI%. Campaign rows
 * nest under their source; an UNATTRIBUTED bucket (leads with no source) and a
 * totals strip (excluding campaign rows to avoid double-count) frame the table.
 *
 * All math is server-side query-then-sum (never CasePro aggregate GROUP BY).
 * When `revenueResolved:false`, CasePro was partially unreachable and
 * revenue/ROAS/ROI are partial — surfaced as a warning so they aren't read as
 * final. Numbers arrive plain over JSON; no date coercion needed.
 *
 * Wiring: register at route name `boards-reports-source-to-settlement`
 * (path `/boards/reports/source-to-settlement`) gated by `boards-view-reports`.
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
	return `${Math.round(value)}%`;
};

const fmtRoas = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value) || value === 0) {
		return '—';
	}
	return `${value.toFixed(1)}×`;
};

const Metric = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }): ReactElement => (
	<Box pb={16} pi={16} bg='tint' borderRadius='x4' minWidth={150} flexGrow={1} flexBasis={150}>
		<Box fontScale='c1' color='hint' mbe={4}>
			{label}
		</Box>
		<Box fontScale='h3' color='default'>
			{value}
		</Box>
		{hint !== undefined && hint !== null && hint !== '' && (
			<Box fontScale='micro' color='hint' mbs={4}>
				{hint}
			</Box>
		)}
	</Box>
);

const SectionTitle = ({ children }: { children: ReactNode }): ReactElement => (
	<Box fontScale='h4' color='default' mbs={24} mbe={12}>
		{children}
	</Box>
);

// roiPct can be strongly negative (spend with no revenue) — tone it.
const RoiTag = ({ roiPct, resolved }: { roiPct: number; resolved: boolean }): ReactElement => {
	if (!resolved) {
		return <Box color='hint'>—</Box>;
	}
	const variant = roiPct >= 0 ? 'primary' : 'secondary-danger';
	return (
		<Tag variant={variant}>
			{roiPct >= 0 ? '+' : ''}
			{fmtPct(roiPct)}
		</Tag>
	);
};

const SourceRow = ({ row, indented }: { row: SourceToSettlementRowDTO; indented?: boolean }): ReactElement => (
	<TableRow>
		<TableCell>
			<Box display='flex' alignItems='center' style={{ gap: '6px', paddingInlineStart: indented ? 16 : 0 }}>
				{indented && <Icon name='kebab' size='x12' color='hint' />}
				<Box withTruncatedText fontScale={indented ? 'p2' : 'p2b'}>
					{indented ? row.campaignName || row.campaignId : row.sourceName}
				</Box>
				{!indented && row.channel && (
					<Tag variant='secondary' medium>
						{row.channel}
					</Tag>
				)}
			</Box>
		</TableCell>
		<TableCell align='end'>{row.leads}</TableCell>
		<TableCell align='end'>{row.signed}</TableCell>
		<TableCell align='end'>{fmtPct(row.conversionPct)}</TableCell>
		<TableCell align='end'>{fmtCurrency(row.spend)}</TableCell>
		<TableCell align='end'>{row.spend > 0 ? fmtCurrency(row.costPerLead) : '—'}</TableCell>
		<TableCell align='end'>{row.spend > 0 ? fmtCurrency(row.costPerSigned) : '—'}</TableCell>
		<TableCell align='end'>
			{row.revenueResolved ? (
				fmtCurrency(row.revenue)
			) : (
				<Box color='hint' title='CRM unavailable'>
					—
				</Box>
			)}
		</TableCell>
		<TableCell align='end'>{fmtRoas(row.roas)}</TableCell>
		<TableCell align='end'>
			<RoiTag roiPct={row.roiPct} resolved={row.revenueResolved} />
		</TableCell>
	</TableRow>
);

const SourceToSettlement = (): ReactElement => {
	const { t } = useTranslation();

	const getReport = useEndpoint('GET', '/v1/boards.reports.sourceToSettlement');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'reports', 'sourceToSettlement'],
		queryFn: () => getReport({}),
	});

	const report = data?.report as SourceToSettlementResultDTO | undefined;

	// group campaign rows under their parent source for the nested render.
	const sourceRows = (report?.rows ?? []).filter((r) => !r.campaignId);
	const campaignsBySource = (report?.rows ?? [])
		.filter((r) => r.campaignId)
		.reduce<Record<string, SourceToSettlementRowDTO[]>>((acc, r) => {
			(acc[r.sourceId] ??= []).push(r);
			return acc;
		}, {});

	return (
		<Page>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='dashboard' size='x24' mie={8} color='hint' />
						<Box withTruncatedText>
							{t('Boards_Reports_SourceToSettlement', { defaultValue: 'Source-to-settlement' })}
						</Box>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				<Box fontScale='c1' color='hint' mbe={16}>
					{t('Boards_Reports_SourceToSettlement_Subtitle', {
						defaultValue: 'Marketing source → signed case → settlement. The closed loop most CRMs lose at "signed".',
					})}
				</Box>

				<CaseProStubBanner mbe={16} />

				{report && !report.revenueResolved && (
					<Box mbe={16}>
						<Callout type='warning' icon='warning' title={t('Boards_Reports_Revenue_Partial_Title', { defaultValue: 'Revenue is partial' })}>
							{t('Boards_Reports_Revenue_Partial', {
								defaultValue: 'Some matters could not be read from CasePro, so revenue, ROAS and ROI below are incomplete.',
							})}
						</Callout>
					</Box>
				)}

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
					<>
						{/* Headline totals (exclude campaign rows, include the unattributed bucket). */}
						<Box display='flex' flexWrap='wrap' style={{ gap: '12px' }}>
							<Metric label={t('Boards_Leads_Funnel_New', { defaultValue: 'Leads' })} value={report.totals.leads} />
							<Metric
								label={t('Boards_Leads_Funnel_Signed', { defaultValue: 'Signed' })}
								value={report.totals.signed}
								hint={fmtPct(report.totals.conversionPct)}
							/>
							<Metric label={t('Boards_Reports_CostPerLead', { defaultValue: 'Cost / lead' })} value={fmtCurrency(report.totals.costPerLead)} />
							<Metric
								label={t('Boards_Reports_CostPerSigned', { defaultValue: 'Cost / signed' })}
								value={fmtCurrency(report.totals.costPerSigned)}
							/>
							<Metric
								label={t('Boards_Reports_Revenue', { defaultValue: 'Revenue' })}
								value={fmtCurrency(report.totals.revenue)}
								hint={report.revenueResolved ? undefined : t('Boards_Reports_Partial', { defaultValue: 'partial' })}
							/>
							<Metric label={t('Boards_Reports_Spend', { defaultValue: 'Ad spend' })} value={fmtCurrency(report.totals.spend)} />
							<Metric label={t('Boards_Reports_ROAS', { defaultValue: 'ROAS' })} value={fmtRoas(report.totals.roas)} />
							<Metric
								label={t('Boards_Reports_ROI', { defaultValue: 'ROI' })}
								value={
									<Box is='span'>
										{report.totals.roiPct >= 0 ? '+' : ''}
										{fmtPct(report.totals.roiPct)}
									</Box>
								}
							/>
						</Box>

						<SectionTitle>{t('Boards_Reports_BySource', { defaultValue: 'By source' })}</SectionTitle>
						<Box style={{ overflowX: 'auto' }}>
							<Table fixed>
								<TableHead>
									<TableRow>
										<TableCell>{t('Boards_Source', { defaultValue: 'Source' })}</TableCell>
										<TableCell align='end'>{t('Boards_Leads_Funnel_New', { defaultValue: 'Leads' })}</TableCell>
										<TableCell align='end'>{t('Boards_Leads_Funnel_Signed', { defaultValue: 'Signed' })}</TableCell>
										<TableCell align='end'>{t('Boards_Leads_Conversion_Rate', { defaultValue: 'Conv.' })}</TableCell>
										<TableCell align='end'>{t('Boards_Reports_Spend', { defaultValue: 'Spend' })}</TableCell>
										<TableCell align='end'>{t('Boards_Reports_CPL_Short', { defaultValue: 'CPL' })}</TableCell>
										<TableCell align='end'>{t('Boards_Reports_CPS_Short', { defaultValue: 'CPS' })}</TableCell>
										<TableCell align='end'>{t('Boards_Reports_Revenue', { defaultValue: 'Revenue' })}</TableCell>
										<TableCell align='end'>{t('Boards_Reports_ROAS', { defaultValue: 'ROAS' })}</TableCell>
										<TableCell align='end'>{t('Boards_Reports_ROI', { defaultValue: 'ROI' })}</TableCell>
									</TableRow>
								</TableHead>
								<TableBody>
									{sourceRows.flatMap((row) => [
										<SourceRow key={row.sourceId} row={row} />,
										...(campaignsBySource[row.sourceId] ?? []).map((campaign) => (
											<SourceRow key={`${row.sourceId}:${campaign.campaignId}`} row={campaign} indented />
										)),
									])}

									{/* the unattributed bucket: leads with no marketing source (no spend → no ROI). */}
									{report.unattributed.leads > 0 && (
										<TableRow>
											<TableCell>
												<Box fontScale='p2' color='hint'>
													{t('Boards_Reports_Unattributed', { defaultValue: 'Unattributed' })}
												</Box>
											</TableCell>
											<TableCell align='end'>{report.unattributed.leads}</TableCell>
											<TableCell align='end'>{report.unattributed.signed}</TableCell>
											<TableCell align='end'>{fmtPct(report.unattributed.conversionPct)}</TableCell>
											<TableCell align='end'>—</TableCell>
											<TableCell align='end'>—</TableCell>
											<TableCell align='end'>—</TableCell>
											<TableCell align='end'>{fmtCurrency(report.unattributed.revenue)}</TableCell>
											<TableCell align='end'>—</TableCell>
											<TableCell align='end'>—</TableCell>
										</TableRow>
									)}

									{sourceRows.length === 0 && report.unattributed.leads === 0 && (
										<TableRow>
											<TableCell colSpan={10}>
												<Box fontScale='c1' color='hint'>
													{t('No_results_found')}
												</Box>
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</Box>

						{report.totals.signed > 0 && report.totals.revenue === 0 && report.revenueResolved && (
							<Box mbs={16} fontScale='c1' color='hint'>
								<Icon name='info' size='x14' mie={4} />
								{t('Boards_Reports_SignedAwaitingRevenue', {
									defaultValue: 'Signed cases are in the pipeline but have no settlement/demand value yet — revenue will populate as matters resolve.',
								})}
							</Box>
						)}
					</>
				)}
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default SourceToSettlement;
