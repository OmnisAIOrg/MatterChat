import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { IBoardCard, IBoardLabelDef, IBoardList, Serialized } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';
import type { MouseEvent } from 'react';

import CardTile from './CardTile';
import QuickAddCard from './QuickAddCard';

type ColumnProps = {
	list: Serialized<IBoardList>;
	cards: Serialized<IBoardCard>[];
	labelDefs?: IBoardLabelDef[];
	isAddingCard: boolean;
	onAddCard: (listId: string, title: string) => Promise<void> | void;
	onOpenCard: (cardId: string) => void;
	// Multi-select (optional): when wired, each tile renders a selection checkbox.
	selectedIds?: Set<string>;
	onToggleSelect?: (cardId: string, event: MouseEvent) => void;
};

const Column = ({ list, cards, labelDefs, isAddingCard, onAddCard, onOpenCard, selectedIds, onToggleSelect }: ColumnProps) => {
	// the column body is a droppable so an empty column (no sortable items) still accepts a drop
	const { setNodeRef, isOver } = useDroppable({ id: list._id, data: { type: 'list', listId: list._id } });

	const cardIds = cards.map((card) => card._id);

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
			style={{ maxHeight: '100%' }}
		>
			<Box display='flex' alignItems='center' mbe={8}>
				<Box fontScale='p2b' color='default' withTruncatedText flexGrow={1}>
					{list.title}
				</Box>
				<Box fontScale='c1' color='hint' mis={4}>
					{cards.length}
					{list.wipLimit ? `/${list.wipLimit}` : ''}
				</Box>
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
