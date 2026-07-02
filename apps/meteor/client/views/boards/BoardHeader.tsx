import type { IBoard, ISavedView, SavedViewType, Serialized } from '@rocket.chat/core-typings';
import { Box, ButtonGroup, Icon } from '@rocket.chat/fuselage';
import { PageHeader } from '@rocket.chat/ui-client';
import { useRouter } from '@rocket.chat/ui-contexts';
import { useCallback } from 'react';

import BoardStatusControl from './BoardStatusControl';
import { BoardAutomationsButton, BoardButtonsMenu } from './automation';
import BoardFormsButton from './forms/BoardFormsButton';
import { getPipelineTypeIcon } from './lib/icons';
import ViewSwitcher from './views/ViewSwitcher';

type BoardHeaderProps = {
	board: Serialized<IBoard>;
	view: string;
	activeViewId?: string;
	onSelectViewType: (viewType: SavedViewType) => void;
	onSelectSavedView: (view: Serialized<ISavedView>) => void;
};

const BoardHeader = ({ board, view, activeViewId, onSelectViewType, onSelectSavedView }: BoardHeaderProps) => {
	const router = useRouter();

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
			<Box display='flex' alignItems='center' justifyContent='space-between' width='100%' style={{ gap: '12px' }}>
				<Box flexGrow={1} minWidth={0}>
					<ViewSwitcher
						boardId={board._id}
						pipelineType={board.pipelineType}
						view={view}
						activeViewId={activeViewId}
						onSelectViewType={onSelectViewType}
						onSelectSavedView={onSelectSavedView}
					/>
				</Box>
				<ButtonGroup>
					<BoardStatusControl board={board} />
					<BoardFormsButton boardId={board._id} />
					<BoardButtonsMenu boardId={board._id} />
					<BoardAutomationsButton boardId={board._id} />
				</ButtonGroup>
			</Box>
		</PageHeader>
	);
};

export default BoardHeader;
