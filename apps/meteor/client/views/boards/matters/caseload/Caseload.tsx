import { Box, Button, Callout, Icon, Table, TableBody, TableCell, TableHead, TableRow, Throbber } from '@rocket.chat/fuselage';
import type { CaseloadReportDTO, CaseloadRowDTO } from '@rocket.chat/rest-typings';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';
import { heatDot, heatPill, monoLabel, serifCaption, smallTag, tabularNums, useLedgerTones } from '../../lib/ledgerTheme';

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
 * LEDGER-DENSE SKIN (style-only): paper page ground, serif caption, dense
 * ruled table with tabular figures, stages as small khaki tags, and a per-row
 * SOL heat rail. The row DTO carries only the `solAtRisk` COUNT (no solDate),
 * so the rail heat is count-driven: red when any matter on the row is at risk,
 * green when clear.
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

// Ruled-paper table density: tight tabular cells + khaki row rules.
const buildLedgerTableCss = (strokeSoft: string, hoverBg: string): string => `
.mcLedgerCaseload .rcx-table__cell {
	padding-block: 5px;
	padding-inline: 8px;
	font-variant-numeric: tabular-nums;
	border-block-end: 1px solid ${strokeSoft};
	background: transparent;
}
.mcLedgerCaseload tbody tr:hover .rcx-table__cell {
	background: ${hoverBg};
}
`;

// Render the per-stage breakdown as a dense row of small ledger tags.
const StageMix = ({ mix }: { mix: Record<string, number> }): ReactElement => {
	const tones = useLedgerTones();
	const entries = Object.entries(mix).filter(([, count]) => count > 0);
	if (entries.length === 0) {
		return <Box color='hint'>—</Box>;
	}
	return (
		<Box display='flex' flexWrap='wrap' style={{ gap: '4px' }}>
			{entries.map(([stage, count]) => (
				<Box key={stage} is='span' style={smallTag(tones)}>
					{stage}
					<Box is='span' style={{ ...tabularNums, color: tones.inkMuted }}>
						· {count}
					</Box>
				</Box>
			))}
		</Box>
	);
};

const CaseloadRow = ({ row, label }: { row: CaseloadRowDTO; label: ReactNode }): ReactElement => {
	const tones = useLedgerTones();
	// The DTO carries the at-risk COUNT only (no per-matter solDate here): any
	// at-risk matter heats the row red; a clear row reads calm green.
	const heat = row.solAtRisk > 0 ? tones.red : tones.green;
	return (
		<TableRow>
			<TableCell style={{ boxShadow: `inset 3px 0 0 0 ${heat}` }}>{label}</TableCell>
			<TableCell align='end'>{row.openMatters}</TableCell>
			<TableCell>
				<StageMix mix={row.stageMix} />
			</TableCell>
			<TableCell align='end'>
				{row.solAtRisk > 0 ? (
					<Box is='span' style={heatPill(tones.red, tones.redSoft)}>
						<Box is='span' style={heatDot(tones.red)} />
						{row.solAtRisk}
					</Box>
				) : (
					<Box is='span' display='inline-flex' alignItems='center' style={{ gap: 4 }}>
						<Box is='span' style={heatDot(tones.green)} />
						<Box is='span' color='hint' style={tabularNums}>
							0
						</Box>
					</Box>
				)}
			</TableCell>
			<TableCell align='end'>{fmtDays(row.avgDaysInStage)}</TableCell>
		</TableRow>
	);
};

const Caseload = (): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const getCaseload = useEndpoint('GET', '/v1/boards.matters.caseload');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'matters', 'caseload'],
		queryFn: () => getCaseload({}),
	});

	const report = data?.report as CaseloadReportDTO | undefined;

	return (
		<Page style={{ background: tones.paper }}>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='team' size='x24' mie={8} style={{ color: tones.green }} />
						<Box withTruncatedText style={serifCaption}>
							{t('Boards_Matters_Caseload', { defaultValue: 'Caseload' })}
						</Box>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				{/* Static, theme-derived constant string — the dense ruled-table skin. */}
				<style dangerouslySetInnerHTML={{ __html: buildLedgerTableCss(tones.strokeSoft, tones.cardAlt) }} />
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
						<Box display='flex' flexWrap='wrap' alignItems='center' mbe={12} style={{ gap: '10px' }}>
							<Box is='span' style={monoLabel(tones)}>
								{t('Boards_Matters_Open_Matters', { defaultValue: 'Open matters' })}
							</Box>
							<Box is='span' fontScale='p2b' style={{ ...tabularNums, color: tones.link }}>
								{report.totalOpen}
							</Box>
							{report.unassigned > 0 && (
								<Box is='span' style={heatPill(tones.amber, tones.amberSoft)}>
									{t('Boards_Matters_Unassigned', { defaultValue: 'Unassigned' })}: {report.unassigned}
								</Box>
							)}
						</Box>

						<Box className='mcLedgerCaseload' style={{ background: tones.card, border: `1px solid ${tones.stroke}`, borderRadius: 6 }}>
							<Table fixed>
								<TableHead>
									<TableRow>
										<TableCell>
											<Box is='span' style={monoLabel(tones)}>
												{t('Boards_Matters_Assignee', { defaultValue: 'Assignee' })}
											</Box>
										</TableCell>
										<TableCell align='end'>
											<Box is='span' style={monoLabel(tones)}>
												{t('Boards_Matters_Open_Matters', { defaultValue: 'Open matters' })}
											</Box>
										</TableCell>
										<TableCell>
											<Box is='span' style={monoLabel(tones)}>
												{t('Boards_Matters_Stage_Mix', { defaultValue: 'Stage mix' })}
											</Box>
										</TableCell>
										<TableCell align='end'>
											<Box is='span' style={monoLabel(tones)}>
												{t('Boards_Matters_SOL_At_Risk', { defaultValue: 'SOL at risk' })}
											</Box>
										</TableCell>
										<TableCell align='end'>
											<Box is='span' style={monoLabel(tones)}>
												{t('Boards_Matters_Days_In_Stage', { defaultValue: 'Days in stage' })}
											</Box>
										</TableCell>
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
					</Box>
				)}
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default Caseload;
