import type { ISavedView, SavedViewType, Serialized } from '@rocket.chat/core-typings';
import { Box, States, StatesIcon, StatesTitle, StatesSubtitle, Throbber, Button } from '@rocket.chat/fuselage';
import { Page } from '@rocket.chat/ui-client';
import { useEndpoint, useRouteParameter, useRouter } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BoardHeader from './BoardHeader';
import BoardView from './board/BoardView';

// Only the default kanban BoardView and the always-present BoardHeader are eager. The
// Table/Timeline/Dashboard views and the card-detail drawer are code-split into their own
// chunks so opening a board no longer downloads three unused views (and their heavier table/
// dnd deps) before the first paint — they load on demand when that view type or a card opens.
const CardDetail = lazy(() => import('./card/CardDetail'));
const DashboardView = lazy(() => import('./views/DashboardView'));
const TableView = lazy(() => import('./views/TableView'));
const TimelineView = lazy(() => import('./views/TimelineView'));
const FormsManager = lazy(() => import('./forms/FormsManager'));

const BoardRouter = () => {
	const { t } = useTranslation();
	const router = useRouter();

	const boardId = useRouteParameter('id');
	const view = useRouteParameter('view') ?? 'board';
	const cardId = useRouteParameter('cardId');

	// The active SAVED view (id) is local UI state — the route carries only the
	// view *type*. Switching a built-in tab clears it; picking a saved view sets
	// both the type (via navigate) and this id so the body queries that view.
	const [activeViewId, setActiveViewId] = useState<string | undefined>(undefined);

	const getBoardInfo = useEndpoint('GET', '/v1/boards.info');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'info', boardId],
		queryFn: () => getBoardInfo({ boardId: boardId as string }),
		enabled: Boolean(boardId),
	});

	const handleCloseCard = useCallback(() => {
		if (!boardId) {
			return;
		}
		// drop the :cardId segment by navigating back to the board view
		router.navigate({ name: 'boards-board', params: { id: boardId, view } });
	}, [boardId, router, view]);

	// Picking a saved view: navigate to its view type and remember its id.
	const handleSelectSavedView = useCallback(
		(savedView: Serialized<ISavedView>) => {
			setActiveViewId(savedView._id);
			if (boardId && savedView.viewType !== view) {
				router.navigate({ name: 'boards-board', params: { id: boardId, view: savedView.viewType } });
			}
		},
		[boardId, router, view],
	);

	// Clicking a built-in view-type tab: clear any active saved view (so the body
	// runs an ad-hoc empty-config query) and navigate to the new view type.
	const handleSelectViewType = useCallback(
		(viewType: SavedViewType) => {
			setActiveViewId(undefined);
			if (boardId) {
				router.navigate({ name: 'boards-board', params: { id: boardId, view: viewType } });
			}
		},
		[boardId, router],
	);

	if (!boardId) {
		return (
			<Page background='room'>
				<States>
					<StatesIcon name='warning' variation='danger' />
					<StatesTitle>{t('Something_went_wrong')}</StatesTitle>
				</States>
			</Page>
		);
	}

	if (isLoading) {
		return (
			<Page background='room'>
				<Box display='flex' justifyContent='center' alignItems='center' height='100%'>
					<Throbber />
				</Box>
			</Page>
		);
	}

	if (isError || !data) {
		return (
			<Page background='room'>
				<States>
					<StatesIcon name='warning' variation='danger' />
					<StatesTitle>{t('Something_went_wrong')}</StatesTitle>
					<StatesSubtitle>
						<Button small onClick={() => refetch()}>
							{t('Reload_page')}
						</Button>
					</StatesSubtitle>
				</States>
			</Page>
		);
	}

	const { board, lists } = data;

	const renderBody = () => {
		switch (view) {
			case 'table':
				return <TableView board={board} viewId={activeViewId} />;
			case 'timeline':
				return <TimelineView board={board} viewId={activeViewId} />;
			case 'dashboard':
				return <DashboardView board={board} viewId={activeViewId} />;
			case 'forms':
				// Forms manager (parity P0.7) — not a saved-view type, a management surface.
				return <FormsManager board={board} lists={lists} />;
			case 'board':
			default:
				// kanban (and any unrecognized/calendar value on a non-matters board)
				return <BoardView board={board} lists={lists} />;
		}
	};

	// A matter card opens EXPANDED (majority width) by default; leads/other cards keep the
	// drawer. Keyed off the board's pipeline so the layout is right on first paint (before the
	// card fetch resolves) — CardDetail refines by the card's own cardType once it loads, and
	// the user can always toggle. minWidth={0} lets the kanban Page shrink left of the wide
	// detail (its columns scroll horizontally) instead of forcing the flex row to overflow.
	const cardExpandedByDefault = board.pipelineType === 'matters';

	// LEDGER CHROME (style only): background='room' = the paper page shell (the
	// chat-restyle palette re-points --rcx-color-surface-room to paper light /
	// calm dark). The expand-by-default logic above and every handler/query in
	// this file are untouched.
	return (
		<Page flexDirection='row' background='room'>
			<Page minWidth={0} background='room'>
				<BoardHeader
					board={board}
					view={view}
					activeViewId={activeViewId}
					onSelectViewType={handleSelectViewType}
					onSelectSavedView={handleSelectSavedView}
				/>
				<Suspense
					fallback={
						<Box display='flex' justifyContent='center' alignItems='center' height='100%'>
							<Throbber />
						</Box>
					}
				>
					{renderBody()}
				</Suspense>
			</Page>
			{cardId && (
				<Suspense fallback={null}>
					<CardDetail boardId={boardId} cardId={cardId} onClose={handleCloseCard} defaultExpanded={cardExpandedByDefault} />
				</Suspense>
			)}
		</Page>
	);
};

export default BoardRouter;
