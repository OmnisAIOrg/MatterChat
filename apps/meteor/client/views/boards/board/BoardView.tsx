import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { IBoard, IBoardCard, IBoardList, Serialized } from '@rocket.chat/core-typings';
import { css } from '@rocket.chat/css-in-js';
import { Box, Throbber } from '@rocket.chat/fuselage';
import { PageScrollableContent } from '@rocket.chat/ui-client';
import { useEndpoint, useLayout, useMethod, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import type { InfiniteData } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import BulkActionBar from './BulkActionBar';
import CardTile from './CardTile';
import Column, { listSortableId } from './Column';
import { LEDGER_PAPER } from '../lib/ledger';
import { applyOptimisticMove, computeMovePlan, groupCardsByList, sortCards } from '../lib/optimistic';

// Endpoint data is JSON-serialized over the wire (Date -> string).
type SerializedCard = Serialized<IBoardCard>;

type BoardViewProps = {
	board: Serialized<IBoard>;
	lists: Serialized<IBoardList>[];
};

type CardsResponse = { cards: SerializedCard[]; count: number; offset: number; total: number };
// The cards cache is an infinite query (pages of CardsResponse), so the optimistic
// move snapshot/rollback works on the whole InfiniteData envelope.
type CardsCache = InfiniteData<CardsResponse, number>;
type MoveContext = { previous: CardsCache | undefined };

// Server page size. Stays at/below the API's hard upper count limit
// (API_Upper_Count_Limit, default 100) so every page request is honored in full.
const CARDS_PAGE_SIZE = 100;

// MATTERCHAT: mobile board = a Trello-style COLUMN PAGER. Desktop keeps free horizontal
// scrolling of 280px columns; on phones each column becomes a near-full-width page the
// user swipes between, with an edge peek of the next column, snap-locked per column.
// The width override needs !important because Fuselage's minWidth/maxWidth Box props win
// otherwise; `& > *` only ever matches the Column boxes (SortableContext renders no DOM).
const mobileColumnPagerClass = css`
	scroll-snap-type: x mandatory;
	-webkit-overflow-scrolling: touch;
	padding-inline: 8px;
	scroll-padding-inline: 8px;

	& > * {
		min-width: calc(100vw - 56px) !important;
		max-width: calc(100vw - 56px) !important;
		scroll-snap-align: start;
	}
`;

const BoardView = ({ board, lists }: BoardViewProps) => {
	const router = useRouter();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const { isMobile } = useLayout();

	const getCards = useEndpoint('GET', '/v1/boards.cards');
	const cardMove = useMethod('boards.cardMove');
	const cardCreate = useMethod('boards.cardCreate');
	const listReorder = useEndpoint('POST', '/v1/boards.list.reorder');

	const cardsQueryKey = useMemo(() => ['boards', 'cards', board._id], [board._id]);

	// Server-side pagination: fetch cards in pages of CARDS_PAGE_SIZE (offset/count/total
	// envelope) instead of one unbounded request. The first page paints the board immediately;
	// the effect below streams the remaining pages in until the whole board is loaded (drag &
	// drop and multi-select operate on the full card set, so we always page to the end).
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
	// The list (column) currently being dragged by its header handle, if any. Drives the
	// list DragOverlay and lets the drag handlers tell a list-drag apart from a card-drag.
	const [activeListId, setActiveListId] = useState<string | null>(null);

	// Multi-select state. `selectedIds` drives the checkboxes + the contextual BulkActionBar;
	// `anchorId` is the last individually-toggled card, used as the pivot for shift-click ranges.
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [anchorId, setAnchorId] = useState<string | null>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const cards = useMemo(() => data?.pages.flatMap((page) => page.cards) ?? [], [data]);
	const cardsByList = useMemo(() => groupCardsByList(cards), [cards]);
	const sortedLists = useMemo(() => [...lists].filter((l) => !l.archived).sort((a, b) => a.position - b.position), [lists]);

	// The horizontal SortableContext sorts by the columns' sortable ids (prefixed so they
	// never collide with card ids or the column-body droppables).
	const sortableListIds = useMemo(() => sortedLists.map((l) => listSortableId(l._id)), [sortedLists]);

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
				queryClient.setQueryData<CardsCache>(cardsQueryKey, context.previous);
			}
			dispatchToastMessage({ type: 'error', message: error });
		},
		onMutate: async ({ cardId, toListId, position }): Promise<MoveContext> => {
			await queryClient.cancelQueries({ queryKey: cardsQueryKey });
			const previous = queryClient.getQueryData<CardsCache>(cardsQueryKey);
			if (previous) {
				// the moved card lives in exactly one page; patching every page in place
				// keeps the InfiniteData envelope (pageParams) intact for the rollback
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

	// Reorder the board's columns. `lists` is owned by the board-info query
	// (`['boards','info',board._id]`); we optimistically rewrite that cache so the columns
	// slide immediately, then invalidate it to reconcile with the persisted order.
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
				// reassign positions to match the new index order (the server is the source of truth,
				// but this keeps the optimistic render stable until the refetch lands)
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

	// A list mutation (e.g. color change) lives on the board-info query, which owns `lists`.
	// Invalidate it so the freshly-updated list re-renders with its new accent.
	const handleListUpdated = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: ['boards', 'info', board._id] });
	}, [queryClient, board._id]);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			// A list-drag is identified by the draggable's `data.type` (set in Column's useSortable),
			// mirroring how cards tag themselves `type:'card'`.
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
			// Both ids are sortable list ids (`list-sortable:<id>`); map to the current order.
			const oldIndex = sortableListIds.indexOf(String(active.id));
			const newIndex = sortableListIds.indexOf(String(over.id));
			if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
				return;
			}
			// Reorder the *raw* list ids (strip the sortable prefix) and send the full ordering.
			const reordered = arrayMove(sortedLists, oldIndex, newIndex).map((l) => l._id);
			reorderListsMutation.mutate({ listIds: reordered });
		},
		[sortableListIds, sortedLists, reorderListsMutation],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			// List-drag and card-drag share one DndContext; route by the draggable's data.type.
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

			// Resolve the target list: either dropped on a list target (column body droppable OR
			// the column's sortable wrapper — both carry `data.listId`), or on another card.
			// Prefer `data.listId` over `over.id` because the list-sortable's id is prefixed
			// (`list-sortable:<id>`) and is NOT a raw list id.
			const overData = over.data.current as { type?: string; listId?: string } | undefined;
			const overId = String(over.id);
			const toListId = overData?.type === 'list' ? (overData.listId ?? overId) : (overData?.listId ?? moving.listId);

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
				{/* Ledger paper ground behind the columns (calm dense dark surface in dark theme).
				    On phones the same container becomes the snap-scrolling column pager. */}
				<Box
					display='flex'
					alignItems='flex-start'
					height='100%'
					className={isMobile ? mobileColumnPagerClass : undefined}
					style={{ overflowX: 'auto', backgroundColor: LEDGER_PAPER }}
				>
					<SortableContext items={sortableListIds} strategy={horizontalListSortingStrategy}>
						{sortedLists.map((list) => (
							<Column
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
					{activeCard ? <CardTile card={activeCard} labelDefs={board.labelDefs} onOpen={() => undefined} /> : null}
					{activeListId ? (
						<Box
							minWidth='x280'
							maxWidth='x280'
							paddingInline={12}
							paddingBlock={12}
							backgroundColor='tint'
							borderRadius='x4'
							fontScale='p2b'
							color='default'
							withTruncatedText
							style={{ opacity: 0.9, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
						>
							{sortedLists.find((l) => l._id === activeListId)?.title ?? ''}
						</Box>
					) : null}
				</DragOverlay>
			</DndContext>
		</PageScrollableContent>
	);
};

export default BoardView;
