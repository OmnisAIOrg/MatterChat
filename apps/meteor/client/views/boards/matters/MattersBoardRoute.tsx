import { Box, Button, ButtonGroup, Icon, States, StatesIcon, StatesTitle, StatesSubtitle, Throbber } from '@rocket.chat/fuselage';
import { Page, PageHeader } from '@rocket.chat/ui-client';
import { useEndpoint, useRouteParameter, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BoardAutomationsButton } from '../automation';
import BoardView from '../board/BoardView';
import CardDetail from '../card/CardDetail';
import { CaseProConnectionControls, CaseProStubBanner } from '../casepro';

/**
 * MattersBoardRoute — the `/boards/matters` landing screen (M3a client).
 *
 * Unlike a generic board (which is opened by id), the Matters pipeline is a
 * single per-user board resolved server-side: we call `boards.matters.ensureBoard`
 * (idempotent find-or-create that also seeds the 13 CasePro stage columns) and
 * render the existing M1 kanban (`BoardView`) over the returned board + lists.
 *
 * Extras layered on top of the shared kanban:
 *  - a CasePro connection cluster (status chip + "Test connection" + "Sync now",
 *    the latter still `boards.matters.seedFromCasePro`) that pulls every CasePro
 *    matter onto the board as matter cards;
 *  - a stub-mode banner (CaseProStubBanner) shown whenever the stub transport is
 *    active per `boards.casepro.status`, i.e. the snapshots are mock data;
 *  - a `:cardId` deep-link drawer (the integrator points `/boards/matters` here
 *    without a cardId segment, but we honor it if the router ever carries one).
 *
 * Wiring: register this default export at route name `boards-matters`
 * (path `/boards/matters`) in client/views/boards/routes.tsx. See return summary.
 */
const MattersBoardRoute = () => {
	const { t } = useTranslation();
	const router = useRouter();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const cardId = useRouteParameter('cardId');

	// When the last in-session "Sync now" succeeded — feeds the header's
	// "Last sync" label (client-observed; no endpoint supplies one yet).
	const [lastSyncAt, setLastSyncAt] = useState<Date | undefined>();

	const ensureBoard = useEndpoint('POST', '/v1/boards.matters.ensureBoard');
	const seedFromCasePro = useEndpoint('POST', '/v1/boards.matters.seedFromCasePro');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'matters', 'ensure'],
		queryFn: () => ensureBoard({}),
	});

	const board = data?.board;

	const seedMutation = useMutation({
		mutationFn: () => {
			if (!board) {
				throw new Error('Board not ready');
			}
			return seedFromCasePro({ boardId: board._id });
		},
		onSuccess: (result) => {
			const { bound, skipped, total } = result.result;
			setLastSyncAt(new Date());
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Matters_Sync_Result', {
					bound,
					skipped,
					total,
					defaultValue: 'Synced {{bound}} of {{total}} matters ({{skipped}} skipped)',
				}),
			});
			if (board) {
				// Refresh the kanban card list so newly bound matters appear.
				void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', board._id] });
			}
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	const handleSync = useCallback(() => {
		seedMutation.mutate();
	}, [seedMutation]);

	const handleCloseCard = useCallback(() => {
		// Drop the :cardId segment by re-navigating to the bare matters route.
		router.navigate({ name: 'boards-matters' });
	}, [router]);

	if (isLoading) {
		return (
			<Page background='room'>
				<Box display='flex' justifyContent='center' alignItems='center' height='100%'>
					<Throbber />
				</Box>
			</Page>
		);
	}

	if (isError || !data || !board) {
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

	const { lists } = data;

	// LEDGER CHROME (style only): background='room' puts the page shell on the
	// ledger paper surface (the chat-restyle palette re-points
	// --rcx-color-surface-room to paper light / calm dark), and the
	// 'mc-board-header' class pulls the serif case-caption + single dense
	// strip CSS from BoardsChromeStyleTags. Wiring is untouched.
	return (
		<Page flexDirection='row' background='room'>
			<Page background='room'>
				<PageHeader
					className='mc-board-header'
					title={
						<Box display='flex' alignItems='center'>
							<Icon name='bag' size='x24' mie={8} color='hint' />
							<Box withTruncatedText>{board.title || t('Boards_Matters')}</Box>
						</Box>
					}
				>
					<CaseProConnectionControls onSync={handleSync} isSyncing={seedMutation.isPending} lastSyncAt={lastSyncAt} mie={4} />
					<ButtonGroup>
						<BoardAutomationsButton boardId={board._id} small={false} />
					</ButtonGroup>
				</PageHeader>

				<CaseProStubBanner pi={24} pbs={12} />

				<BoardView board={board} lists={lists} />
			</Page>

			{cardId && <CardDetail boardId={board._id} cardId={cardId} onClose={handleCloseCard} />}
		</Page>
	);
};

export default MattersBoardRoute;
