import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { IBoard, IBoardCard, IBoardList, Serialized } from '@rocket.chat/core-typings';
import { Box, Throbber } from '@rocket.chat/fuselage';
import { PageScrollableContent } from '@rocket.chat/ui-client';
import { useEndpoint, useMethod, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';

import BulkActionBar from './BulkActionBar';
import CardTile from './CardTile';
import Column from './Column';
import { applyOptimisticMove, computeMovePlan, groupCardsByList, sortCards } from '../lib/optimistic';

// Endpoint data is JSON-serialized over the wire (Date -> string).
type SerializedCard = Serialized<IBoardCard>;

type BoardViewProps = {
	board: Serialized<IBoard>;
	lists: Serialized<IBoardList>[];
};

type CardsResponse = { cards: SerializedCard[]; count: number; offset: number; total: number };
type MoveContext = { previous: CardsResponse | undefined };

const BoardView = ({ board, lists }: BoardViewProps) => {
	const router = useRouter();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const getCards = useEndpoint('GET', '/v1/boards.cards');
	const cardMove = useMethod('boards.cardMove');
	const cardCreate = useMethod('boards.cardCreate');

	const cardsQueryKey = useMemo(() => ['boards', 'cards', board._id], [board._id]);

	const { data, isLoading } = useQuery({
		queryKey: cardsQueryKey,
		queryFn: () => getCards({ boardId: board._id, count: 1000 }),
	});

	const [activeCard, setActiveCard] = useState<SerializedCard | null>(null);

	// Multi-select state. `selectedIds` drives the checkboxes + the contextual BulkActionBar;
	// `anchorId` is the last individually-toggled card, used as the pivot for shift-click ranges.
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [anchorId, setAnchorId] = useState<string | null>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const cards = useMemo(() => data?.cards ?? [], [data]);
	const cardsByList = useMemo(() => groupCardsByList(cards), [cards]);
	const sortedLists = useMemo(() => [...lists].filter((l) => !l.archived).sort((a, b) => a.position - b.position), [lists]);

	const openCard = useCallback(
		(cardId: string) => {
			router.navigate({ name: 'boards-board', params: { id: board._id, view: 'board', cardId } });
		},
		[board._id, router],
	);

	// Visual card order (lists left-to-right, cards top-to-bottom) — the basis for shift-click ranges.
	const flatCardIds = useMemo(
		() => sortedLists.flatMap((list) => (cardsByList[list._id] ?? []).map((c) => c._id)),
		[sortedLists, cardsByList],
	);

	const clearSelection = useCallback(() => {
		setSelectedIds(new Set());
		setAnchorId(null);
	}, []);

	const toggleSelect = useCallback(
		(cardId: string, event: MouseEvent) => {
			setSelectedIds((prev) => {
				const next = new Set(prev);
				// Shift-click selects the contiguous range between the anchor and this card.
				if (event.shiftKey && anchorId && anchorId !== cardId) {
					const from = flatCardIds.indexOf(anchorId);
					const to = flatCardIds.indexOf(cardId);
					if (from !== -1 && to !== -1) {
						const [lo, hi] = from < to ? [from, to] : [to, from];
						for (let i = lo; i <= hi; i++) {
							next.add(flatCardIds[i]);
						}
						return next;
					}
				}
				// Plain toggle.
				if (next.has(cardId)) {
					next.delete(cardId);
				} else {
					next.add(cardId);
				}
				return next;
			});
			setAnchorId(cardId);
		},
		[anchorId, flatCardIds],
	);

	// Keep the selection in sync with the cards that actually exist after a refetch (moved/deleted
	// cards drop out, so the BulkActionBar never references stale ids).
	const selectedIdsList = useMemo(() => {
		const existing = new Set(cards.map((c) => c._id));
		return Array.from(selectedIds).filter((id) => existing.has(id));
	}, [cards, selectedIds]);

	const moveMutation = useMutation<IBoardCard, Error, { cardId: string; toListId: string; position: number }, MoveContext>({
		mutationFn: ({ cardId, toListId, position }) => cardMove({ cardId, toListId, position }),
		onError: (error, _vars, context) => {
			// rollback to the snapshot captured in onMutate
			if (context?.previous) {
				queryClient.setQueryData<CardsResponse>(cardsQueryKey, context.previous);
			}
			dispatchToastMessage({ type: 'error', message: error });
		},
		onMutate: async ({ cardId, toListId, position }): Promise<MoveContext> => {
			await queryClient.cancelQueries({ queryKey: cardsQueryKey });
			const previous = queryClient.getQueryData<CardsResponse>(cardsQueryKey);
			if (previous) {
				queryClient.setQueryData<CardsResponse>(cardsQueryKey, {
					...previous,
					cards: applyOptimisticMove(previous.cards, cardId, toListId, position),
				});
			}
			return { previous };
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: cardsQueryKey });
		},
	});

	const createMutation = useMutation({
		mutationFn: ({ listId, title }: { listId: string; title: string }) =>
			cardCreate({ boardId: board._id, listId, title }),
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: cardsQueryKey });
		},
	});

	const handleAddCard = useCallback(
		async (listId: string, title: string) => {
			await createMutation.mutateAsync({ listId, title });
		},
		[createMutation],
	);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const card = cards.find((c) => c._id === event.active.id);
			setActiveCard(card ?? null);
		},
		[cards],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveCard(null);
			const { active, over } = event;
			if (!over) {
				return;
			}
			const activeId = String(active.id);
			const moving = cards.find((c) => c._id === activeId);
			if (!moving) {
				return;
			}

			// Resolve the target list: either dropped on a list droppable, or on another card.
			const overData = over.data.current as { type?: string; listId?: string } | undefined;
			const overId = String(over.id);
			const toListId = overData?.type === 'list' ? overId : (overData?.listId ?? moving.listId);

			// Compute the drop index within the destination column (after removing the active card).
			const destCards = (cardsByList[toListId] ?? []).filter((c) => c._id !== activeId);
			let dropIndex = destCards.length;
			if (overData?.type === 'card') {
				const idx = destCards.findIndex((c) => c._id === overId);
				if (idx !== -1) {
					dropIndex = idx;
				}
			}

			const plan = computeMovePlan(cardsByList, activeId, toListId, dropIndex);

			// no-op if dropped in exactly its current slot
			if (toListId === moving.listId) {
				const sameList = sortCards(cardsByList[toListId] ?? []);
				const currentIndex = sameList.findIndex((c) => c._id === activeId);
				if (currentIndex === dropIndex || currentIndex === dropIndex - 1) {
					return;
				}
			}

			moveMutation.mutate({ cardId: activeId, toListId: plan.toListId, position: plan.position });
		},
		[cards, cardsByList, moveMutation],
	);

	if (isLoading) {
		return (
			<PageScrollableContent>
				<Box display='flex' justifyContent='center' p={24}>
					<Throbber />
				</Box>
			</PageScrollableContent>
		);
	}

	return (
		<PageScrollableContent>
			{selectedIdsList.length > 0 && (
				<BulkActionBar boardId={board._id} selectedIds={selectedIdsList} lists={lists} onClearSelection={clearSelection} />
			)}
			<DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
				<Box display='flex' alignItems='flex-start' height='100%' style={{ overflowX: 'auto' }}>
					{sortedLists.map((list) => (
						<Column
							key={list._id}
							list={list}
							cards={cardsByList[list._id] ?? []}
							labelDefs={board.labelDefs}
							isAddingCard={createMutation.isPending}
							onAddCard={handleAddCard}
							onOpenCard={openCard}
							selectedIds={selectedIds}
							onToggleSelect={toggleSelect}
						/>
					))}
				</Box>
				<DragOverlay>{activeCard ? <CardTile card={activeCard} labelDefs={board.labelDefs} onOpen={() => undefined} /> : null}</DragOverlay>
			</DndContext>
		</PageScrollableContent>
	);
};

export default BoardView;
