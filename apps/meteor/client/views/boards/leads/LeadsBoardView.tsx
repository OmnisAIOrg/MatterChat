import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { IBoard, IBoardCard, IBoardList, Serialized } from '@rocket.chat/core-typings';
import { Box, Throbber } from '@rocket.chat/fuselage';
import { PageScrollableContent, useThemeMode } from '@rocket.chat/ui-client';
import { useEndpoint, useLayout, useMethod, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import type { InfiniteData } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import BulkActionBar from '../board/BulkActionBar';
import LeadsCardTile from './LeadsCardTile';
import LeadsColumn, { leadsListSortableId } from './LeadsColumn';
import { getLeadsTokens } from './leadsDesignTokens';
import { applyOptimisticMove, computeMovePlan, groupCardsByList, sortCards } from '../lib/optimistic';

type SerializedCard = Serialized<IBoardCard>;

type LeadsBoardViewProps = {
	board: Serialized<IBoard>;
	lists: Serialized<IBoardList>[];
};

type CardsResponse = { cards: SerializedCard[]; count: number; offset: number; total: number };
type CardsCache = InfiniteData<CardsResponse, number>;
type MoveContext = { previous: CardsCache | undefined };

const CARDS_PAGE_SIZE = 100;

const LeadsBoardView = ({ board, lists }: LeadsBoardViewProps) => {
	const router = useRouter();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const { isMobile } = useLayout();
	const [, , themeMode] = useThemeMode();
	const isDark = themeMode === 'dark';
	const tokens = getLeadsTokens(isDark);

	const getCards = useEndpoint('GET', '/v1/boards.cards');
	const cardMove = useMethod('boards.cardMove');
	const cardCreate = useMethod('boards.cardCreate');
	const listReorder = useEndpoint('POST', '/v1/boards.list.reorder');

	const cardsQueryKey = useMemo(() => ['boards', 'cards', board._id], [board._id]);

	const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
		queryKey: cardsQueryKey,
		queryFn: ({ pageParam }) => getCards({ boardId: board._id, offset: pageParam, count: CARDS_PAGE_SIZE }),
		initialPageParam: 0,
		getNextPageParam: (lastPage) => {
			const next = lastPage.offset + lastPage.count;
			return next < lastPage.total ? next : undefined;
		},
	});

	useEffect(() => {
		if (hasNextPage && !isFetchingNextPage) {
			void fetchNextPage();
		}
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	const [activeCard, setActiveCard] = useState<SerializedCard | null>(null);
	const [activeListId, setActiveListId] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [anchorId, setAnchorId] = useState<string | null>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const cards = useMemo(() => data?.pages.flatMap((page) => page.cards) ?? [], [data]);
	const cardsByList = useMemo(() => groupCardsByList(cards), [cards]);
	const sortedLists = useMemo(() => [...lists].filter((l) => !l.archived).sort((a, b) => a.position - b.position), [lists]);
	const sortableListIds = useMemo(() => sortedLists.map((l) => leadsListSortableId(l._id)), [sortedLists]);

	const openCard = useCallback(
		(cardId: string) => {
			router.navigate({ name: 'boards-leads', params: { cardId } });
		},
		[router],
	);

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

	const selectedIdsList = useMemo(() => {
		const existing = new Set(cards.map((c) => c._id));
		return Array.from(selectedIds).filter((id) => existing.has(id));
	}, [cards, selectedIds]);

	const moveMutation = useMutation<IBoardCard, Error, { cardId: string; toListId: string; position: number }, MoveContext>({
		mutationFn: ({ cardId, toListId, position }) => cardMove({ cardId, toListId, position }),
		onError: (error, _vars, context) => {
			if (context?.previous) {
				queryClient.setQueryData<CardsCache>(cardsQueryKey, context.previous);
			}
			dispatchToastMessage({ type: 'error', message: error });
		},
		onMutate: async ({ cardId, toListId, position }): Promise<MoveContext> => {
			await queryClient.cancelQueries({ queryKey: cardsQueryKey });
			const previous = queryClient.getQueryData<CardsCache>(cardsQueryKey);
			if (previous) {
				queryClient.setQueryData<CardsCache>(cardsQueryKey, {
					...previous,
					pages: previous.pages.map((page) => ({
						...page,
						cards: applyOptimisticMove(page.cards, cardId, toListId, position),
					})),
				});
			}
			return { previous };
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: cardsQueryKey });
		},
	});

	const createMutation = useMutation({
		mutationFn: ({ listId, title }: { listId: string; title: string }) => cardCreate({ boardId: board._id, listId, title }),
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

	const boardInfoQueryKey = useMemo(() => ['boards', 'info', board._id], [board._id]);

	const reorderListsMutation = useMutation<
		{ lists: Serialized<IBoardList>[] },
		Error,
		{ listIds: string[] },
		{ previous: { lists: Serialized<IBoardList>[] } | undefined }
	>({
		mutationFn: ({ listIds }) => listReorder({ boardId: board._id, listIds }),
		onMutate: async ({ listIds }) => {
			await queryClient.cancelQueries({ queryKey: boardInfoQueryKey });
			const previous = queryClient.getQueryData<{ lists: Serialized<IBoardList>[] }>(boardInfoQueryKey);
			if (previous?.lists) {
				const orderIndex = new Map(listIds.map((id, index) => [id, index] as const));
				const nextLists = previous.lists.map((l) => (orderIndex.has(l._id) ? { ...l, position: orderIndex.get(l._id) as number } : l));
				queryClient.setQueryData(boardInfoQueryKey, { ...previous, lists: nextLists });
			}
			return { previous };
		},
		onError: (error, _vars, context) => {
			if (context?.previous) {
				queryClient.setQueryData(boardInfoQueryKey, context.previous);
			}
			dispatchToastMessage({ type: 'error', message: error });
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: boardInfoQueryKey });
		},
	});

	const handleListUpdated = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: ['boards', 'info', board._id] });
	}, [queryClient, board._id]);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const activeData = event.active.data.current as { type?: string; listId?: string } | undefined;
			if (activeData?.type === 'list') {
				setActiveListId(activeData.listId ?? null);
				setActiveCard(null);
				return;
			}
			const card = cards.find((c) => c._id === event.active.id);
			setActiveCard(card ?? null);
		},
		[cards],
	);

	const handleListDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveListId(null);
			const { active, over } = event;
			if (!over || active.id === over.id) {
				return;
			}
			const oldIndex = sortableListIds.indexOf(String(active.id));
			const newIndex = sortableListIds.indexOf(String(over.id));
			if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
				return;
			}
			const reordered = arrayMove(sortedLists, oldIndex, newIndex).map((l) => l._id);
			reorderListsMutation.mutate({ listIds: reordered });
		},
		[sortableListIds, sortedLists, reorderListsMutation],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const activeData = event.active.data.current as { type?: string } | undefined;
			if (activeData?.type === 'list') {
				handleListDragEnd(event);
				return;
			}
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

			const overData = over.data.current as { type?: string; listId?: string } | undefined;
			const overId = String(over.id);
			const toListId = overData?.type === 'list' ? (overData.listId ?? overId) : (overData?.listId ?? moving.listId);

			const destCards = (cardsByList[toListId] ?? []).filter((c) => c._id !== activeId);
			let dropIndex = destCards.length;
			if (overData?.type === 'card') {
				const idx = destCards.findIndex((c) => c._id === overId);
				if (idx !== -1) {
					dropIndex = idx;
				}
			}

			const plan = computeMovePlan(cardsByList, activeId, toListId, dropIndex);

			if (toListId === moving.listId) {
				const sameList = sortCards(cardsByList[toListId] ?? []);
				const currentIndex = sameList.findIndex((c) => c._id === activeId);
				if (currentIndex === dropIndex || currentIndex === dropIndex - 1) {
					return;
				}
			}

			moveMutation.mutate({ cardId: activeId, toListId: plan.toListId, position: plan.position });
		},
		[cards, cardsByList, moveMutation, handleListDragEnd],
	);

	if (isLoading) {
		return (
			<PageScrollableContent>
				<Box display='flex' justifyContent='center' padding={24}>
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
				<Box
					display='flex'
					alignItems='flex-start'
					height='100%'
					style={{
						overflowX: 'auto',
						backgroundColor: tokens.bg,
						padding: '18px 24px 60px',
						gap: '16px',
					}}
				>
					<SortableContext items={sortableListIds} strategy={horizontalListSortingStrategy}>
						{sortedLists.map((list) => (
							<LeadsColumn
								key={list._id}
								list={list}
								cards={cardsByList[list._id] ?? []}
								labelDefs={board.labelDefs}
								isAddingCard={createMutation.isPending}
								onAddCard={handleAddCard}
								onOpenCard={openCard}
								onListUpdated={handleListUpdated}
								selectedIds={selectedIds}
								onToggleSelect={toggleSelect}
							/>
						))}
					</SortableContext>
				</Box>
				<DragOverlay>
					{activeCard ? <LeadsCardTile card={activeCard} labelDefs={board.labelDefs} onOpen={() => undefined} /> : null}
				</DragOverlay>
			</DndContext>
		</PageScrollableContent>
	);
};

export default LeadsBoardView;
