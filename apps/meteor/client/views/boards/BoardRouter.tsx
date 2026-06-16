import { Box, States, StatesIcon, StatesTitle, StatesSubtitle, Throbber, Button } from '@rocket.chat/fuselage';
import { Page } from '@rocket.chat/ui-client';
import { useEndpoint, useRouteParameter, useRouter } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import BoardHeader from './BoardHeader';
import BoardView from './board/BoardView';
import CardDetail from './card/CardDetail';

const BoardRouter = () => {
	const { t } = useTranslation();
	const router = useRouter();

	const boardId = useRouteParameter('id');
	const view = useRouteParameter('view') ?? 'board';
	const cardId = useRouteParameter('cardId');

	const getBoardInfo = useEndpoint('GET', '/v1/boards.info');

	const {
		data,
		isLoading,
		isError,
		refetch,
	} = useQuery({
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

	if (!boardId) {
		return (
			<Page>
				<States>
					<StatesIcon name='warning' variation='danger' />
					<StatesTitle>{t('Something_went_wrong')}</StatesTitle>
				</States>
			</Page>
		);
	}

	if (isLoading) {
		return (
			<Page>
				<Box display='flex' justifyContent='center' alignItems='center' height='100%'>
					<Throbber />
				</Box>
			</Page>
		);
	}

	if (isError || !data) {
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

	const { board, lists } = data;

	return (
		<Page flexDirection='row'>
			<Page>
				<BoardHeader board={board} view={view} />
				<BoardView board={board} lists={lists} />
			</Page>
			{cardId && <CardDetail boardId={boardId} cardId={cardId} onClose={handleCloseCard} />}
		</Page>
	);
};

export default BoardRouter;
