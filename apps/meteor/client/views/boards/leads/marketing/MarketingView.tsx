import type { IReferralSource } from '@rocket.chat/core-typings';
import {
	Box,
	Button,
	Callout,
	Field,
	FieldLabel,
	FieldRow,
	Icon,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Tag,
	TextInput,
	Throbber,
} from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';
import LedgerPageStyleTag from '../../lib/LedgerPageStyleTag';
import { monoLabel, serifCaption, tabularNums, useLedgerTones } from '../../lib/ledgerTheme';

/**
 * MarketingView — the `/boards/leads/marketing` ROI dashboard (M6 client).
 *
 * Reads `GET /v1/boards.leads.marketing.sourceRoi` (optionally windowed by lead
 * capture date) and renders the per-source / per-campaign attribution table:
 * leads, signed, conversion %, spend, cost-per-lead, cost-per-signed, revenue,
 * and ROAS (intake-lead-management.md §9, differentiators.md §7). Campaign rows
 * are nested under their parent source (indented). A headline totals strip sits
 * on top. All math is computed server-side via query-then-sum (never CasePro
 * aggregate GROUP BY).
 *
 * When the server reports `revenueResolved:false`, CasePro was unreachable and
 * revenue / ROAS are partial — we surface a "CRM unavailable" warning so the
 * numbers are not read as final.
 *
 * Sources rows arrive over the wire as `unknown[]`; we narrow to a local
 * `SourceRoiRow` shape mirroring the server.
 *
 * Wiring: register at route name `boards-leads-marketing`
 * (path `/boards/leads/marketing`) gated by `boards-leads-marketing-manage`.
 * See return summary.
 */

// Mirrors the server marketing.ts SourceRoiRow (REST type is `unknown[]`).
type SourceRoiRow = {
	sourceId: string;
	sourceName: string;
	kind?: IReferralSource['kind'];
	channel?: IReferralSource['channel'];
	campaignId?: string;
	campaignName?: string;
	leads: number;
	signed: number;
	conversionPct: number;
	spend: number;
	costPerLead: number;
	costPerSigned: number;
	revenue: number;
	roas: number;
	revenueResolved: boolean;
};

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
	return `${value}%`;
};

const fmtRoas = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return `${value.toFixed(2)}×`;
};

// Ledger stat tile: paper card face, mono "docket stamp" label, tabular figure.
const Metric = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }): ReactElement => {
	const tones = useLedgerTones();
	return (
		<Box
			paddingBlock={10}
			paddingInline={12}
			minWidth={140}
			flexGrow={1}
			flexBasis={140}
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

const RoiRow = ({ row, isCampaign }: { row: SourceRoiRow; isCampaign: boolean }): ReactElement => {
	const { t } = useTranslation();
	return (
		<TableRow>
			<TableCell>
				<Box display='flex' alignItems='center' paddingInlineStart={isCampaign ? 20 : 0}>
					{isCampaign && <Icon name='kebab' size='x12' marginInlineEnd={4} color='hint' />}
					<Box withTruncatedText color={isCampaign ? 'hint' : 'default'} marginInlineEnd={6}>
						{isCampaign ? row.campaignName : row.sourceName}
					</Box>
					{!isCampaign && row.kind && (
						<Tag variant='secondary'>
							{t(`Boards_Leads_Source_Kind_${row.kind}` as Parameters<typeof t>[0], { defaultValue: row.kind })}
						</Tag>
					)}
				</Box>
			</TableCell>
			<TableCell align='end'>{row.leads}</TableCell>
			<TableCell align='end'>{row.signed}</TableCell>
			<TableCell align='end'>{fmtPct(row.conversionPct)}</TableCell>
			<TableCell align='end'>{fmtCurrency(row.spend)}</TableCell>
			<TableCell align='end'>{fmtCurrency(row.costPerLead)}</TableCell>
			<TableCell align='end'>{fmtCurrency(row.costPerSigned)}</TableCell>
			<TableCell align='end'>{fmtCurrency(row.revenue)}</TableCell>
			<TableCell align='end'>
				<Tag variant={row.roas >= 1 ? 'primary' : 'secondary'}>{fmtRoas(row.roas)}</Tag>
			</TableCell>
		</TableRow>
	);
};

const MarketingView = (): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const getRoi = useEndpoint('GET', '/v1/boards.leads.marketing.sourceRoi');

	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'leads', 'marketing', 'sourceRoi', from, to],
		queryFn: () => getRoi({ ...(from ? { from } : {}), ...(to ? { to } : {}) }),
	});

	const rows = (data?.rows as SourceRoiRow[] | undefined) ?? [];
	const totals = data?.totals;
	const revenueResolved = data?.revenueResolved ?? true;

	// group: source row, then its campaign rows directly after it
	const sourceRows = rows.filter((r) => !r.campaignId);
	const campaignsBySource = rows.reduce<Record<string, SourceRoiRow[]>>((acc, r) => {
		if (r.campaignId) {
			(acc[r.sourceId] ??= []).push(r);
		}
		return acc;
	}, {});

	return (
		// Ledger-dense skin (style-only): paper page ground + serif caption title.
		<Page className='mcLedgerPage' style={{ background: tones.paper }}>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='dashboard' size='x24' marginInlineEnd={8} style={{ color: tones.green }} />
						<Box withTruncatedText style={serifCaption}>
							{t('Boards_Leads_Marketing_ROI', { defaultValue: 'Marketing ROI' })}
						</Box>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				{/* Static, theme-derived constant string — the shared ledger table/card skin. */}
				<LedgerPageStyleTag />
				<CaseProStubBanner marginBlockEnd={16} />

				{!revenueResolved && (
					<Box marginBlockEnd={16}>
						<Callout
							type='warning'
							icon='warning'
							title={t('Boards_Leads_Marketing_CrmUnavailable_Title', { defaultValue: 'CRM unavailable' })}
						>
							{t('Boards_Leads_Marketing_CrmUnavailable_Description', {
								defaultValue: 'CasePro could not be reached, so revenue and ROAS are partial.',
							})}
						</Callout>
					</Box>
				)}

				<Box display='flex' alignItems='flex-end' marginBlockEnd={16} marginInline='neg-x4'>
					<Field marginInline={4} maxWidth={180}>
						<FieldLabel>{t('From', { defaultValue: 'From' })}</FieldLabel>
						<FieldRow>
							<TextInput value={from} onChange={(e) => setFrom((e.target as HTMLInputElement).value)} placeholder='YYYY-MM-DD' />
						</FieldRow>
					</Field>
					<Field marginInline={4} maxWidth={180}>
						<FieldLabel>{t('To', { defaultValue: 'To' })}</FieldLabel>
						<FieldRow>
							<TextInput value={to} onChange={(e) => setTo((e.target as HTMLInputElement).value)} placeholder='YYYY-MM-DD' />
						</FieldRow>
					</Field>
					<Box marginInline={4} marginBlockEnd={4}>
						<Button small onClick={() => refetch()}>
							{t('Apply', { defaultValue: 'Apply' })}
						</Button>
					</Box>
				</Box>

				{totals && (
					<Box display='flex' flexWrap='wrap' marginBlockEnd={16} style={{ gap: '12px' }}>
						<Metric label={t('Boards_Leads_Funnel_New', { defaultValue: 'Leads' })} value={totals.leads} />
						<Metric label={t('Boards_Leads_Funnel_Signed', { defaultValue: 'Signed' })} value={totals.signed} />
						<Metric label={t('Boards_Leads_Conversion_Rate', { defaultValue: 'Conversion rate' })} value={fmtPct(totals.conversionPct)} />
						<Metric label={t('Spend', { defaultValue: 'Spend' })} value={fmtCurrency(totals.spend)} />
						<Metric label={t('Revenue', { defaultValue: 'Revenue' })} value={fmtCurrency(totals.revenue)} />
						<Metric label={t('Boards_Leads_ROAS', { defaultValue: 'ROAS' })} value={fmtRoas(totals.roas)} />
					</Box>
				)}

				{isLoading && (
					<Box display='flex' justifyContent='center' padding={24}>
						<Throbber />
					</Box>
				)}

				{isError && !isLoading && (
					<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
						<Button small marginBlockStart={8} onClick={() => refetch()}>
							{t('Reload_page')}
						</Button>
					</Callout>
				)}

				{!isLoading && !isError && (
					<Table fixed>
						<TableHead>
							<TableRow>
								<TableCell>{t('Boards_Source', { defaultValue: 'Source' })}</TableCell>
								<TableCell align='end'>{t('Boards_Leads_Funnel_New', { defaultValue: 'Leads' })}</TableCell>
								<TableCell align='end'>{t('Boards_Leads_Funnel_Signed', { defaultValue: 'Signed' })}</TableCell>
								<TableCell align='end'>{t('Boards_Leads_Conversion_Rate', { defaultValue: 'Conversion rate' })}</TableCell>
								<TableCell align='end'>{t('Spend', { defaultValue: 'Spend' })}</TableCell>
								<TableCell align='end'>{t('Boards_Leads_Cost_Per_Lead', { defaultValue: 'Cost per lead' })}</TableCell>
								<TableCell align='end'>{t('Boards_Leads_Cost_Per_Signed', { defaultValue: 'Cost per signed case' })}</TableCell>
								<TableCell align='end'>{t('Revenue', { defaultValue: 'Revenue' })}</TableCell>
								<TableCell align='end'>{t('Boards_Leads_ROAS', { defaultValue: 'ROAS' })}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{sourceRows.flatMap((source) => [
								<RoiRow key={source.sourceId} row={source} isCampaign={false} />,
								...(campaignsBySource[source.sourceId] ?? []).map((c) => (
									<RoiRow key={`${source.sourceId}:${c.campaignId}`} row={c} isCampaign={true} />
								)),
							])}
							{sourceRows.length === 0 && (
								<TableRow>
									<TableCell colSpan={9}>
										<Box fontScale='c1' color='hint'>
											{t('No_results_found')}
										</Box>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				)}
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default MarketingView;
