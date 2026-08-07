import {
	Box,
	Button,
	Callout,
	Icon,
	ProgressBar,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Tag,
	Throbber,
} from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';
import LedgerPageStyleTag from '../../lib/LedgerPageStyleTag';
import { monoLabel, serifCaption, tabularNums, useLedgerTones } from '../../lib/ledgerTheme';

/**
 * LeadsReports — the `/boards/leads/reports` dashboards (M6 client).
 *
 * Two stacked panels over the intake board (intake-lead-management.md §12):
 *  - Intake funnel (`GET /v1/boards.leads.reports.funnel`): the New -> Contacted
 *    -> Qualified -> Signed gate counts with stage-over-stage conversion %, the
 *    overall conversion rate, and average hours-to-first-contact / hours-to-signed.
 *  - Intake scoreboard (`GET /v1/boards.leads.reports.scoreboard`): per-owner
 *    handled / contacted / signed, conversion %, avg first-contact minutes, and
 *    SLA-adherence %. The unassigned bucket is surfaced as a tag.
 *
 * All numbers are computed server-side via query-then-sum, so this is a pure
 * read. Owner ids render raw (name resolution intentionally not wired here;
 * degrade gracefully).
 *
 * Wiring: register at route name `boards-leads-reports`
 * (path `/boards/leads/reports`) gated by `boards-leads-reports-view`.
 * See return summary.
 */

const fmtPct = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return `${value}%`;
};

const fmtHours = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	if (value < 1) {
		return `${Math.round(value * 60)}m`;
	}
	return `${value.toFixed(1)}h`;
};

const fmtMinutes = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return `${Math.round(value)}m`;
};

// Ledger stat tile: paper card face, mono "docket stamp" label, tabular figure.
const Metric = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }): ReactElement => {
	const tones = useLedgerTones();
	return (
		<Box
			paddingBlock={10}
			paddingInline={12}
			minWidth={160}
			flexGrow={1}
			flexBasis={160}
			style={{ background: tones.card, border: `1px solid ${tones.strokeSoft}`, borderRadius: 6 }}
		>
			<Box marginBlockEnd={4} style={monoLabel(tones)}>
				{label}
			</Box>
			<Box fontScale='h3' color='default' style={tabularNums}>
				{value}
			</Box>
			{hint !== undefined && hint !== null && hint !== '' && (
				<Box fontScale='micro' color='hint' marginBlockStart={4}>
					{hint}
				</Box>
			)}
		</Box>
	);
};

// Serif "case caption" section heads — ledger parity with the redesigned siblings.
const SectionTitle = ({ children }: { children: ReactNode }): ReactElement => (
	<Box fontScale='h4' color='default' marginBlockStart={20} marginBlockEnd={10} style={serifCaption}>
		{children}
	</Box>
);

// localized gate label; falls back to the raw server gate key
const gateLabel = (gate: string, t: ReturnType<typeof useTranslation>['t']): string => {
	const key = `Boards_Leads_Funnel_${gate.charAt(0).toUpperCase()}${gate.slice(1)}`;
	return t(key as Parameters<typeof t>[0], { defaultValue: gate });
};

const FunnelPanel = (): ReactElement => {
	const { t } = useTranslation();
	const getFunnel = useEndpoint('GET', '/v1/boards.leads.reports.funnel');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'leads', 'reports', 'funnel'],
		queryFn: () => getFunnel({}),
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

	const maxCount = data.gates.reduce((m, g) => Math.max(m, g.count), 0) || 1;

	return (
		<Box>
			<Box display='flex' flexWrap='wrap' marginBlockEnd={16} style={{ gap: '12px' }}>
				<Metric label={t('Boards_Leads_Funnel_New', { defaultValue: 'New' })} value={data.totalLeads} />
				<Metric label={t('Boards_Leads_Conversion_Rate', { defaultValue: 'Conversion rate' })} value={fmtPct(data.overallConversionPct)} />
				<Metric
					label={t('Boards_Leads_Task_Speed_To_Lead', { defaultValue: 'First contact (SLA)' })}
					value={fmtHours(data.avgHoursToContact)}
				/>
				<Metric
					label={t('Boards_Leads_Funnel_Signed', { defaultValue: 'Signed' })}
					value={fmtHours(data.avgHoursToSigned)}
					hint={t('Boards_Leads_Time_To_Signed', { defaultValue: 'avg time to signed' })}
				/>
			</Box>

			<Box marginBlockEnd={20}>
				{data.gates.map((gate) => (
					<Box key={gate.gate} marginBlockEnd={12}>
						<Box display='flex' justifyContent='space-between' marginBlockEnd={4}>
							<Box fontScale='p2b' color='default'>
								{gateLabel(gate.gate, t)}
							</Box>
							<Box fontScale='c1' color='hint'>
								{gate.count}
								{gate.conversionPct > 0 ? ` · ${fmtPct(gate.conversionPct)}` : ''}
							</Box>
						</Box>
						<ProgressBar percentage={Math.round((gate.count / maxCount) * 100)} />
					</Box>
				))}
				{data.gates.length === 0 && (
					<Box fontScale='c1' color='hint'>
						{t('No_results_found')}
					</Box>
				)}
			</Box>

			{data.avgTimeInStageHours.length > 0 && (
				<Box>
					<Box fontScale='p2b' color='default' marginBlockEnd={8}>
						{t('Boards_Matters_Days_In_Stage', { defaultValue: 'Time in stage' })}
					</Box>
					<Table fixed>
						<TableHead>
							<TableRow>
								<TableCell>{t('Boards_Matters_Stage', { defaultValue: 'Stage' })}</TableCell>
								<TableCell align='end'>{t('Boards_Leads_Funnel_New', { defaultValue: 'Leads' })}</TableCell>
								<TableCell align='end'>{t('Boards_Matters_Days_In_Stage', { defaultValue: 'Time in stage' })}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{data.avgTimeInStageHours.map((s) => (
								<TableRow key={s.stage}>
									<TableCell>{s.stage}</TableCell>
									<TableCell align='end'>{s.count}</TableCell>
									<TableCell align='end'>{fmtHours(s.avgHours)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Box>
			)}
		</Box>
	);
};

const ScoreboardPanel = (): ReactElement => {
	const { t } = useTranslation();
	const getScoreboard = useEndpoint('GET', '/v1/boards.leads.reports.scoreboard');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'leads', 'reports', 'scoreboard'],
		queryFn: () => getScoreboard({}),
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

	return (
		<Box>
			{data.unassigned > 0 && (
				<Box marginBlockEnd={12}>
					<Tag variant='secondary-warning'>
						{t('Boards_Matters_Unassigned', { defaultValue: 'Unassigned' })}: {data.unassigned}
					</Tag>
				</Box>
			)}
			<Table fixed>
				<TableHead>
					<TableRow>
						<TableCell>{t('Owner')}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_Funnel_New', { defaultValue: 'Handled' })}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_Funnel_Contacted', { defaultValue: 'Contacted' })}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_Funnel_Signed', { defaultValue: 'Signed' })}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_Conversion_Rate', { defaultValue: 'Conversion rate' })}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_Task_Speed_To_Lead', { defaultValue: 'First contact (SLA)' })}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_SLA_Adherence', { defaultValue: 'SLA adherence' })}</TableCell>
					</TableRow>
				</TableHead>
				<TableBody>
					{data.rows.map((row) => (
						<TableRow key={row.ownerId}>
							<TableCell>
								<Box withTruncatedText>{row.ownerId}</Box>
							</TableCell>
							<TableCell align='end'>{row.handled}</TableCell>
							<TableCell align='end'>{row.contacted}</TableCell>
							<TableCell align='end'>{row.signed}</TableCell>
							<TableCell align='end'>{fmtPct(row.conversionPct)}</TableCell>
							<TableCell align='end'>{fmtMinutes(row.avgFirstContactMinutes)}</TableCell>
							<TableCell align='end'>
								<Tag variant={row.slaAdherencePct >= 80 ? 'primary' : 'secondary-danger'}>{fmtPct(row.slaAdherencePct)}</Tag>
							</TableCell>
						</TableRow>
					))}
					{data.rows.length === 0 && (
						<TableRow>
							<TableCell colSpan={7}>
								<Box fontScale='c1' color='hint'>
									{t('No_results_found')}
								</Box>
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</Box>
	);
};

const LeadsReports = (): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();

	return (
		// Ledger-dense skin (style-only): paper page ground + serif caption title.
		<Page className='mcLedgerPage' style={{ background: tones.paper }}>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='dashboard' size='x24' marginInlineEnd={8} style={{ color: tones.green }} />
						<Box withTruncatedText style={serifCaption}>
							{t('Boards_Leads_Report_Funnel', { defaultValue: 'Intake reports' })}
						</Box>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				{/* Static, theme-derived constant string — the shared ledger table/card skin. */}
				<LedgerPageStyleTag />
				<CaseProStubBanner marginBlockEnd={16} />

				<SectionTitle>{t('Boards_Leads_Report_Funnel', { defaultValue: 'Intake funnel' })}</SectionTitle>
				<FunnelPanel />

				<SectionTitle>{t('Boards_Leads_Report_Scoreboard', { defaultValue: 'Intake scoreboard' })}</SectionTitle>
				<ScoreboardPanel />
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default LeadsReports;
