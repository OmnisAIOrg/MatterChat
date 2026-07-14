import type { IBoard, ISavedView, SavedViewType, Serialized } from '@rocket.chat/core-typings';
import { Box, ButtonGroup, Icon } from '@rocket.chat/fuselage';
import { PageHeader } from '@rocket.chat/ui-client';
import { useEndpoint, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BoardStatusControl from './BoardStatusControl';
import { BoardAutomationsButton, BoardButtonsMenu } from './automation';
import { CaseProConnectionControls, CaseProStatusChip } from './casepro';
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
	const { t } = useTranslation();
	const router = useRouter();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const goHome = useCallback(() => {
		router.navigate({ name: 'boards-index' });
	}, [router]);

	// CasePro connection cluster — the dedicated routes (/boards/matters,
	// /boards/leads) mount it themselves, but a board opened BY ID (e.g. from
	// "All boards", route /boards/board/:id) renders through this generic
	// header, so it must mount here too or CasePro-synced boards lose their
	// status chip and Sync/Test actions. Mirrors MattersBoardRoute's
	// seedFromCasePro wiring (same endpoint, toast and cards invalidation);
	// leads boards get the chip only, exactly like LeadsBoardRoute.
	const [lastSyncAt, setLastSyncAt] = useState<Date | undefined>();
	const seedFromCasePro = useEndpoint('POST', '/v1/boards.matters.seedFromCasePro');
	const seedMutation = useMutation({
		mutationFn: () => seedFromCasePro({ boardId: board._id }),
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
			// Refresh the kanban card list so newly bound matters appear.
			void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', board._id] });
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	const handleSync = useCallback(() => {
		seedMutation.mutate();
	}, [seedMutation]);

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
				{/* The ViewSwitcher tab strip must live in its OWN scroll container: Fuselage
				    Tabs.Item buttons don't flex-shrink, so at narrow widths (~1280px viewport
				    with the boards sidebar open) the 5-tab strip painted OVER the CasePro
				    Test-connection/Sync cluster and intercepted its clicks. minWidth:0 lets the
				    box shrink; overflow-x:auto clips + scrolls the tabs inside it instead of
				    letting them overlap the controls to the right. No control is hidden. */}
				<Box flexGrow={1} minWidth={0} style={{ overflowX: 'auto', overflowY: 'hidden' }}>
					<ViewSwitcher
						boardId={board._id}
						pipelineType={board.pipelineType}
						view={view}
						activeViewId={activeViewId}
						onSelectViewType={onSelectViewType}
						onSelectSavedView={onSelectSavedView}
					/>
				</Box>
				{board.pipelineType === 'matters' && (
					<CaseProConnectionControls onSync={handleSync} isSyncing={seedMutation.isPending} lastSyncAt={lastSyncAt} mie={8} />
				)}
				{board.pipelineType === 'leads' && <CaseProStatusChip mie={8} />}
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
