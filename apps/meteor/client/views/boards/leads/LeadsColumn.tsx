import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IBoardCard, IBoardLabelDef, IBoardList, Serialized } from '@rocket.chat/core-typings';
import { Box, Icon } from '@rocket.chat/fuselage';
import { useThemeMode } from '@rocket.chat/ui-client';
import type { ComponentProps, CSSProperties, MouseEvent } from 'react';

import LeadsCardTile from './LeadsCardTile';
import LeadsQuickAddCard from './LeadsQuickAddCard';
import { getLeadsTokens, LEADS_MONO_LABEL_STYLE, LEADS_RADIUS } from './leadsDesignTokens';

// Sortable id for the COLUMN itself (prefixed to avoid collisions)
export const leadsListSortableId = (listId: string): string => `leads-list-sortable:${listId}`;

type LeadsColumnProps = {
	list: Serialized<IBoardList>;
	cards: Serialized<IBoardCard>[];
	labelDefs?: IBoardLabelDef[];
	isAddingCard: boolean;
	onAddCard: (listId: string, title: string) => Promise<void> | void;
	onOpenCard: (cardId: string) => void;
	onListUpdated: () => void;
	selectedIds?: Set<string>;
	onToggleSelect?: (cardId: string, event: MouseEvent) => void;
};

const LeadsColumn = ({
	list,
	cards,
	labelDefs,
	isAddingCard,
	onAddCard,
	onOpenCard,
	onListUpdated,
	selectedIds,
	onToggleSelect,
}: LeadsColumnProps) => {
	const [, , themeMode] = useThemeMode();
	const isDark = themeMode === 'dark';
	const tokens = getLeadsTokens(isDark);

	// Column body droppable — allows empty column to accept drops
	const { setNodeRef, isOver } = useDroppable({
		id: list._id,
		data: { type: 'list', listId: list._id },
	});

	// Sortable wrapper for horizontal reordering
	const {
		setNodeRef: setSortableRef,
		attributes: sortableAttributes,
		listeners: sortableListeners,
		transform: sortableTransform,
		transition: sortableTransition,
		isDragging: isListDragging,
	} = useSortable({
		id: leadsListSortableId(list._id),
		data: { type: 'list', listId: list._id },
	});

	const cardIds = cards.map((card) => card._id);

	const sortableStyle: CSSProperties = {
		transform: CSS.Translate.toString(sortableTransform),
		transition: sortableTransition,
		maxHeight: '100%',
		opacity: isListDragging ? 0.4 : 1,
	};

	return (
		<Box
			ref={setSortableRef}
			{...sortableAttributes}
			display='flex'
			flexDirection='column'
			style={{
				...sortableStyle,
				width: '296px',
				flexShrink: 0,
				backgroundColor: tokens.surface2,
				borderRadius: LEADS_RADIUS.card,
				border: `1px solid ${tokens.border}`,
				padding: '16px 12px 12px',
				gap: '8px',
				minHeight: 0,
			}}
		>
			{/* Column header — mono uppercase label + count badge */}
			<Box
				display='flex'
				alignItems='center'
				gap={8}
				style={{
					paddingBottom: '10px',
					paddingInline: '4px',
				}}
			>
				{/* Drag handle */}
				<Box
					{...sortableListeners}
					role='button'
					tabIndex={0}
					aria-label={`Reorder list ${list.title}`}
					display='flex'
					alignItems='center'
					style={{
						cursor: 'grab',
						touchAction: 'none',
						color: tokens.ink3,
						flexShrink: 0,
					}}
				>
					<Icon name={'arrangement' as ComponentProps<typeof Icon>['name']} size='x16' />
				</Box>

				{/* Title in mono uppercase */}
				<Box
					style={{
						...LEADS_MONO_LABEL_STYLE,
						color: tokens.ink2,
						flex: 1,
						minWidth: 0,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{list.title}
				</Box>

				{/* Card count badge */}
				<Box
					style={{
						...LEADS_MONO_LABEL_STYLE,
						fontSize: '10.5px',
						color: tokens.ink3,
						backgroundColor: tokens.surface,
						border: `1px solid ${tokens.border}`,
						borderRadius: LEADS_RADIUS.full,
						padding: '1px 7px',
						whiteSpace: 'nowrap',
						flexShrink: 0,
					}}
				>
					{cards.length}
					{list.wipLimit ? `/${list.wipLimit}` : ''}
				</Box>

				{/* Menu button placeholder (three dots) */}
				<Box
					role='button'
					tabIndex={0}
					display='flex'
					alignItems='center'
					style={{
						width: '24px',
						height: '24px',
						borderRadius: LEADS_RADIUS.small,
						cursor: 'pointer',
						color: tokens.ink3,
						flexShrink: 0,
						transition: 'all 0.12s',
						hover: {
							backgroundColor: tokens.border,
							color: tokens.ink,
						},
					}}
				>
					<Icon name='kebab' size='x16' />
				</Box>
			</Box>

			{/* Cards container — droppable area */}
			<Box
				ref={setNodeRef}
				display='flex'
				flexDirection='column'
				gap={8}
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: 'auto',
					outline: isOver ? `2px dashed ${tokens.green}` : 'none',
					outlineOffset: '-2px',
					transition: 'outline 0.15s',
					paddingRight: '4px',
					marginRight: '-4px',
				}}
			>
				<SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
					{cards.map((card) => (
						<LeadsCardTile
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

			{/* Empty state — shown when column has no cards */}
			{cards.length === 0 && (
				<Box
					style={{
						backgroundColor: tokens.surface,
						border: `1px solid ${tokens.border}`,
						borderRadius: LEADS_RADIUS.card,
						padding: '22px 16px',
						textAlign: 'center',
					}}
				>
					<Box
						display='flex'
						justifyContent='center'
						style={{
							width: '38px',
							height: '38px',
							margin: '0 auto',
							borderRadius: LEADS_RADIUS.nav,
							backgroundColor: tokens.greenSoft,
							border: `1px solid ${tokens.greenLine}`,
							color: tokens.greenInk,
						}}
					>
						<Icon name='home' size='x16' style={{ display: 'grid', placeItems: 'center' }} />
					</Box>
					<Box
						style={{
							marginTop: '10px',
							fontSize: '13px',
							fontWeight: 600,
							color: tokens.ink,
						}}
					>
						Nothing to evaluate
					</Box>
					<Box
						style={{
							marginTop: '3px',
							fontSize: '12px',
							color: tokens.ink3,
							lineHeight: '1.5',
						}}
					>
						Leads that need a second look will land here.
					</Box>
				</Box>
			)}

			{/* Add card button */}
			<LeadsQuickAddCard isAdding={isAddingCard} onAdd={(title) => onAddCard(list._id, title)} />
		</Box>
	);
};

export default LeadsColumn;
