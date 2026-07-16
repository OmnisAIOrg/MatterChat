import { Box, Icon, Table, TableBody, TableCell, TableHead, TableRow, Throbber } from '@rocket.chat/fuselage';
import { useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement, ReactNode } from 'react';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getCardTypeIcon } from '../lib/icons';
import { heatPill, monoLabel, serifCaption, smallTag, tabularNums, useLedgerTones, type LedgerTones } from '../lib/ledgerTheme';
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
 *
 * LEDGER-DENSE SKIN (style-only): paper ground, small-caps mono column headers,
 * dense tabular rows ruled with khaki lines (like ruled paper), serif group
 * heads, small ledger tags for labels, red heat pill only when overdue.
 */

type TableViewProps = {
	board: SerializedBoard;
	viewId?: string;
};

// Ruled-paper table density: tight cells + khaki row rules.
const buildLedgerTableCss = (strokeSoft: string, hoverBg: string): string => `
.mcLedgerTableView .rcx-table__cell {
	padding-block: 4px;
	padding-inline: 8px;
	font-variant-numeric: tabular-nums;
	border-block-end: 1px solid ${strokeSoft};
	background: transparent;
}
.mcLedgerTableView tbody tr:hover .rcx-table__cell {
	background: ${hoverBg};
}
`;

const LabelChips = ({ board, labels, tones }: { board: SerializedBoard; labels: string[]; tones: LedgerTones }): ReactElement | null => {
	if (!labels?.length) {
		return null;
	}
	return (
		<Box display='flex' flexWrap='wrap' style={{ gap: '4px' }}>
			{labels.slice(0, 4).map((labelId) => {
				const def = labelDefById(board, labelId);
				return (
					<Box key={labelId} is='span' style={smallTag(tones)}>
						{def?.name ?? labelId}
					</Box>
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
	tones,
}: {
	board: SerializedBoard;
	card: SerializedCard;
	visibleFields: string[];
	onOpen: (cardId: string) => void;
	tones: LedgerTones;
}): ReactElement => {
	const overdue = isOverdue(card.dueDate, card.dueComplete);
	return (
		<TableRow action onClick={() => onOpen(card._id)}>
			<TableCell>
				<Box display='flex' alignItems='center' style={{ gap: '8px' }}>
					<Icon name={getCardTypeIcon(card.cardType)} size='x16' style={{ color: tones.inkMuted }} />
					<Box withTruncatedText>{card.title}</Box>
				</Box>
			</TableCell>
			<TableCell>
				<LabelChips board={board} labels={card.labels} tones={tones} />
			</TableCell>
			<TableCell align='center'>{card.assignees?.length ? card.assignees.length : <Box color='hint'>—</Box>}</TableCell>
			<TableCell align='end'>
				{!card.dueDate && <Box color='hint'>—</Box>}
				{card.dueDate && overdue && (
					<Box is='span' style={heatPill(tones.red, tones.redSoft)}>
						<Icon name='clock' size='x12' />
						{fmtShortDate(card.dueDate)}
					</Box>
				)}
				{card.dueDate && !overdue && (
					<Box is='span' style={{ ...smallTag(tones), ...tabularNums }}>
						{fmtShortDate(card.dueDate)}
					</Box>
				)}
			</TableCell>
			{visibleFields.map((fieldId) => (
				<TableCell key={fieldId}>
					<Box withTruncatedText>
						{fieldValueToString(card, fieldId) || (
							<Box is='span' color='hint'>
								—
							</Box>
						)}
					</Box>
				</TableCell>
			))}
		</TableRow>
	);
};

const TableView = ({ board, viewId }: TableViewProps): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
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

	const monoHead = (label: ReactNode): ReactElement => (
		<Box is='span' style={monoLabel(tones)}>
			{label}
		</Box>
	);

	const header = (
		<TableHead>
			<TableRow>
				<TableCell>{monoHead(t('Boards_Views_Col_Card', { defaultValue: 'Card' }))}</TableCell>
				<TableCell>{monoHead(t('Tags'))}</TableCell>
				<TableCell align='center'>{monoHead(t('Boards_Views_Col_Assignees', { defaultValue: 'Assignees' }))}</TableCell>
				<TableCell align='end'>{monoHead(t('Boards_Matters_Deadline_Due', { defaultValue: 'Due' }))}</TableCell>
				{visibleFields.map((fieldId) => (
					<TableCell key={fieldId}>{monoHead(fieldNameById(board, fieldId))}</TableCell>
				))}
			</TableRow>
		</TableHead>
	);

	const colCount = 4 + visibleFields.length;

	const tableFrame = { background: tones.card, border: `1px solid ${tones.stroke}`, borderRadius: 6 } as const;

	return (
		<Box className='mcLedgerTableView' pi={24} pb={16} style={{ overflowX: 'auto', background: tones.paper, minHeight: '100%' }}>
			{/* Static, theme-derived constant string — the dense ruled-table skin. */}
			<style dangerouslySetInnerHTML={{ __html: buildLedgerTableCss(tones.strokeSoft, tones.cardAlt) }} />
			{isError && (
				<Box mbe={12}>
					<Box is='span' style={heatPill(tones.red, tones.redSoft)}>
						{t('Something_went_wrong')}
					</Box>
				</Box>
			)}

			{groups && groups.length > 0 ? (
				<Box style={tableFrame}>
					<Table fixed>
						{header}
						<TableBody>
							{groups.map((group) => (
								<Fragment key={`group-${group.key}`}>
									<TableRow>
										<TableCell colSpan={colCount} style={{ background: tones.cardAlt }}>
											<Box fontScale='p2b' color='default' style={serifCaption}>
												{group.label}{' '}
												<Box is='span' style={{ ...monoLabel(tones), fontWeight: 400 }}>
													({group.cards.length})
												</Box>
											</Box>
										</TableCell>
									</TableRow>
									{group.cards.map((card) => (
										<CardRow key={card._id} board={board} card={card} visibleFields={visibleFields} onOpen={openCard} tones={tones} />
									))}
								</Fragment>
							))}
						</TableBody>
					</Table>
				</Box>
			) : (
				<Box style={tableFrame}>
					<Table fixed>
						{header}
						<TableBody>
							{cards.map((card) => (
								<CardRow key={card._id} board={board} card={card} visibleFields={visibleFields} onOpen={openCard} tones={tones} />
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
				</Box>
			)}
		</Box>
	);
};

export default TableView;
