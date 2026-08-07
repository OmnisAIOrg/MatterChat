import {
	Box,
	Button,
	ButtonGroup,
	Icon,
	IconButton,
	States,
	StatesIcon,
	StatesTitle,
	StatesSubtitle,
	Throbber,
} from '@rocket.chat/fuselage';
import { Page, PageHeader, useThemeMode } from '@rocket.chat/ui-client';
import { useEndpoint, useRouteParameter, useRouter, useSetModal, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import LeadCaptureModal from './LeadCaptureModal';
import LeadsBoardView from './LeadsBoardView';
import { getLeadsTokens, LEADS_PAGE_TITLE_STYLE, LEADS_RADIUS } from './leadsDesignTokens';
import { BoardAutomationsButton } from '../automation';
import CardDetail from '../card/CardDetail';
import { CaseProStatusChip, CaseProStubBanner, useCaseProStubMode } from '../casepro';
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
	const dispatchToastMessage = useToastMessageDispatch();
	const [, , themeMode] = useThemeMode();
	const isDark = themeMode === 'dark';
	const tokens = getLeadsTokens(isDark);

	// Stub mode (per `boards.casepro.status`, falling back to the public
	// settings): the intake board runs local-only (no read-through pull /
	// write-through push), so we surface a banner and hide the Sync action.
	const caseProStub = useCaseProStubMode();

	// CardDetail drawer is opened via ?cardId= on this route.
	const cardId = useRouteParameter('cardId');

	const ensureLeadsBoard = useEndpoint('POST', '/v1/boards.leads.ensureBoard');
	const syncFromCasePro = useEndpoint('POST', '/v1/boards.leads.syncFromCasePro');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'leads', 'ensureBoard'],
		queryFn: () => ensureLeadsBoard({}),
		staleTime: Infinity,
	});

	const board = data?.board;
	const boardId = board?._id;

	const syncMutation = useMutation({
		mutationFn: () => syncFromCasePro({}),
		onSuccess: (result) => {
			const { total, created, updated, skipped } = result;
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Leads_Sync_Result', {
					created,
					updated,
					skipped,
					total,
					defaultValue: 'Pulled {{total}} intakes ({{created}} new, {{updated}} updated, {{skipped}} skipped)',
				}),
			});
			// Refresh the kanban cards so newly pulled / restaged leads appear.
			if (result.boardId) {
				void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', result.boardId] });
			} else if (boardId) {
				void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
			}
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

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

	// Leads Board Premium Refresh — uses new LeadsBoardView with design-token styled
	// kanban columns, cards, and header. Header wraps with backdrop-blur glass effect.
	return (
		<Page flexDirection='row' background='room' style={{ backgroundColor: tokens.bg }}>
			<Page background='room' style={{ backgroundColor: tokens.bg }}>
				<Box
					style={{
						backdropFilter: 'blur(14px)',
						WebkitBackdropFilter: 'blur(14px)',
						backgroundColor: tokens.bgGlass,
						borderBottom: `1px solid ${tokens.border}`,
						padding: '14px 24px',
						display: 'flex',
						alignItems: 'center',
						gap: '12px',
						flexShrink: 0,
					}}
				>
					<Box
						display='flex'
						justifyContent='center'
						alignItems='center'
						style={{
							width: '30px',
							height: '30px',
							borderRadius: LEADS_RADIUS.button,
							backgroundColor: tokens.greenSoft,
							border: `1px solid ${tokens.greenLine}`,
							color: tokens.greenInk,
							flexShrink: 0,
						}}
					>
						<Icon name={getPipelineTypeIcon('leads')} size='x16' />
					</Box>
					<h1
						style={{
							...LEADS_PAGE_TITLE_STYLE,
							color: tokens.ink,
							margin: 0,
						}}
					>
						{board.title}
					</h1>
					<Box style={{ flex: 1 }} />
					<CaseProStatusChip marginInlineEnd={4} />
					<ButtonGroup>
						{!caseProStub && (
							<IconButton
								small
								icon='reload'
								onClick={() => syncMutation.mutate()}
								disabled={syncMutation.isPending}
								title={t('Boards_Leads_SyncFromCasePro', { defaultValue: 'Sync from CasePro' })}
								aria-label={t('Boards_Leads_SyncFromCasePro', { defaultValue: 'Sync from CasePro' })}
							/>
						)}
						<BoardAutomationsButton boardId={board._id} />
						<Button
							primary
							small
							onClick={handleNewLead}
							style={{
								backgroundColor: tokens.green,
								borderColor: tokens.green,
								color: tokens.onGreen,
								borderRadius: LEADS_RADIUS.button,
							}}
						>
							<Icon name='plus' size='x16' marginInlineEnd={4} />
							{t('Boards_New_Lead', { defaultValue: 'New Lead' })}
						</Button>
					</ButtonGroup>
				</Box>
				<CaseProStubBanner variant='leads' paddingInline={24} paddingBlockStart={16} />
				<LeadsBoardView board={board} lists={lists} />
			</Page>
			{cardId && boardId && <CardDetail boardId={boardId} cardId={cardId} onClose={handleCloseCard} />}
		</Page>
	);
};

export default LeadsBoardRoute;
