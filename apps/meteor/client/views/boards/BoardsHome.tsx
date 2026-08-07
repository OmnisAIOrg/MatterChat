import type { IBoard, BoardsPipelineType } from '@rocket.chat/core-typings';
import {
	Box,
	Button,
	Card,
	CardBody,
	CardTitle,
	Icon,
	States,
	StatesIcon,
	StatesTitle,
	StatesSubtitle,
	Throbber,
} from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint, useMethod, useRouter, useSetModal, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import NewBoardModal from './NewBoardModal';
import type { NewBoardFormValues } from './NewBoardModal';
import LedgerPageStyleTag from './lib/LedgerPageStyleTag';
import { getPipelineTypeIcon } from './lib/icons';
import { monoLabel, serifCaption, useLedgerTones } from './lib/ledgerTheme';

const PIPELINE_GROUPS: { type: BoardsPipelineType; labelKey: 'Boards_General' | 'Boards_Matters' | 'Boards_Leads' }[] = [
	{ type: 'matters', labelKey: 'Boards_Matters' },
	{ type: 'leads', labelKey: 'Boards_Leads' },
	{ type: 'general', labelKey: 'Boards_General' },
];

const BoardsHome = () => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const router = useRouter();
	const setModal = useSetModal();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const listBoards = useEndpoint('GET', '/v1/boards.list');
	const createBoard = useMethod('boards.createBoard');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'list'],
		queryFn: () => listBoards({ count: 100 }),
	});

	const createMutation = useMutation({
		mutationFn: (values: NewBoardFormValues) => createBoard({ title: values.title, pipelineType: values.pipelineType }),
		onSuccess: (board: IBoard) => {
			dispatchToastMessage({ type: 'success', message: t('Boards_New_Board') });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'list'] });
			router.navigate({ name: 'boards-board', params: { id: board._id } });
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	const handleNewBoard = useCallback(() => {
		const onConfirm = async (values: NewBoardFormValues): Promise<void> => {
			await createMutation.mutateAsync(values);
			setModal(null);
		};
		setModal(<NewBoardModal onConfirm={onConfirm} onClose={() => setModal(null)} />);
	}, [createMutation, setModal]);

	const openBoard = useCallback(
		(boardId: string) => () => {
			router.navigate({ name: 'boards-board', params: { id: boardId } });
		},
		[router],
	);

	const boards = data?.boards ?? [];

	const grouped = PIPELINE_GROUPS.map((group) => ({
		...group,
		boards: boards.filter((board) => board.pipelineType === group.type),
	})).filter((group) => group.boards.length > 0);

	return (
		// Ledger-dense skin (style-only): paper page ground + serif caption title —
		// parity with the redesigned Caseload/Reports/Calendars siblings.
		<Page className='mcLedgerPage' style={{ background: tones.paper }}>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='squares' size='x24' marginInlineEnd={8} style={{ color: tones.green }} />
						<Box withTruncatedText style={serifCaption}>
							{t('Boards')}
						</Box>
					</Box>
				}
			>
				<Button primary onClick={handleNewBoard} disabled={createMutation.isPending}>
					<Icon name='plus' size='x16' marginInlineEnd={4} />
					{t('Boards_New_Board')}
				</Button>
			</PageHeader>
			<PageScrollableContentWithShadow>
				{/* Static, theme-derived constant string — the shared ledger table/card skin. */}
				<LedgerPageStyleTag />
				{isLoading && (
					<Box display='flex' justifyContent='center' padding={24}>
						<Throbber />
					</Box>
				)}

				{isError && (
					<States>
						<StatesIcon name='warning' variation='danger' />
						<StatesTitle>{t('Something_went_wrong')}</StatesTitle>
						<StatesSubtitle>
							<Button small onClick={() => refetch()}>
								{t('Reload_page')}
							</Button>
						</StatesSubtitle>
					</States>
				)}

				{!isLoading && !isError && boards.length === 0 && (
					<States>
						<StatesIcon name='squares' />
						<StatesTitle>{t('Boards')}</StatesTitle>
						<StatesSubtitle>{t('No_results_found')}</StatesSubtitle>
						<Box marginBlockStart={16}>
							<Button primary onClick={handleNewBoard}>
								<Icon name='plus' size='x16' marginInlineEnd={4} />
								{t('Boards_New_Board')}
							</Button>
						</Box>
					</States>
				)}

				{grouped.map((group) => (
					<Box key={group.type} marginBlockEnd={20}>
						{/* Mono "docket stamp" group eyebrow — replaces the airy stock h4. */}
						<Box marginBlockEnd={8} style={monoLabel(tones)}>
							{t(group.labelKey)}
						</Box>
						<Box display='flex' flexWrap='wrap' style={{ gap: '10px' }}>
							{group.boards.map((board) => (
								<Card
									key={board._id}
									clickable
									onClick={openBoard(board._id)}
									role='link'
									tabIndex={0}
									aria-label={board.title}
									style={{ width: 240 }}
								>
									<CardTitle>
										<Box display='flex' alignItems='center'>
											<Icon name={getPipelineTypeIcon(board.pipelineType)} size='x20' marginInlineEnd={8} color='hint' />
											<Box withTruncatedText>{board.title}</Box>
										</Box>
									</CardTitle>
									<CardBody>
										<Box fontScale='c1' color='hint' withTruncatedText>
											{board.description || t(`Boards_Pipeline_${board.pipelineType}` as const)}
										</Box>
									</CardBody>
								</Card>
							))}
						</Box>
					</Box>
				))}
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default BoardsHome;
