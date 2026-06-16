import { Box, Button, Callout, Icon, States, StatesIcon, StatesTitle, StatesSubtitle, Throbber } from '@rocket.chat/fuselage';
import { Page, PageHeader } from '@rocket.chat/ui-client';
import { useEndpoint, useRouteParameter, useRouter, useSetting, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import BoardView from '../board/BoardView';
import CardDetail from '../card/CardDetail';

/**
 * MattersBoardRoute — the `/boards/matters` landing screen (M3a client).
 *
 * Unlike a generic board (which is opened by id), the Matters pipeline is a
 * single per-user board resolved server-side: we call `boards.matters.ensureBoard`
 * (idempotent find-or-create that also seeds the 13 CasePro stage columns) and
 * render the existing M1 kanban (`BoardView`) over the returned board + lists.
 *
 * Extras layered on top of the shared kanban:
 *  - a "Sync from CasePro" header action (`boards.matters.seedFromCasePro`) that
 *    pulls every CasePro matter onto the board as matter cards;
 *  - a stub-mode banner shown whenever CasePro is not live (the public
 *    `CasePro_Enabled` master switch is off), i.e. the snapshots are mock data;
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

	// Public master switch. When CasePro is NOT enabled the read client serves
	// mock (stub) rows, so we surface a banner. Only `CasePro_Enabled` is a
	// public setting (transport/base-url are private), so it is the sole signal
	// the client can legitimately read.
	const caseProEnabled = useSetting('CasePro_Enabled', false);

	const cardId = useRouteParameter('cardId');

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
			<Page>
				<Box display='flex' justifyContent='center' alignItems='center' height='100%'>
					<Throbber />
				</Box>
			</Page>
		);
	}

	if (isError || !data || !board) {
		return (
			<Page>
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

	return (
		<Page flexDirection='row'>
			<Page>
				<PageHeader
					title={
						<Box display='flex' alignItems='center'>
							<Icon name='bag' size='x24' mie={8} color='hint' />
							<Box withTruncatedText>{board.title || t('Boards_Matters')}</Box>
						</Box>
					}
				>
					<Button primary onClick={handleSync} disabled={seedMutation.isPending}>
						{seedMutation.isPending ? (
							<Throbber inheritColor size='x12' />
						) : (
							<Icon name='reload' size='x16' mie={4} />
						)}
						{t('Boards_Matters_Sync_From_CasePro', { defaultValue: 'Sync from CasePro' })}
					</Button>
				</PageHeader>

				{!caseProEnabled && (
					<Box pi={24} pbs={12}>
						<Callout
							type='warning'
							icon='info'
							title={t('Boards_Matters_Stub_Title', { defaultValue: 'CasePro is in stub mode' })}
						>
							{t('Boards_Matters_Stub_Description', {
								defaultValue: 'CasePro is not connected — matters shown here use sample data, not live records.',
							})}
						</Callout>
					</Box>
				)}

				<BoardView board={board} lists={lists} />
			</Page>

			{cardId && <CardDetail boardId={board._id} cardId={cardId} onClose={handleCloseCard} />}
		</Page>
	);
};

export default MattersBoardRoute;
