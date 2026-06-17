import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { IBoard, IBoardCard, IBoardList, Serialized } from '@rocket.chat/core-typings';
import { Box, Throbber } from '@rocket.chat/fuselage';
import { PageScrollableContent } from '@rocket.chat/ui-client';
import { useEndpoint, useMethod, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

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
						/>
					))}
				</Box>
				<DragOverlay>{activeCard ? <CardTile card={activeCard} labelDefs={board.labelDefs} onOpen={() => undefined} /> : null}</DragOverlay>
			</DndContext>
		</PageScrollableContent>
	);
};

export default BoardView;
