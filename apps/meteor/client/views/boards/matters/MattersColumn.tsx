import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IBoardCard, IBoardLabelDef, IBoardList, Serialized } from '@rocket.chat/core-typings';
import type { CSSProperties, MouseEvent } from 'react';

import MattersCardTile from './MattersCardTile';

/**
 * MattersColumn — Premium-refresh column component for the Matters kanban board.
 *
 * Features:
 * - Mono uppercase column headers with count badges
 * - Drag handle for reordering
 * - Grid of cards (296px width per design)
 * - Quick "Add card" button
 *
 * Card data passed via props includes stage pills, SOL info, and team avatars.
 */

type ColumnCardData = Serialized<IBoardCard> & {
	stagePill?: string;
	teamInitials?: string[];
	solPercentage?: number;
	solLabel?: string;
};

type MattersColumnProps = {
	list: Serialized<IBoardList>;
	cards: ColumnCardData[];
	labelDefs?: IBoardLabelDef[];
	isAddingCard: boolean;
	onAddCard: (listId: string, title: string) => Promise<void> | void;
	onOpenCard: (cardId: string) => void;
	selectedIds?: Set<string>;
	onToggleSelect?: (cardId: string, event: MouseEvent) => void;
};

export const mattersListSortableId = (listId: string): string => `list-sortable:${listId}`;

const MattersColumn = ({
	list,
	cards,
	labelDefs,
	isAddingCard,
	onAddCard,
	onOpenCard,
	selectedIds,
	onToggleSelect,
}: MattersColumnProps) => {
	// Column body is a droppable for empty column drops
	const { setNodeRef, isOver } = useDroppable({
		id: list._id,
		data: { type: 'list', listId: list._id },
	});

	// Column header has sortable drag handle
	const {
		setNodeRef: setSortableRef,
		attributes: sortableAttributes,
		listeners: sortableListeners,
		transform: sortableTransform,
		transition: sortableTransition,
		isDragging: isListDragging,
	} = useSortable({
		id: mattersListSortableId(list._id),
		data: { type: 'list', listId: list._id },
	});

	const cardIds = cards.map((card) => card._id);

	const sortableStyle: CSSProperties = {
		transform: CSS.Translate.toString(sortableTransform),
		transition: sortableTransition,
		maxHeight: '100%',
		opacity: isListDragging ? 0.4 : 1,
	};

	const handleAddCardClick = async () => {
		// Simple implementation: prompt for a title
		// In a real implementation, this would open a form
		const title = prompt('Enter card title:');
		if (title) {
			await onAddCard(list._id, title);
		}
	};

	return (
		<div
			ref={setSortableRef}
			{...sortableAttributes}
			style={sortableStyle}
			className='mc-matters-column'
		>
			{/* Column Header */}
			<div className='mc-matters-column-header' {...sortableListeners}>
				<span>{list.title}</span>
				<span className='mc-matters-column-count'>{cards.length}</span>
			</div>

			{/* Cards Container */}
			<div
				ref={setNodeRef}
				style={{
					flex: 1,
					overflowY: 'auto',
					minHeight: 8,
					outline: isOver ? '2px dashed var(--mc-premium-green)' : 'none',
				}}
			>
				<SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
					{cards.map((card) => (
						<MattersCardTile
							key={card._id}
							card={card}
							labelDefs={labelDefs}
							onOpen={onOpenCard}
							selected={selectedIds?.has(card._id)}
							onToggleSelect={onToggleSelect}
							stagePill={card.stagePill}
							teamInitials={card.teamInitials}
							solPercentage={card.solPercentage}
							solLabel={card.solLabel}
						/>
					))}
				</SortableContext>
			</div>

			{/* Add Card Button */}
			<button className='mc-matters-add-card-btn' onClick={handleAddCardClick} disabled={isAddingCard}>
				+ Add card
			</button>
		</div>
	);
};

export default MattersColumn;
