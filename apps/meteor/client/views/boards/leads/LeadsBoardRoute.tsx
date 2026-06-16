import { Box, Button, Icon, States, StatesIcon, StatesTitle, StatesSubtitle, Throbber } from '@rocket.chat/fuselage';
import { Page, PageHeader } from '@rocket.chat/ui-client';
import { useEndpoint, useRouteParameter, useRouter, useSetModal } from '@rocket.chat/ui-contexts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import LeadCaptureModal from './LeadCaptureModal';
import BoardView from '../board/BoardView';
import CardDetail from '../card/CardDetail';
import { getPipelineTypeIcon } from '../lib/icons';

/**
 * LEADS BOARD ROUTE (route id `boards-leads`, path `/boards/leads`).
 *
 * On mount it ensures the canonical Leads board exists (server self-heals missing
 * intake columns) via POST /v1/boards.leads.ensureBoard, then renders the M1
 * kanban (BoardView) for that board — same surface as BoardRouter, but the board
 * is resolved by pipeline rather than by a :id route param, and the header gets a
 * New Lead action that opens LeadCaptureModal. The `?cardId=` route param still
 * deep-links the card drawer (CardDetail), which the integrator extends to render
 * LeadPanel for lead-typed cards.
 */
const LeadsBoardRoute = () => {
	const { t } = useTranslation();
	const router = useRouter();
	const setModal = useSetModal();
	const queryClient = useQueryClient();

	// CardDetail drawer is opened via ?cardId= on this route.
	const cardId = useRouteParameter('cardId');

	const ensureLeadsBoard = useEndpoint('POST', '/v1/boards.leads.ensureBoard');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'leads', 'ensureBoard'],
		queryFn: () => ensureLeadsBoard({}),
		staleTime: Infinity,
	});

	const board = data?.board;
	const boardId = board?._id;

	const handleCloseCard = useCallback(() => {
		router.navigate({ name: 'boards-leads' });
	}, [router]);

	const handleNewLead = useCallback(() => {
		const close = (): void => setModal(null);
		setModal(
			<LeadCaptureModal
				boardId={boardId}
				onClose={close}
				onCreated={(lead) => {
					// refresh the kanban cards for this board; open the new lead's card drawer if linked
					if (boardId) {
						void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
					}
					if (lead.cardId) {
						router.navigate({ name: 'boards-leads', params: { cardId: lead.cardId } });
					}
				}}
			/>,
		);
	}, [setModal, boardId, queryClient, router]);

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
							<Icon name={getPipelineTypeIcon('leads')} size='x24' mie={8} color='hint' />
							<Box withTruncatedText>{board.title}</Box>
						</Box>
					}
				>
					<Button primary small onClick={handleNewLead}>
						<Icon name='plus' size='x16' mie={4} />
						{t('Boards_New_Lead', { defaultValue: 'New Lead' })}
					</Button>
				</PageHeader>
				<BoardView board={board} lists={lists} />
			</Page>
			{cardId && boardId && <CardDetail boardId={boardId} cardId={cardId} onClose={handleCloseCard} />}
		</Page>
	);
};

export default LeadsBoardRoute;
