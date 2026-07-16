import type { IBoardDeadline, IMatterSnapshot, IRoom, Serialized } from '@rocket.chat/core-typings';
import { Box, IconButton, Tag } from '@rocket.chat/fuselage';
import { useResizeObserver } from '@rocket.chat/fuselage-hooks';
import { useEndpoint, useRouter, useSetModal, useSetting } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import MatterDocketRibbon from './MatterDocketRibbon';
import MatterFilesModal from '../../boards/card/MatterFilesModal';
import { daysUntil, fmtCurrency, fmtDate, riskTagVariant, solRiskVariant } from '../../boards/card/matter/matterFormatters';

// Width breakpoints for the "never wrap; shed data instead" rule: money sheds first
// (higher threshold), then the next-deadline (lower). Below both, only identity/stage/SOL remain.
const SHOW_MONEY_MIN_PX = 560;
const SHOW_DEADLINE_MIN_PX = 440;

const RESOLVED_STATUSES: ReadonlyArray<Serialized<IBoardDeadline>['status']> = ['satisfied', 'waived', 'missed'];

const kindLabel: Record<Serialized<IBoardDeadline>['kind'], string> = {
	SOL: 'SOL',
	filing: 'Filing',
	discovery: 'Discovery',
	mediation: 'Mediation',
	response: 'Response',
	custom: 'Deadline',
};

/**
 * "Open in CasePro" resolves against the admin-configured CasePro_Web_URL — same
 * contract MatterHeader uses. Returns undefined when unset so the action is hidden.
 */
const buildCaseProHref = (caseProWebUrl: unknown, matterId: string): string | undefined => {
	const base = (typeof caseProWebUrl === 'string' ? caseProWebUrl : '').trim().replace(/\/+$/, '');
	return base ? `${base}/matters/${matterId}` : undefined;
};

type MatterHeaderBannerContentProps = {
	room: Pick<IRoom, '_id' | 'name' | 'fname' | 'matterId' | 'matterCardId'>;
};

/**
 * The matter-context strip: one dense, ledger-style row flush under the room header
 * (never wraps to a second line) reading, left→right —
 *   client name (bold) · stage tag · live SOL countdown tag (amber <90d / red <30d) ·
 *   Billed / Balance (tabular figures) · next open deadline —
 * with the actions collapsed to icon buttons at the right end (Open in CasePro,
 * Files, Open Matter Workspace). A 2px docket ribbon under the row plots the
 * matter's deadlines on the incident→SOL timeline.
 *
 * Reads the live CasePro snapshot (same react-query key/endpoint MatterPanel uses)
 * and the card's deadlines (same key DeadlinesSection uses) — both shared cache
 * entries. Renders nothing while loading, on error, or with no snapshot; the whole
 * thing sits inside the sibling MatterHeaderBanner error boundary so it can never
 * white-screen the room.
 */
const MatterHeaderBannerContent = ({ room }: MatterHeaderBannerContentProps): ReactElement | null => {
	const { t } = useTranslation();
	const router = useRouter();
	const setModal = useSetModal();
	const caseProWebUrl = useSetting('CasePro_Web_URL', '');

	const { ref, borderBoxSize } = useResizeObserver<HTMLDivElement>();
	const width = borderBoxSize.inlineSize || Infinity;

	const { matterId } = room;
	const { matterCardId } = room;

	const getSnapshot = useEndpoint('GET', '/v1/boards.casepro.matterSnapshot');
	const { data, isLoading, isError } = useQuery({
		queryKey: ['boards', 'casepro', 'snapshot', matterId],
		queryFn: () => getSnapshot({ matterId: matterId as string }),
		enabled: Boolean(matterId),
	});

	// Deadlines (for the next-deadline segment + docket ribbon). Keyed like DeadlinesSection
	// so it shares that cache; only fetched when the channel knows its card.
	const listDeadlines = useEndpoint('GET', '/v1/boards.matters.deadlines.list');
	const { data: deadlinesData } = useQuery({
		queryKey: ['boards', 'matters', 'deadlines', 'card', matterCardId],
		queryFn: () => listDeadlines({ cardId: matterCardId as string }),
		enabled: Boolean(matterCardId),
	});
	const deadlines = useMemo<Serialized<IBoardDeadline>[]>(
		() => (deadlinesData?.deadlines as Serialized<IBoardDeadline>[] | undefined) ?? [],
		[deadlinesData],
	);

	// Soonest unresolved deadline — the "what's next" the row surfaces.
	const nextDeadline = useMemo<Serialized<IBoardDeadline> | undefined>(() => {
		return deadlines
			.filter((d) => !RESOLVED_STATUSES.includes(d.status) && daysUntil(d.dueDate) !== undefined)
			.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
	}, [deadlines]);

	const snapshot: Serialized<IMatterSnapshot> | undefined = data?.snapshot;

	if (!matterId || isLoading || isError || !snapshot) {
		return null;
	}

	const clientName = snapshot.clientName || snapshot.matterName || room.fname || room.name;

	// SOL countdown — same client-side risk math as KeyDatesStrip (amber <90d, red <30d/passed).
	const solDays = daysUntil(snapshot.solDate);
	const solDate = fmtDate(snapshot.solDate);
	const solText = ((): string | undefined => {
		if (!solDate) {
			return undefined;
		}
		if (solDays === undefined) {
			return solDate;
		}
		if (solDays < 0) {
			return t('Boards_Matters_SOL_Passed', { date: solDate, defaultValue: '{{date}} (passed)' });
		}
		return t('Boards_Matters_SOL_In_Days', { date: solDate, days: solDays, defaultValue: '{{date}} ({{days}}d)' });
	})();

	const billed = fmtCurrency(snapshot.totalBilled);
	const balance = fmtCurrency(snapshot.totalBalance);
	const moneyText = billed && balance ? `${billed} / ${balance}` : billed || balance;

	const nextDeadlineText = nextDeadline
		? `${nextDeadline.label || kindLabel[nextDeadline.kind]} ${fmtDate(nextDeadline.dueDate)}`
		: undefined;

	const caseProHref = buildCaseProHref(caseProWebUrl, matterId);
	const { litboxWorkspaceId } = snapshot;

	const openFiles = (): void => {
		if (!litboxWorkspaceId) {
			return;
		}
		setModal(<MatterFilesModal workspaceId={litboxWorkspaceId} label={clientName} onClose={(): void => setModal(null)} />);
	};

	// Open Matter Workspace — deep-link the matter card in the Matters pipeline board via its
	// cardId; fall back to the Matters board when the card id is unknown.
	const openWorkspace = (): void => {
		router.navigate(matterCardId ? { name: 'boards-matters', params: { cardId: matterCardId } } : { name: 'boards-matters' });
	};

	// Build the row as separator-joined segments so chrome stays minimal and empty data drops out.
	const segments: { key: string; node: ReactNode }[] = [];
	if (clientName) {
		segments.push({
			key: 'client',
			node: (
				<Box is='span' fontScale='p2' color='default' withTruncatedText style={{ fontWeight: 600, maxWidth: '240px' }}>
					{clientName}
				</Box>
			),
		});
	}
	if (snapshot.stageName) {
		segments.push({ key: 'stage', node: <Tag>{snapshot.stageName}</Tag> });
	}
	if (solText) {
		segments.push({
			key: 'sol',
			node: (
				<Tag variant={riskTagVariant(solRiskVariant(solDays))} title={t('Boards_Matters_SOL', { defaultValue: 'SOL' })}>
					{t('Boards_Matters_SOL', { defaultValue: 'SOL' })} {solText}
				</Tag>
			),
		});
	}
	if (moneyText && width >= SHOW_MONEY_MIN_PX) {
		segments.push({
			key: 'money',
			node: (
				<Box
					is='span'
					fontScale='c1'
					color='hint'
					title={`${t('Boards_Matters_Billed', { defaultValue: 'Billed' })} / ${t('Boards_Matters_Balance', { defaultValue: 'Balance' })}`}
					style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
				>
					{moneyText}
				</Box>
			),
		});
	}
	if (nextDeadlineText && width >= SHOW_DEADLINE_MIN_PX) {
		segments.push({
			key: 'deadline',
			node: (
				<Box is='span' fontScale='c1' color='hint' withTruncatedText style={{ maxWidth: '200px' }}>
					{nextDeadlineText}
				</Box>
			),
		});
	}

	return (
		<Box
			ref={ref}
			role='region'
			aria-label={t('Boards_Matters_Linked_Matter', { defaultValue: 'Linked Matter' })}
			bg='tint'
			style={{ borderBlockEnd: '1px solid var(--rcx-color-stroke-extra-light, transparent)' }}
		>
			<Box display='flex' alignItems='center' pi={16} style={{ minHeight: '38px', gap: '8px', overflow: 'hidden', flexWrap: 'nowrap' }}>
				{/* Ledger row (grows, clips before it ever wraps) */}
				<Box display='flex' alignItems='center' flexGrow={1} style={{ minWidth: 0, gap: '8px', overflow: 'hidden', flexWrap: 'nowrap' }}>
					{segments.map((segment, index) => (
						<Box key={segment.key} display='flex' alignItems='center' style={{ gap: '8px', minWidth: 0 }}>
							{index > 0 && (
								<Box is='span' color='hint' aria-hidden style={{ opacity: 0.6 }}>
									·
								</Box>
							)}
							{segment.node}
						</Box>
					))}
				</Box>

				{/* Actions — compact icon buttons, always visible at the right end */}
				<Box display='flex' alignItems='center' flexShrink={0} style={{ gap: '2px' }}>
					{caseProHref && (
						<IconButton
							small
							is='a'
							href={caseProHref}
							target='_blank'
							rel='noopener noreferrer'
							icon='new-window'
							title={t('Boards_Matters_Open_In_CasePro', { defaultValue: 'Open in CasePro' })}
							aria-label={t('Boards_Matters_Open_In_CasePro', { defaultValue: 'Open in CasePro' })}
						/>
					)}
					{litboxWorkspaceId && (
						<IconButton
							small
							icon='folder'
							onClick={openFiles}
							title={t('Boards_Matters_Files', { defaultValue: 'Files' })}
							aria-label={t('Boards_Matters_Files', { defaultValue: 'Files' })}
						/>
					)}
					<IconButton
						small
						icon='arrow-jump'
						onClick={openWorkspace}
						title={t('Boards_Matters_Open_Workspace', { defaultValue: 'Open Matter Workspace' })}
						aria-label={t('Boards_Matters_Open_Workspace', { defaultValue: 'Open Matter Workspace' })}
					/>
				</Box>
			</Box>

			{/* 2px docket ribbon: deadlines plotted on the incident→SOL timeline. */}
			<MatterDocketRibbon deadlines={deadlines} incidentDate={snapshot.incidentDate} solDate={snapshot.solDate} />
		</Box>
	);
};

export default MatterHeaderBannerContent;
