import type { IBoardCard, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Callout, Divider, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, usePermission, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import AiAssistSection from './AiAssistSection';
import { CaseProStubBanner } from '../casepro';
import ChannelSection from './matter/ChannelSection';
import DeadlinesSection from './matter/DeadlinesSection';
import FinancialSummaryCard from './matter/FinancialSummaryCard';
import IntegrationsSection from './matter/IntegrationsSection';
import KeyDatesStrip from './matter/KeyDatesStrip';
import LitigationSection from './matter/LitigationSection';
import MatterHeader from './matter/MatterHeader';
import PlaybooksSection from './matter/PlaybooksSection';
import { isSnapshotOld } from './matter/matterFormatters';

/**
 * MatterPanel — the Matter Workspace: the legal-staff face of a board card
 * whose `link.kind === 'matter'`, rendered by card/CardDetail.tsx inside the
 * Contextualbar (wrapped in CardErrorBoundary so a panel bug can never take
 * down the whole client again).
 *
 * Data model: CasePro is the system of record. The panel read-throughs the
 * live snapshot via `GET /v1/boards.casepro.matterSnapshot`; when that read
 * fails it falls back to the card's cached `link.snapshot` (flagged Stale)
 * so staff still see the last-known matter instead of a bare error. CasePro
 * fields are ALWAYS read-only here — display + Refresh, never fake
 * editability. Refresh re-reads the snapshot, and for holders of
 * `boards-casepro-sync` also rewrites the card's cached copy via
 * `POST /v1/boards.matters.refreshSnapshot`.
 *
 * Sections, top to bottom (board-owned data is independent of the snapshot):
 *  1. Header — name/number/client, stage + practice chips, stale indicator,
 *     Open-in-CasePro / Jump-to-channel / Refresh (matter/MatterHeader).
 *  2. Key dates — DOI, live SOL risk chip, demand-expiration chip
 *     (matter/KeyDatesStrip; client-side date math only).
 *  3. Financial summary — billed/balance/demand/offer/settlement + providers
 *     (matter/FinancialSummaryCard).
 *  4. Litigation & team — cause #, liability, team roster
 *     (matter/LitigationSection).
 *  5. Deadlines — the SOL/deadline engine: status tags, inline create,
 *     acknowledge, mark-satisfied (matter/DeadlinesSection).
 *  6. Playbooks — checklist progress + apply picker (matter/PlaybooksSection).
 *  7. Integrations — LitBox/MedChron presence tags (matter/IntegrationsSection).
 *  8. AI assist — summary + Stowers demand draft (AiAssistSection).
 *  9. Channel — link/unlink + comms-log status (matter/ChannelSection).
 *
 * Card-level editing (title/description/labels/checklists/subtasks/time/
 * comments) lives in CardDetail and is deliberately NOT duplicated here.
 *
 * NOTE: endpoint data is JSON-serialized over the wire, so Date fields arrive
 * as ISO strings — hence `Serialized<…>` and string-tolerant date helpers.
 */

type MatterPanelProps = {
	// Accept either a hydrated or serialized card; we read `_id`/`title`/`link`/`checklists`.
	// (CardDetail passes the full serialized card, so `_id` is present at runtime.)
	card: Pick<Serialized<IBoardCard>, '_id' | 'cardType' | 'title' | 'link' | 'checklists'>;
};

const MatterPanel = ({ card }: MatterPanelProps): ReactElement | null => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();
	const canSync = usePermission('boards-casepro-sync');

	const matterId = card.link?.kind === 'matter' ? card.link.matterId : undefined;

	const getSnapshot = useEndpoint('GET', '/v1/boards.casepro.matterSnapshot');
	const refreshSnapshot = useEndpoint('POST', '/v1/boards.matters.refreshSnapshot');

	const { data, isLoading, isError, refetch, isFetching } = useQuery({
		queryKey: ['boards', 'casepro', 'snapshot', matterId],
		queryFn: () => getSnapshot({ matterId: matterId as string }),
		enabled: Boolean(matterId),
	});

	// Refresh = re-read the live snapshot; sync-capable users also rewrite the
	// card's cached copy so everyone else's fallback stays fresh.
	const refreshMutation = useMutation({
		mutationFn: async () => {
			if (canSync) {
				await refreshSnapshot({ cardId: card._id });
			}
		},
		onSettled: () => {
			void refetch();
			void queryClient.invalidateQueries({ queryKey: ['boards', 'card', card._id] });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	// Only meaningful for matter cards.
	if (!matterId) {
		return null;
	}

	const liveSnapshot = data?.snapshot;
	const cachedSnapshot = card.link?.kind === 'matter' ? card.link.snapshot : undefined;
	// Live read first; on failure fall back to the card's cached snapshot (flagged stale below).
	const snapshot = liveSnapshot ?? (isError ? cachedSnapshot : undefined);
	const usingCachedFallback = !liveSnapshot && Boolean(snapshot);
	const showStale = Boolean(snapshot && (snapshot.stale || usingCachedFallback || isSnapshotOld(snapshot.fetchedAt)));

	return (
		<Box marginBlockStart={16}>
			<Divider />

			<MatterHeader
				matterId={matterId}
				cardTitle={card.title}
				snapshot={snapshot}
				link={card.link}
				showStale={showStale}
				isRefreshing={isFetching || refreshMutation.isPending}
				onRefresh={(): void => refreshMutation.mutate()}
			/>

			<CaseProStubBanner marginBlockStart={8} marginBlockEnd={12} />

			{isLoading && (
				<Box display='flex' justifyContent='center' padding={16}>
					<Throbber />
				</Box>
			)}

			{isError && !isLoading && (
				<Box marginBlockStart={8} marginBlockEnd={8}>
					{snapshot ? (
						<Callout type='warning' icon='warning' title={t('Boards_Matters_Cached_Snapshot', { defaultValue: 'Showing cached snapshot' })}>
							{t('Boards_Matters_Cached_Snapshot_Body', {
								defaultValue: 'CasePro could not be reached — this is the last snapshot saved on the card.',
							})}
						</Callout>
					) : (
						<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
							<Button small marginBlockStart={8} onClick={(): void => void refetch()}>
								{t('Retry')}
							</Button>
						</Callout>
					)}
				</Box>
			)}

			{!isLoading && !isError && !snapshot && (
				<Box fontScale='c1' color='hint' padding={8}>
					{t('No_results_found')}
				</Box>
			)}

			{/* CasePro snapshot sections (read-only render of the system of record) */}
			{snapshot && (
				<>
					<KeyDatesStrip snapshot={snapshot} />
					<FinancialSummaryCard snapshot={snapshot} />
					<LitigationSection snapshot={snapshot} />
				</>
			)}

			{/* Board-owned sections (deadlines/playbooks/AI/channel live on the card, independent of CasePro) */}
			<DeadlinesSection cardId={card._id} />
			<PlaybooksSection cardId={card._id} checklists={card.checklists} />
			{snapshot && <IntegrationsSection snapshot={snapshot} />}
			{/* AI assist (summary / Stowers demand draft); hidden without boards-ai-generate */}
			<AiAssistSection cardId={card._id} />
			<ChannelSection cardId={card._id} link={card.link} />
		</Box>
	);
};

export default MatterPanel;
