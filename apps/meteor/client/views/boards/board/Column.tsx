import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IBoardCard, IBoardLabelDef, IBoardList, Serialized } from '@rocket.chat/core-typings';
import { Box, Icon } from '@rocket.chat/fuselage';
import type { ComponentProps, CSSProperties, MouseEvent } from 'react';

import CardTile from './CardTile';
import ListColorMenu from './ListColorMenu';
import QuickAddCard from './QuickAddCard';
import { LEDGER_LABEL_STYLE, LEDGER_NUMERIC_STYLE } from '../lib/ledger';

// Sortable id for the COLUMN itself. Prefixed so it can never collide with the column-body
// droppable (`id: list._id`, which card-drag resolves as the target list) or a card id.
export const listSortableId = (listId: string): string => `list-sortable:${listId}`;

type ColumnProps = {
	list: Serialized<IBoardList>;
	cards: Serialized<IBoardCard>[];
	labelDefs?: IBoardLabelDef[];
	isAddingCard: boolean;
	onAddCard: (listId: string, title: string) => Promise<void> | void;
	onOpenCard: (cardId: string) => void;
	onListUpdated: () => void;
	// Multi-select (optional): when wired, each tile renders a selection checkbox.
	selectedIds?: Set<string>;
	onToggleSelect?: (cardId: string, event: MouseEvent) => void;
};

const Column = ({ list, cards, labelDefs, isAddingCard, onAddCard, onOpenCard, onListUpdated, selectedIds, onToggleSelect }: ColumnProps) => {
	// the column body is a droppable so an empty column (no sortable items) still accepts a drop
	const { setNodeRef, isOver } = useDroppable({ id: list._id, data: { type: 'list', listId: list._id } });

	// The whole column participates in the horizontal SortableContext, but ONLY the header
	// drag handle (listeners/attributes below) starts a list-drag — so card-drag inside the
	// column body is never intercepted. `data.type: 'list'` lets the board's drag handlers
	// distinguish a list-drag from a card-drag.
	const {
		setNodeRef: setSortableRef,
		attributes: sortableAttributes,
		listeners: sortableListeners,
		transform: sortableTransform,
		transition: sortableTransition,
		isDragging: isListDragging,
	} = useSortable({ id: listSortableId(list._id), data: { type: 'list', listId: list._id } });

	const cardIds = cards.map((card) => card._id);

	// list.color is a raw CSS color string (hex), matching board.background / card cover / label colors
	const accent = list.color;

	const sortableStyle: CSSProperties = {
		transform: CSS.Translate.toString(sortableTransform),
		transition: sortableTransition,
		maxHeight: '100%',
		// accent the whole column with the chosen list color via a left edge bar
		borderInlineStart: accent ? `3px solid ${accent}` : undefined,
		opacity: isListDragging ? 0.4 : 1,
	};

	return (
		<Box
			ref={setSortableRef}
			{...sortableAttributes}
			display='flex'
			flexDirection='column'
			minWidth='x280'
			maxWidth='x280'
			mie={12}
			pi={12}
			pb={12}
			bg='tint'
			borderRadius='x4'
			flexShrink={0}
			style={sortableStyle}
		>
			<Box display='flex' alignItems='center' mbe={8}>
				{/* Drag handle — the ONLY list-drag affordance, so it can't fight card drag. */}
				<Box
					{...sortableListeners}
					role='button'
					tabIndex={0}
					aria-label={`Reorder list ${list.title}`}
					mie={4}
					flexShrink={0}
					display='flex'
					alignItems='center'
					style={{ cursor: 'grab', touchAction: 'none' }}
				>
					<Icon name={'arrangement' as ComponentProps<typeof Icon>['name']} size='x16' color='hint' />
				</Box>
				{/* small accent dot echoing the list color next to the title */}
				{accent && (
					<Box width='x10' height='x10' borderRadius='full' mie={6} flexShrink={0} style={{ backgroundColor: accent }} />
				)}
				{/* Ledger column header: small-caps mono-ish label + tabular count. */}
				<Box fontScale='p2b' color='default' withTruncatedText flexGrow={1} style={LEDGER_LABEL_STYLE}>
					{list.title}
				</Box>
				<Box fontScale='c1' color='hint' mis={4} style={LEDGER_NUMERIC_STYLE}>
					{cards.length}
					{list.wipLimit ? `/${list.wipLimit}` : ''}
				</Box>
				<ListColorMenu listId={list._id} color={accent} onUpdated={onListUpdated} />
			</Box>

			<Box
				ref={setNodeRef}
				flexGrow={1}
				style={{ overflowY: 'auto', minHeight: 8, outline: isOver ? '2px dashed var(--rcx-color-stroke-highlight, #1d74f5)' : 'none' }}
			>
				<SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
					{cards.map((card) => (
						<CardTile
							key={card._id}
							card={card}
							labelDefs={labelDefs}
							onOpen={onOpenCard}
							selected={selectedIds?.has(card._id)}
							onToggleSelect={onToggleSelect}
						/>
					))}
				</SortableContext>
			</Box>

			<QuickAddCard isAdding={isAddingCard} onAdd={(title) => onAddCard(list._id, title)} />
		</Box>
	);
};

export default Column;
