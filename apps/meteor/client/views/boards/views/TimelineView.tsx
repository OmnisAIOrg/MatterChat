import { Box, Button, ButtonGroup, Icon, Throbber } from '@rocket.chat/fuselage';
import { useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getCardTypeIcon } from '../lib/icons';
import { LEDGER_MONO, heatPill, monoLabel, serifCaption, smallTag, tabularNums, useLedgerTones } from '../lib/ledgerTheme';
import GanttChart from './gantt/GanttChart';
import { useBoardViewCards } from './lib/useBoardViewCards';
import { asTime, cardDateValue, fmtDate, isOverdue, type SerializedBoard, type SerializedCard } from './lib/viewModel';

/**
 * TimelineView — a chronological view of a board's cards. Reads
 * `GET /v1/boards.views.cards` (viewType=timeline) once and offers two modes:
 *
 *  • Gantt (default) — a true Gantt chart (see ./gantt/GanttChart): bars spanning
 *    startDate→dueDate, milestone diamonds, dependency arrows, and drag-to-
 *    reschedule. Hand-built, no third-party Gantt lib.
 *  • List — the lighter vertical rail: cards bucketed by month on the server-
 *    echoed `dateField` (defaults to dueDate), with an "Undated" bucket at the
 *    end; overdue, not-yet-complete dates render in danger.
 *
 * Clicking a card (node or bar) deep-links it. The mode toggle is local state.
 *
 * LEDGER-DENSE SKIN (style-only): paper ground, serif month heads, a khaki
 * timeline rail, dense card rows on paper cards, red heat only when overdue.
 */

type TimelineViewProps = {
	board: SerializedBoard;
	viewId?: string;
};

type DatedCard = { card: SerializedCard; ms?: number; date?: string | Date };

const monthKey = (ms: number): string => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const TimelineView = ({ board, viewId }: TimelineViewProps): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const router = useRouter();
	const [mode, setMode] = useState<'gantt' | 'list'>('gantt');

	const { data, isLoading } = useBoardViewCards(board._id, 'timeline', viewId);

	const result = data?.result;
	const dateField = result?.dateField;
	const cards = (result?.cards ?? []) as SerializedCard[];

	// Bucket by month of the date field; chronological. Undated last.
	const { months, undated } = useMemo(() => {
		const dated: DatedCard[] = cards.map((card) => {
			const date = cardDateValue(card, dateField);
			return { card, ms: asTime(date), date };
		});
		const withDate = dated.filter((d): d is Required<DatedCard> => d.ms !== undefined).sort((a, b) => a.ms - b.ms);
		const none = dated.filter((d) => d.ms === undefined).map((d) => d.card);

		const grouped: { key: string; label: string; items: Required<DatedCard>[] }[] = [];
		for (const item of withDate) {
			const key = monthKey(item.ms);
			let bucket = grouped.find((g) => g.key === key);
			if (!bucket) {
				bucket = { key, label: monthLabel(item.ms), items: [] };
				grouped.push(bucket);
			}
			bucket.items.push(item);
		}
		return { months: grouped, undated: none };
	}, [cards, dateField]);

	const openCard = (cardId: string): void => {
		router.navigate({ name: 'boards-board', params: { id: board._id, view: 'timeline', cardId } });
	};

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' padding={24}>
				<Throbber />
			</Box>
		);
	}

	let dateFieldLabel = dateField ?? '';
	if (!dateField || dateField === 'dueDate') {
		dateFieldLabel = t('Boards_Matters_Deadline_Due', { defaultValue: 'Due date' });
	} else if (dateField === 'startDate') {
		dateFieldLabel = t('Boards_Views_StartDate', { defaultValue: 'Start date' });
	}

	if (mode === 'gantt') {
		return (
			<Box display='flex' flexDirection='column' style={{ minWidth: 0, background: tones.paper, minHeight: '100%' }}>
				<Box display='flex' alignItems='center' justifyContent='space-between' paddingInline={24} style={{ gap: '12px', paddingBottom: 0 }}>
					<Box style={monoLabel(tones)}>{t('Boards_Gantt_PlottedBy', { defaultValue: 'Plotted by start → due date' })}</Box>
					<ButtonGroup small>
						<Button small primary onClick={() => setMode('gantt')}>
							{t('Boards_Gantt_Mode_Gantt', { defaultValue: 'Gantt' })}
						</Button>
						<Button small onClick={() => setMode('list')}>
							{t('Boards_Gantt_Mode_List', { defaultValue: 'List' })}
						</Button>
					</ButtonGroup>
				</Box>
				<GanttChart board={board} cards={cards} onOpenCard={openCard} />
			</Box>
		);
	}

	return (
		<Box paddingInline={24} paddingBlock={16} style={{ background: tones.paper, minHeight: '100%' }}>
			<Box display='flex' alignItems='center' justifyContent='space-between' marginBlockEnd={16} style={{ gap: '12px', maxWidth: 760 }}>
				<Box style={monoLabel(tones)}>
					<Icon name='clock' size='x14' marginInlineEnd={4} />
					{t('Boards_Views_Timeline_PlottedBy', { field: dateFieldLabel, defaultValue: 'Plotted by {{field}}' })}
				</Box>
				<ButtonGroup small>
					<Button small onClick={() => setMode('gantt')}>
						{t('Boards_Gantt_Mode_Gantt', { defaultValue: 'Gantt' })}
					</Button>
					<Button small primary onClick={() => setMode('list')}>
						{t('Boards_Gantt_Mode_List', { defaultValue: 'List' })}
					</Button>
				</ButtonGroup>
			</Box>

			<Box style={{ maxWidth: 760 }}>
				{months.length === 0 && undated.length === 0 && (
					<Box fontScale='c1' color='hint'>
						{t('No_results_found')}
					</Box>
				)}

				{months.map((month) => (
					<Box key={month.key} marginBlockEnd={20}>
						<Box fontScale='h5' color='default' marginBlockEnd={8} style={serifCaption}>
							{month.label}
						</Box>
						<Box paddingInlineStart={8} style={{ borderInlineStart: `2px solid ${tones.stroke}` }}>
							{month.items.map(({ card, date }) => {
								const overdue = isOverdue(date, card.dueComplete);
								return (
									<Box
										key={card._id}
										role='button'
										tabIndex={0}
										onClick={() => openCard(card._id)}
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												openCard(card._id);
											}
										}}
										display='flex'
										alignItems='center'
										marginBlockEnd={6}
										paddingBlock={6}
										paddingInline={10}
										style={{
											cursor: 'pointer',
											gap: '10px',
											background: tones.card,
											border: `1px solid ${tones.strokeSoft}`,
											borderRadius: 4,
										}}
									>
										<Box style={{ flexShrink: 0, minWidth: 84 }}>
											{overdue ? (
												<Box is='span' style={heatPill(tones.red, tones.redSoft)}>
													{fmtDate(date)}
												</Box>
											) : (
												<Box is='span' style={{ ...smallTag(tones), ...tabularNums }}>
													{fmtDate(date)}
												</Box>
											)}
										</Box>
										<Icon name={getCardTypeIcon(card.cardType)} size='x16' style={{ color: tones.inkMuted }} />
										<Box fontScale='p2' color='default' withTruncatedText flexGrow={1}>
											{card.title}
										</Box>
										{card.cardNumber ? (
											<Box style={{ flexShrink: 0, fontFamily: LEDGER_MONO, fontSize: 10, color: tones.inkMuted }}>#{card.cardNumber}</Box>
										) : null}
									</Box>
								);
							})}
						</Box>
					</Box>
				))}

				{undated.length > 0 && (
					<Box marginBlockEnd={20}>
						<Box fontScale='h5' marginBlockEnd={8} style={{ ...serifCaption, color: tones.inkMuted }}>
							{t('Boards_Views_Timeline_Undated', { defaultValue: 'Undated' })}
						</Box>
						<Box paddingInlineStart={8} style={{ borderInlineStart: `2px solid ${tones.strokeSoft}` }}>
							{undated.map((card) => (
								<Box
									key={card._id}
									role='button'
									tabIndex={0}
									onClick={() => openCard(card._id)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											openCard(card._id);
										}
									}}
									display='flex'
									alignItems='center'
									marginBlockEnd={6}
									paddingBlock={6}
									paddingInline={10}
									style={{
										cursor: 'pointer',
										gap: '10px',
										background: tones.card,
										border: `1px solid ${tones.strokeSoft}`,
										borderRadius: 4,
									}}
								>
									<Icon name={getCardTypeIcon(card.cardType)} size='x16' style={{ color: tones.inkMuted }} />
									<Box fontScale='p2' color='default' withTruncatedText flexGrow={1}>
										{card.title}
									</Box>
								</Box>
							))}
						</Box>
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default TimelineView;
