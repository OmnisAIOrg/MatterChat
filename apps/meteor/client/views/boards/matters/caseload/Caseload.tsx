import {
	Box,
	Button,
	Callout,
	Chip,
	Icon,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Tag,
	Throbber,
} from '@rocket.chat/fuselage';
import type { CaseloadReportDTO, CaseloadRowDTO } from '@rocket.chat/rest-typings';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';

/**
 * Caseload — the `/boards/matters/caseload` view (M5 client).
 *
 * A Fuselage table grouped by assignee, read from
 * `GET /v1/boards.matters.caseload`. Each row = one attorney/case-manager:
 * open-matter count, the stage mix (stageName -> count chips), the SOL-at-risk
 * count (red when > 0), and the average days-in-stage. The server bucket for
 * matters with no assignee is rendered as a dedicated "Unassigned" row.
 *
 * All numbers are computed server-side over the cached matter snapshot
 * (query-then-sum, never CasePro aggregate_data), so this is a pure read.
 * Assignee ids are rendered raw — name resolution is intentionally not wired
 * here (degrade gracefully; the integrator can layer avatar/name later).
 *
 * Wiring: register at route name `boards-matters-caseload`
 * (path `/boards/matters/caseload`) gated by `boards-matters-view`.
 * See return summary.
 */

const fmtDays = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return `${Math.round(value)}d`;
};

// Render the per-stage breakdown as a row of small count chips.
const StageMix = ({ mix }: { mix: Record<string, number> }): ReactElement => {
	const entries = Object.entries(mix).filter(([, count]) => count > 0);
	if (entries.length === 0) {
		return <Box color='hint'>—</Box>;
	}
	return (
		<Box display='flex' flexWrap='wrap' style={{ gap: '4px' }}>
			{entries.map(([stage, count]) => (
				<Chip key={stage}>
					{stage}
					<Box is='span' fontScale='micro' color='hint'>
						{' '}
						· {count}
					</Box>
				</Chip>
			))}
		</Box>
	);
};

const CaseloadRow = ({ row, label }: { row: CaseloadRowDTO; label: ReactNode }): ReactElement => (
	<TableRow>
		<TableCell>{label}</TableCell>
		<TableCell align='end'>{row.openMatters}</TableCell>
		<TableCell>
			<StageMix mix={row.stageMix} />
		</TableCell>
		<TableCell align='end'>
			{row.solAtRisk > 0 ? (
				<Tag variant='secondary-danger'>
					<Icon name='clock' size='x12' mie={4} />
					{row.solAtRisk}
				</Tag>
			) : (
				<Box color='hint'>0</Box>
			)}
		</TableCell>
		<TableCell align='end'>{fmtDays(row.avgDaysInStage)}</TableCell>
	</TableRow>
);

const Caseload = (): ReactElement => {
	const { t } = useTranslation();
	const getCaseload = useEndpoint('GET', '/v1/boards.matters.caseload');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'matters', 'caseload'],
		queryFn: () => getCaseload({}),
	});

	const report = data?.report as CaseloadReportDTO | undefined;

	return (
		<Page>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='team' size='x24' mie={8} color='hint' />
						<Box withTruncatedText>{t('Boards_Matters_Caseload', { defaultValue: 'Caseload' })}</Box>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
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
					<Box>
						<Box display='flex' flexWrap='wrap' mbe={16} style={{ gap: '8px' }}>
							<Tag variant='secondary'>
								{t('Boards_Matters_Open_Matters', { defaultValue: 'Open matters' })}: {report.totalOpen}
							</Tag>
							{report.unassigned > 0 && (
								<Tag variant='secondary-warning'>
									{t('Boards_Matters_Unassigned', { defaultValue: 'Unassigned' })}: {report.unassigned}
								</Tag>
							)}
						</Box>

						<Table fixed>
							<TableHead>
								<TableRow>
									<TableCell>{t('Boards_Matters_Assignee', { defaultValue: 'Assignee' })}</TableCell>
									<TableCell align='end'>{t('Boards_Matters_Open_Matters', { defaultValue: 'Open matters' })}</TableCell>
									<TableCell>{t('Boards_Matters_Stage_Mix', { defaultValue: 'Stage mix' })}</TableCell>
									<TableCell align='end'>{t('Boards_Matters_SOL_At_Risk', { defaultValue: 'SOL at risk' })}</TableCell>
									<TableCell align='end'>{t('Boards_Matters_Days_In_Stage', { defaultValue: 'Days in stage' })}</TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{report.rows.map((row) => (
									<CaseloadRow key={row.assigneeId} row={row} label={row.assigneeId} />
								))}
								{report.unassigned > 0 && (
									<CaseloadRow
										key='__unassigned'
										row={{ assigneeId: '__unassigned', openMatters: report.unassigned, stageMix: {}, solAtRisk: 0, avgDaysInStage: 0 }}
										label={
											<Box is='span' color='hint'>
												{t('Boards_Matters_Unassigned', { defaultValue: 'Unassigned' })}
											</Box>
										}
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
				)}
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default Caseload;
