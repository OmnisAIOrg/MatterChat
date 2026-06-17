import type { IBoard, Serialized } from '@rocket.chat/core-typings';
import { Box, ButtonGroup, Icon, Tabs } from '@rocket.chat/fuselage';
import { PageHeader } from '@rocket.chat/ui-client';
import { useRouter } from '@rocket.chat/ui-contexts';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { BoardAutomationsButton } from './automation';
import { getPipelineTypeIcon } from './lib/icons';

type BoardView = 'board' | 'calendar' | 'table';

type BoardHeaderProps = {
	board: Serialized<IBoard>;
	view: string;
};

const BoardHeader = ({ board, view }: BoardHeaderProps) => {
	const { t } = useTranslation();
	const router = useRouter();

	const goToView = useCallback(
		(nextView: BoardView) => () => {
			router.navigate({ name: 'boards-board', params: { id: board._id, view: nextView } });
		},
		[board._id, router],
	);

	const goHome = useCallback(() => {
		router.navigate({ name: 'boards-index' });
	}, [router]);

	return (
		<PageHeader
			title={
				<Box display='flex' alignItems='center'>
					<Icon name={getPipelineTypeIcon(board.pipelineType)} size='x24' mie={8} color='hint' />
					<Box withTruncatedText>{board.title}</Box>
				</Box>
			}
			onClickBack={goHome}
		>
			<Box display='flex' alignItems='center' justifyContent='space-between' width='100%'>
				<Tabs>
					<Tabs.Item selected={view === 'board'} onClick={goToView('board')}>
						{t('Boards_View_Board')}
					</Tabs.Item>
					<Tabs.Item selected={view === 'calendar'} onClick={goToView('calendar')}>
						{t('Boards_View_Calendar')}
					</Tabs.Item>
					<Tabs.Item selected={view === 'table'} onClick={goToView('table')}>
						{t('Boards_View_Table')}
					</Tabs.Item>
				</Tabs>
				<ButtonGroup>
					<BoardAutomationsButton boardId={board._id} />
				</ButtonGroup>
			</Box>
		</PageHeader>
	);
};

export default BoardHeader;
