import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { IBoardCard, IBoardLabelDef, IBoardList, Serialized } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';

import CardTile from './CardTile';
import ListColorMenu from './ListColorMenu';
import QuickAddCard from './QuickAddCard';

type ColumnProps = {
	list: Serialized<IBoardList>;
	cards: Serialized<IBoardCard>[];
	labelDefs?: IBoardLabelDef[];
	isAddingCard: boolean;
	onAddCard: (listId: string, title: string) => Promise<void> | void;
	onOpenCard: (cardId: string) => void;
	onListUpdated: () => void;
};

const Column = ({ list, cards, labelDefs, isAddingCard, onAddCard, onOpenCard, onListUpdated }: ColumnProps) => {
	// the column body is a droppable so an empty column (no sortable items) still accepts a drop
	const { setNodeRef, isOver } = useDroppable({ id: list._id, data: { type: 'list', listId: list._id } });

	const cardIds = cards.map((card) => card._id);

	// list.color is a raw CSS color string (hex), matching board.background / card cover / label colors
	const accent = list.color;

	return (
		<Box
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
			style={{
				maxHeight: '100%',
				// accent the whole column with the chosen list color via a left edge bar
				borderInlineStart: accent ? `3px solid ${accent}` : undefined,
			}}
		>
			<Box display='flex' alignItems='center' mbe={8}>
				{/* small accent dot echoing the list color next to the title */}
				{accent && (
					<Box width='x10' height='x10' borderRadius='full' mie={6} flexShrink={0} style={{ backgroundColor: accent }} />
				)}
				<Box fontScale='p2b' color='default' withTruncatedText flexGrow={1}>
					{list.title}
				</Box>
				<Box fontScale='c1' color='hint' mis={4}>
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
						<CardTile key={card._id} card={card} labelDefs={labelDefs} onOpen={onOpenCard} />
					))}
				</SortableContext>
			</Box>

			<QuickAddCard isAdding={isAddingCard} onAdd={(title) => onAddCard(list._id, title)} />
		</Box>
	);
};

export default Column;
