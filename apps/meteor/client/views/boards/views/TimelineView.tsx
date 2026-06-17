import { Box, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getCardTypeIcon } from '../lib/icons';
import { useBoardViewCards } from './lib/useBoardViewCards';
import { asTime, cardDateValue, fmtDate, isOverdue, type SerializedBoard, type SerializedCard } from './lib/viewModel';

/**
 * TimelineView — a chronological view of a board's cards plotted on their date
 * field (M8). Reads `GET /v1/boards.views.cards` (viewType=timeline) and uses the
 * server-echoed `dateField` (defaults to dueDate) to order + bucket cards by
 * month. Cards with no date for the field fall into an "Undated" bucket at the
 * end. Overdue, not-yet-complete dates render in danger; today onward in info.
 *
 * Rendered as a vertical timeline rail (lower-risk than a heavy gantt) — a month
 * heading, then each card as a dated node. Clicking a node deep-links the card.
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
	const router = useRouter();

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
			<Box display='flex' justifyContent='center' p={24}>
				<Throbber />
			</Box>
		);
	}

	const dateFieldLabel =
		!dateField || dateField === 'dueDate'
			? t('Boards_Matters_Deadline_Due', { defaultValue: 'Due date' })
			: dateField === 'startDate'
				? t('Boards_Views_StartDate', { defaultValue: 'Start date' })
				: dateField;

	return (
		<Box pi={24} pb={16} style={{ maxWidth: 760 }}>
			<Box fontScale='c1' color='hint' mbe={16}>
				<Icon name='clock' size='x14' mie={4} />
				{t('Boards_Views_Timeline_PlottedBy', { field: dateFieldLabel, defaultValue: 'Plotted by {{field}}' })}
			</Box>

			{months.length === 0 && undated.length === 0 && (
				<Box fontScale='c1' color='hint'>
					{t('No_results_found')}
				</Box>
			)}

			{months.map((month) => (
				<Box key={month.key} mbe={24}>
					<Box fontScale='h5' color='default' mbe={12}>
						{month.label}
					</Box>
					<Box pis={8} style={{ borderInlineStart: '2px solid var(--rcx-color-stroke-extra-light, #e4e7ea)' }}>
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
									mbe={8}
									pb={8}
									pi={12}
									bg='light'
									borderRadius='x4'
									borderWidth='default'
									borderColor='extra-light'
									style={{ cursor: 'pointer', gap: '10px' }}
								>
									<Box style={{ flexShrink: 0, minWidth: 84 }}>
										<Tag variant={overdue ? 'danger' : 'secondary'}>{fmtDate(date)}</Tag>
									</Box>
									<Icon name={getCardTypeIcon(card.cardType)} size='x16' color='hint' />
									<Box fontScale='p2' color='default' withTruncatedText flexGrow={1}>
										{card.title}
									</Box>
									{card.cardNumber ? (
										<Box fontScale='micro' color='hint' style={{ flexShrink: 0 }}>
											#{card.cardNumber}
										</Box>
									) : null}
								</Box>
							);
						})}
					</Box>
				</Box>
			))}

			{undated.length > 0 && (
				<Box mbe={24}>
					<Box fontScale='h5' color='hint' mbe={12}>
						{t('Boards_Views_Timeline_Undated', { defaultValue: 'Undated' })}
					</Box>
					<Box pis={8} style={{ borderInlineStart: '2px solid var(--rcx-color-stroke-extra-light, #e4e7ea)' }}>
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
								mbe={8}
								pb={8}
								pi={12}
								bg='light'
								borderRadius='x4'
								borderWidth='default'
								borderColor='extra-light'
								style={{ cursor: 'pointer', gap: '10px' }}
							>
								<Icon name={getCardTypeIcon(card.cardType)} size='x16' color='hint' />
								<Box fontScale='p2' color='default' withTruncatedText flexGrow={1}>
									{card.title}
								</Box>
							</Box>
						))}
					</Box>
				</Box>
			)}
		</Box>
	);
};

export default TimelineView;
