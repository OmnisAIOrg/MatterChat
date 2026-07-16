import { Box, Throbber } from '@rocket.chat/fuselage';
import type { ReactElement, ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { monoLabel, serifCaption, tabularNums, useLedgerTones } from '../lib/ledgerTheme';
import { useBoardViewCards } from './lib/useBoardViewCards';
import { asTime, isOverdue, type SerializedBoard, type SerializedCard } from './lib/viewModel';

/**
 * DashboardView — at-a-glance metrics for a board (M8 generic view).
 *
 * Reads `GET /v1/boards.views.cards` (viewType=dashboard, honouring the saved
 * view's filters + groupBy) and rolls the returned cards up in JS into headline
 * tiles (total / overdue / due-this-week / completed-due) plus a distribution
 * bar over the server-provided `groups` (e.g. by list/assignee/type). This is the
 * board-scoped counterpart to the cross-pipeline reports — pure read, graceful on
 * empty boards. For matters/leads boards the richer financial/funnel reports live
 * under /boards/matters/reports and /boards/leads/reports.
 *
 * LEDGER-DENSE SKIN (style-only): paper ground, metric paper cards with a rail
 * (green primary; amber/red only when the metric flags risk), serif section
 * head, and hand-drawn green distribution bars on a khaki track (same
 * percentage math as before).
 */

type DashboardViewProps = {
	board: SerializedBoard;
	viewId?: string;
};

const Metric = ({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'warning' | 'default' }): ReactElement => {
	const tones = useLedgerTones();
	// Green primary rail; amber/red only when the metric flags risk.
	const risk = tone === 'danger' ? tones.red : undefined;
	const warn = tone === 'warning' ? tones.amber : undefined;
	const rail = risk ?? warn ?? tones.green;
	return (
		<Box
			pb={10}
			pi={12}
			minWidth={150}
			flexGrow={1}
			flexBasis={150}
			style={{
				background: tones.card,
				border: `1px solid ${tones.stroke}`,
				borderRadius: 6,
				boxShadow: `inset 3px 0 0 0 ${rail}`,
			}}
		>
			<Box mbe={4} style={monoLabel(tones)}>
				{label}
			</Box>
			<Box fontScale='h2' style={{ ...tabularNums, color: risk ?? warn }}>
				{value}
			</Box>
		</Box>
	);
};

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const DashboardView = ({ board, viewId }: DashboardViewProps): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();

	const { data, isLoading } = useBoardViewCards(board._id, 'dashboard', viewId);

	const result = data?.result;
	const cards = (result?.cards ?? []) as SerializedCard[];
	const groups = result?.groups as { key: string; label: string; cards: SerializedCard[] }[] | undefined;

	const stats = useMemo(() => {
		const now = Date.now();
		let overdue = 0;
		let dueThisWeek = 0;
		let completedDue = 0;
		for (const card of cards) {
			const dueMs = asTime(card.dueDate);
			if (dueMs === undefined) {
				continue;
			}
			if (card.dueComplete) {
				completedDue += 1;
				continue;
			}
			if (isOverdue(card.dueDate, card.dueComplete)) {
				overdue += 1;
			} else if (dueMs - now <= ONE_WEEK_MS) {
				dueThisWeek += 1;
			}
		}
		return { total: cards.length, overdue, dueThisWeek, completedDue };
	}, [cards]);

	// Distribution: prefer the server groups; else fall back to a per-list rollup
	// is not available without list metadata, so we just show the type spread.
	const distribution = useMemo(() => {
		if (groups && groups.length > 0) {
			return groups.map((g) => ({ label: g.label, count: g.cards.length }));
		}
		// fallback: group by cardType when the view isn't grouped
		const byType = new Map<string, number>();
		for (const card of cards) {
			byType.set(card.cardType, (byType.get(card.cardType) ?? 0) + 1);
		}
		return [...byType.entries()].map(([label, count]) => ({ label, count }));
	}, [groups, cards]);

	const maxCount = distribution.reduce((m, d) => Math.max(m, d.count), 0) || 1;

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' p={24}>
				<Throbber />
			</Box>
		);
	}

	return (
		<Box pi={24} pb={16} style={{ background: tones.paper, minHeight: '100%' }}>
			<Box display='flex' flexWrap='wrap' mbe={24} style={{ gap: '10px' }}>
				<Metric label={t('Boards_Views_Dash_Total', { defaultValue: 'Total cards' })} value={stats.total} />
				<Metric
					label={t('Boards_Views_Dash_Overdue', { defaultValue: 'Overdue' })}
					value={stats.overdue}
					tone={stats.overdue > 0 ? 'danger' : 'default'}
				/>
				<Metric
					label={t('Boards_Views_Dash_DueThisWeek', { defaultValue: 'Due this week' })}
					value={stats.dueThisWeek}
					tone={stats.dueThisWeek > 0 ? 'warning' : 'default'}
				/>
				<Metric label={t('Boards_Views_Dash_Completed', { defaultValue: 'Completed (dated)' })} value={stats.completedDue} />
			</Box>

			<Box fontScale='h4' color='default' mbe={12} style={serifCaption}>
				{t('Boards_Views_Dash_Distribution', { defaultValue: 'Distribution' })}
			</Box>

			{distribution.length === 0 && (
				<Box fontScale='c1' color='hint'>
					{t('No_results_found')}
				</Box>
			)}

			{distribution.map((d) => (
				<Box key={d.label} mbe={10}>
					<Box display='flex' justifyContent='space-between' mbe={3}>
						<Box fontScale='p2b' color='default' withTruncatedText>
							{d.label}
						</Box>
						<Box fontScale='c1' style={{ ...tabularNums, color: tones.inkMuted }}>
							{d.count}
						</Box>
					</Box>
					{/* Green primary series on a khaki track (same percentage math as the old ProgressBar). */}
					<Box style={{ height: 6, borderRadius: 3, background: tones.strokeSoft, overflow: 'hidden' }}>
						<Box
							style={{ height: '100%', width: `${Math.round((d.count / maxCount) * 100)}%`, background: tones.green, borderRadius: 3 }}
						/>
					</Box>
				</Box>
			))}
		</Box>
	);
};

export default DashboardView;
