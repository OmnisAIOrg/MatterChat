import { Box, Icon, Table, TableBody, TableCell, TableHead, TableRow, Tag, Throbber } from '@rocket.chat/fuselage';
import { useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getCardTypeIcon } from '../lib/icons';
import { useBoardViewCards } from './lib/useBoardViewCards';
import {
	fieldNameById,
	fieldValueToString,
	fmtShortDate,
	isOverdue,
	labelDefById,
	type SerializedBoard,
	type SerializedCard,
} from './lib/viewModel';

/**
 * TableView — the generic "spreadsheet" view of a board's cards (M8).
 *
 * Reads `GET /v1/boards.views.cards` (which runs the active saved view's filters
 * / sort / groupBy server-side, or an empty config for an ad-hoc table). Renders
 * either a flat table or, when the view groups by list/assignee/label/field, a
 * sectioned table with a header row per group. Extra columns come from the saved
 * view's `visibleFields` (resolved to board field-def names). Clicking a row deep
 * links the card drawer. Pure read — no mutations here.
 */

type TableViewProps = {
	board: SerializedBoard;
	viewId?: string;
};

const LabelChips = ({ board, labels }: { board: SerializedBoard; labels: string[] }): ReactElement | null => {
	if (!labels?.length) {
		return null;
	}
	return (
		<Box display='flex' flexWrap='wrap' style={{ gap: '4px' }}>
			{labels.slice(0, 4).map((labelId) => {
				const def = labelDefById(board, labelId);
				return (
					<Tag key={labelId} variant='secondary'>
						{def?.name ?? labelId}
					</Tag>
				);
			})}
		</Box>
	);
};

const CardRow = ({
	board,
	card,
	visibleFields,
	onOpen,
}: {
	board: SerializedBoard;
	card: SerializedCard;
	visibleFields: string[];
	onOpen: (cardId: string) => void;
}): ReactElement => {
	const overdue = isOverdue(card.dueDate, card.dueComplete);
	return (
		<TableRow action onClick={() => onOpen(card._id)}>
			<TableCell>
				<Box display='flex' alignItems='center' style={{ gap: '8px' }}>
					<Icon name={getCardTypeIcon(card.cardType)} size='x16' color='hint' />
					<Box withTruncatedText>{card.title}</Box>
				</Box>
			</TableCell>
			<TableCell>
				<LabelChips board={board} labels={card.labels} />
			</TableCell>
			<TableCell align='center'>{card.assignees?.length ? card.assignees.length : <Box color='hint'>—</Box>}</TableCell>
			<TableCell align='end'>
				{card.dueDate ? (
					<Tag variant={overdue ? 'danger' : 'secondary'}>
						<Icon name='clock' size='x12' mie={2} />
						{fmtShortDate(card.dueDate)}
					</Tag>
				) : (
					<Box color='hint'>—</Box>
				)}
			</TableCell>
			{visibleFields.map((fieldId) => (
				<TableCell key={fieldId}>
					<Box withTruncatedText>{fieldValueToString(card, fieldId) || <Box is='span' color='hint'>—</Box>}</Box>
				</TableCell>
			))}
		</TableRow>
	);
};

const TableView = ({ board, viewId }: TableViewProps): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();

	const { data, isLoading, isError } = useBoardViewCards(board._id, 'table', viewId);

	const result = data?.result;
	const cards = (result?.cards ?? []) as SerializedCard[];
	const groups = result?.groups as { key: string; label: string; cards: SerializedCard[] }[] | undefined;

	// visibleFields are board field-def ids; resolve names for the header.
	const visibleFields = useMemo<string[]>(() => {
		// The server echoes config indirectly via the rows; visibleFields live on the
		// saved view config and are not returned by the cards endpoint, so we read
		// them off the board's showOnFront fields as a sensible default column set.
		return (board.fieldDefs ?? [])
			.filter((f) => f.showOnFront)
			.sort((a, b) => a.position - b.position)
			.map((f) => f.id)
			.slice(0, 3);
	}, [board.fieldDefs]);

	const openCard = (cardId: string): void => {
		router.navigate({ name: 'boards-board', params: { id: board._id, view: 'table', cardId } });
	};

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' p={24}>
				<Throbber />
			</Box>
		);
	}

	const header = (
		<TableHead>
			<TableRow>
				<TableCell>{t('Boards_Views_Col_Card', { defaultValue: 'Card' })}</TableCell>
				<TableCell>{t('Tags')}</TableCell>
				<TableCell align='center'>{t('Boards_Views_Col_Assignees', { defaultValue: 'Assignees' })}</TableCell>
				<TableCell align='end'>{t('Boards_Matters_Deadline_Due', { defaultValue: 'Due' })}</TableCell>
				{visibleFields.map((fieldId) => (
					<TableCell key={fieldId}>{fieldNameById(board, fieldId)}</TableCell>
				))}
			</TableRow>
		</TableHead>
	);

	const colCount = 4 + visibleFields.length;

	return (
		<Box pi={24} pb={16} style={{ overflowX: 'auto' }}>
			{isError && (
				<Box mbe={12}>
					<Tag variant='secondary-danger'>{t('Something_went_wrong')}</Tag>
				</Box>
			)}

			{groups && groups.length > 0 ? (
				<Table fixed>
					{header}
					<TableBody>
						{groups.map((group) => (
							<Fragment key={`group-${group.key}`}>
								<TableRow>
									<TableCell colSpan={colCount}>
										<Box fontScale='p2b' color='default'>
											{group.label}{' '}
											<Box is='span' fontScale='c1' color='hint'>
												({group.cards.length})
											</Box>
										</Box>
									</TableCell>
								</TableRow>
								{group.cards.map((card) => (
									<CardRow key={card._id} board={board} card={card} visibleFields={visibleFields} onOpen={openCard} />
								))}
							</Fragment>
						))}
					</TableBody>
				</Table>
			) : (
				<Table fixed>
					{header}
					<TableBody>
						{cards.map((card) => (
							<CardRow key={card._id} board={board} card={card} visibleFields={visibleFields} onOpen={openCard} />
						))}
						{cards.length === 0 && (
							<TableRow>
								<TableCell colSpan={colCount}>
									<Box fontScale='c1' color='hint'>
										{t('No_results_found')}
									</Box>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			)}
		</Box>
	);
};

export default TableView;
