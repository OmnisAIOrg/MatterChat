import type { IBoardCard, IBoardDeadline, IMatterSnapshot, IPlaybookTemplate, Serialized } from '@rocket.chat/core-typings';
import {
	Box,
	Button,
	Callout,
	Chip,
	Divider,
	Icon,
	ProgressBar,
	Select,
	Tag,
	Throbber,
} from '@rocket.chat/fuselage';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AiAssistSection from './AiAssistSection';
import { CaseProStatusChip, CaseProStubBanner } from '../casepro';

/**
 * MatterPanel — the "Linked Matter" section of a board card detail (M3a client).
 *
 * Given a card whose `link.kind === 'matter'`, it read-throughs the CasePro
 * snapshot via `GET /v1/boards.casepro.matterSnapshot` and renders the matter's
 * CasePro identity + money + deadlines. The snapshot is NEVER the source of
 * truth — it is a cached render of CasePro, so we offer a Refresh and surface a
 * stub banner when CasePro is not live (mock data).
 *
 * The integrator renders this inside card/CardDetail.tsx, conditionally, when
 * `card.cardType === 'matter'` (and the link carries a matterId). See return summary.
 *
 * M5 adds two stacked sections below the CasePro snapshot:
 *  - Playbooks: checklist-progress for any applied stage playbook + an "apply
 *    playbook" picker (`boards.matters.playbooks.list` / `.apply`). The card's
 *    own checklists drive the progress bars; the hidden `__playbook:<id>` marker
 *    checklist that the server stamps for idempotency is filtered out.
 *  - Deadlines: the safety-critical SOL/deadline list for this card
 *    (`boards.matters.deadlines.list?cardId=…`) with SOL chips, red escalation on
 *    near/overdue high-risk deadlines, and an inline Acknowledge action
 *    (`.acknowledge`) — the server requires ack before a high-risk deadline can
 *    be resolved.
 *
 * NOTE: endpoint data is JSON-serialized over the wire, so `IMatterSnapshot` /
 * `IBoardDeadline` Date fields (incidentDate/solDate/demandExpiration/fetchedAt,
 * dueDate, …) arrive as ISO strings — hence `Serialized<…>` and string-tolerant
 * date helpers.
 */

type MatterPanelProps = {
	// Accept either a hydrated or serialized card; we read `_id`/`link`/`checklists`.
	// (CardDetail passes the full serialized card, so `_id` is present at runtime.)
	card: Pick<Serialized<IBoardCard>, '_id' | 'cardType' | 'link' | 'checklists'>;
};

const SOL_WARNING_DAYS = 90; // amber: within 90 days
const SOL_DANGER_DAYS = 30; // red: within 30 days (or already passed)

const fmtCurrency = (value?: number): string | undefined => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return undefined;
	}
	return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const fmtDate = (value?: string | Date): string | undefined => {
	if (!value) {
		return undefined;
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(d.getTime())) {
		return undefined;
	}
	return d.toLocaleDateString();
};

const daysUntil = (value?: string | Date): number | undefined => {
	if (!value) {
		return undefined;
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(d.getTime())) {
		return undefined;
	}
	return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

// A label/value row; renders nothing when the value is empty.
const Field = ({ label, children }: { label: string; children?: ReactNode }): ReactElement | null => {
	if (children === undefined || children === null || children === '') {
		return null;
	}
	return (
		<Box display='flex' justifyContent='space-between' alignItems='flex-start' mbe={6} style={{ gap: '12px' }}>
			<Box fontScale='c1' color='hint' style={{ flexShrink: 0 }}>
				{label}
			</Box>
			<Box fontScale='p2' color='default' style={{ textAlign: 'right' }}>
				{children}
			</Box>
		</Box>
	);
};

const SectionTitle = ({ children }: { children: ReactNode }): ReactElement => (
	<Box fontScale='p2b' color='default' mbs={16} mbe={8}>
		{children}
	</Box>
);

const SOL_DANGER_KINDS: ReadonlyArray<IBoardDeadline['kind']> = ['SOL', 'filing'];
const RESOLVED_STATUSES: ReadonlyArray<IBoardDeadline['status']> = ['satisfied', 'waived', 'missed'];

const kindLabelDefault: Record<IBoardDeadline['kind'], string> = {
	SOL: 'Statute of limitations',
	filing: 'Filing',
	discovery: 'Discovery',
	mediation: 'Mediation',
	response: 'Response',
	custom: 'Custom',
};

/**
 * Playbooks section — shows checklist-progress for every checklist on the card
 * (the playbook materializes named checklists), plus an "apply playbook" picker.
 * The hidden `__playbook:<id>` marker checklists the server stamps for
 * idempotency are filtered out of the display.
 */
const PlaybooksSection = ({
	cardId,
	checklists,
}: {
	cardId: string;
	checklists: Serialized<IBoardCard>['checklists'];
}): ReactElement => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();
	const [selected, setSelected] = useState<string | undefined>(undefined);

	const listPlaybooks = useEndpoint('GET', '/v1/boards.matters.playbooks.list');
	const applyPlaybook = useEndpoint('POST', '/v1/boards.matters.playbooks.apply');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'matters', 'playbooks', 'list'],
		queryFn: () => listPlaybooks({}),
	});

	const playbooks = useMemo<Serialized<IPlaybookTemplate>[]>(
		() => (data?.playbooks as Serialized<IPlaybookTemplate>[] | undefined)?.filter((p) => p.enabled) ?? [],
		[data],
	);

	const options = useMemo<[string, string][]>(() => playbooks.map((p) => [p._id, p.name] as [string, string]), [playbooks]);

	// Visible checklists exclude the hidden idempotency markers.
	const visibleChecklists = useMemo(
		() => checklists.filter((c) => !c.title.startsWith('__playbook:')),
		[checklists],
	);

	const applyMutation = useMutation({
		mutationFn: (playbookId: string) => applyPlaybook({ cardId, playbookId }),
		onSuccess: (result) => {
			const { checklistItemsAdded, deadlinesCreated } = result.result;
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Matters_Playbook_Applied_Result', {
					items: checklistItemsAdded,
					deadlines: deadlinesCreated,
					defaultValue: 'Applied playbook ({{items}} items, {{deadlines}} deadlines)',
				}),
			});
			setSelected(undefined);
			void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'matters', 'deadlines', 'card', cardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	return (
		<Box>
			<SectionTitle>{t('Boards_Matters_Playbooks', { defaultValue: 'Playbooks' })}</SectionTitle>

			{visibleChecklists.length === 0 && (
				<Box fontScale='c1' color='hint' mbe={8}>
					{t('No_results_found')}
				</Box>
			)}

			{visibleChecklists.map((checklist) => {
				const total = checklist.items.length;
				const done = checklist.items.filter((i) => i.done).length;
				const pct = total > 0 ? Math.round((done / total) * 100) : 0;
				return (
					<Box key={checklist.id} mbe={12}>
						<Box display='flex' justifyContent='space-between' alignItems='center' mbe={4}>
							<Box fontScale='p2' color='default' withTruncatedText>
								{checklist.title}
							</Box>
							<Box fontScale='c1' color='hint' style={{ flexShrink: 0 }}>
								{done}/{total}
							</Box>
						</Box>
						<ProgressBar percentage={pct} variant={pct === 100 ? 'success' : 'info'} />
					</Box>
				);
			})}

			{/* Apply playbook picker */}
			<Box display='flex' alignItems='center' mbs={8} style={{ gap: '8px' }}>
				<Box flexGrow={1}>
					<Select
						small
						placeholder={isLoading ? t('Loading') : t('Boards_Matters_Playbook', { defaultValue: 'Playbook' })}
						value={selected ?? null}
						options={options}
						disabled={isLoading || options.length === 0 || applyMutation.isPending}
						onChange={(value) => setSelected(value as string)}
					/>
				</Box>
				<Button
					small
					primary
					disabled={!selected || applyMutation.isPending}
					onClick={() => selected && applyMutation.mutate(selected)}
				>
					{applyMutation.isPending ? <Throbber inheritColor size='x12' /> : t('Boards_Matters_Playbook_Apply', { defaultValue: 'Apply playbook' })}
				</Button>
			</Box>
		</Box>
	);
};

/**
 * Deadlines section — the safety-critical SOL/deadline list for this card.
 * Red escalation for near/overdue high-risk deadlines; inline Acknowledge for
 * unacknowledged high-risk deadlines (server requires ack before resolution).
 */
const DeadlinesSection = ({ cardId }: { cardId: string }): ReactElement => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();

	const listDeadlines = useEndpoint('GET', '/v1/boards.matters.deadlines.list');
	const acknowledge = useEndpoint('POST', '/v1/boards.matters.deadlines.acknowledge');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'matters', 'deadlines', 'card', cardId],
		queryFn: () => listDeadlines({ cardId }),
	});

	const deadlines = useMemo<Serialized<IBoardDeadline>[]>(
		() => (data?.deadlines as Serialized<IBoardDeadline>[] | undefined) ?? [],
		[data],
	);

	const acknowledgeMutation = useMutation({
		mutationFn: (deadlineId: string) => acknowledge({ deadlineId }),
		onSuccess: () => {
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Matters_Deadline_Acknowledged', { defaultValue: 'Acknowledged' }),
			});
			void queryClient.invalidateQueries({ queryKey: ['boards', 'matters', 'deadlines', 'card', cardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	return (
		<Box>
			<SectionTitle>{t('Boards_Matters_Deadlines', { defaultValue: 'Deadlines' })}</SectionTitle>

			{isLoading && (
				<Box display='flex' justifyContent='center' p={8}>
					<Throbber size='x16' />
				</Box>
			)}

			{!isLoading && deadlines.length === 0 && (
				<Box fontScale='c1' color='hint' mbe={8}>
					{t('No_results_found')}
				</Box>
			)}

			{deadlines.map((deadline) => {
				const days = daysUntil(deadline.dueDate);
				const isHighRisk = deadline.highRisk ?? SOL_DANGER_KINDS.includes(deadline.kind);
				const isResolved = RESOLVED_STATUSES.includes(deadline.status);
				const variant: 'danger' | 'warning' | 'secondary' = (() => {
					if (isResolved || days === undefined) {
						return 'secondary';
					}
					if (days <= SOL_DANGER_DAYS) {
						return isHighRisk ? 'danger' : 'warning';
					}
					if (days <= SOL_WARNING_DAYS && isHighRisk) {
						return 'warning';
					}
					return 'secondary';
				})();
				const canAcknowledge = isHighRisk && !deadline.acknowledged && !isResolved;
				const dueLabel = (() => {
					const datePart = fmtDate(deadline.dueDate);
					if (!datePart) {
						return '—';
					}
					if (days === undefined || isResolved) {
						return datePart;
					}
					if (days < 0) {
						return t('Boards_Matters_SOL_Passed', { date: datePart, defaultValue: '{{date}} (passed)' });
					}
					return t('Boards_Matters_SOL_In_Days', { date: datePart, days, defaultValue: '{{date}} ({{days}}d)' });
				})();
				return (
					<Box key={deadline._id} display='flex' justifyContent='space-between' alignItems='flex-start' mbe={8} style={{ gap: '8px' }}>
						<Box display='flex' flexDirection='column' style={{ gap: '4px', minWidth: 0 }}>
							<Box display='flex' alignItems='center' flexWrap='wrap' style={{ gap: '4px' }}>
								<Tag variant={variant === 'secondary' ? 'secondary' : variant}>
									{t(`Boards_Matters_Deadline_Kind_${deadline.kind}`, { defaultValue: kindLabelDefault[deadline.kind] })}
								</Tag>
								{isHighRisk && !deadline.acknowledged && !isResolved && (
									<Tag variant='secondary-danger' medium>
										{t('Boards_Matters_Deadline_High_Risk', { defaultValue: 'High risk' })}
									</Tag>
								)}
								{deadline.acknowledged && (
									<Tag variant='secondary-info' medium>
										<Icon name='check' size='x12' mie={2} />
										{t('Boards_Matters_Deadline_Acknowledged', { defaultValue: 'Acknowledged' })}
									</Tag>
								)}
							</Box>
							<Box fontScale='c1' color='hint'>
								<Icon name='clock' size='x14' mie={4} />
								{t('Boards_Matters_Deadline_Due', { defaultValue: 'Due' })}: {dueLabel}
							</Box>
						</Box>
						{canAcknowledge && (
							<Button
								small
								primary
								disabled={acknowledgeMutation.isPending && acknowledgeMutation.variables === deadline._id}
								onClick={() => acknowledgeMutation.mutate(deadline._id)}
								style={{ flexShrink: 0 }}
							>
								{acknowledgeMutation.isPending && acknowledgeMutation.variables === deadline._id ? (
									<Throbber inheritColor size='x12' />
								) : (
									t('Boards_Matters_Deadline_Acknowledge', { defaultValue: 'Acknowledge' })
								)}
							</Button>
						)}
					</Box>
				);
			})}
		</Box>
	);
};

const MatterPanel = ({ card }: MatterPanelProps): ReactElement | null => {
	const { t } = useTranslation();

	const matterId = card.link?.kind === 'matter' ? card.link.matterId : undefined;

	const getSnapshot = useEndpoint('GET', '/v1/boards.casepro.matterSnapshot');

	const { data, isLoading, isError, refetch, isFetching } = useQuery({
		queryKey: ['boards', 'casepro', 'snapshot', matterId],
		queryFn: () => getSnapshot({ matterId: matterId as string }),
		enabled: Boolean(matterId),
	});

	// Only meaningful for matter cards.
	if (!matterId) {
		return null;
	}

	const snapshot = data?.snapshot as Serialized<IMatterSnapshot> | undefined;

	const solDays = daysUntil(snapshot?.solDate);
	const solVariant: 'danger' | 'warning' | 'secondary' =
		solDays === undefined ? 'secondary' : solDays <= SOL_DANGER_DAYS ? 'danger' : solDays <= SOL_WARNING_DAYS ? 'warning' : 'secondary';
	const solLabel = (() => {
		const datePart = fmtDate(snapshot?.solDate);
		if (!datePart) {
			return undefined;
		}
		if (solDays === undefined) {
			return datePart;
		}
		if (solDays < 0) {
			return t('Boards_Matters_SOL_Passed', { date: datePart, defaultValue: '{{date}} (passed)' });
		}
		return t('Boards_Matters_SOL_In_Days', { date: datePart, days: solDays, defaultValue: '{{date}} ({{days}}d)' });
	})();

	// "Open in" deep links. CasePro/LitBox/MedChron live behind their own apps;
	// we link by the snapshot handles. These are intentionally relative/handle
	// based so they resolve against whichever host the suite is deployed under.
	const caseProHref = `/admin/casepro/matters/${matterId}`;
	const litboxHref = snapshot?.litboxWorkspaceId ? `/admin/litbox/workspaces/${snapshot.litboxWorkspaceId}` : undefined;
	const medchronHref = snapshot?.medchronMatterId ? `/admin/medchron/matters/${snapshot.medchronMatterId}` : undefined;

	const team = snapshot?.team ?? [];
	const findRole = (re: RegExp): string | undefined => team.find((m) => re.test(m.role))?.name;
	const attorney = findRole(/attorney|lawyer/i);
	const caseManager = findRole(/case\s*manager|paralegal|cm/i);

	return (
		<Box mbs={16}>
			<Divider />
			<Box display='flex' alignItems='center' justifyContent='space-between' mbs={12} mbe={4}>
				<Box display='flex' alignItems='center'>
					<Icon name='bag' size='x20' mie={8} color='hint' />
					<Box fontScale='h4' color='default'>
						{t('Boards_Matters_Linked_Matter', { defaultValue: 'Linked Matter' })}
					</Box>
					<CaseProStatusChip mis={8} />
				</Box>
				<Button small square title={t('Refresh')} disabled={isFetching} onClick={() => refetch()}>
					{isFetching ? <Throbber inheritColor size='x12' /> : <Icon name='reload' size='x16' />}
				</Button>
			</Box>

			<CaseProStubBanner mbe={12} />

			{isLoading && (
				<Box display='flex' justifyContent='center' p={16}>
					<Throbber />
				</Box>
			)}

			{isError && !isLoading && (
				<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
					<Button small mbs={8} onClick={() => refetch()}>
						{t('Reload_page')}
					</Button>
				</Callout>
			)}

			{!isLoading && !isError && snapshot && (
				<Box>
					{/* Identity chips */}
					<Box display='flex' flexWrap='wrap' mbe={12} style={{ gap: '6px' }}>
						{snapshot.stageName && <Chip>{snapshot.stageName}</Chip>}
						{snapshot.subStageName && <Chip>{snapshot.subStageName}</Chip>}
						{snapshot.practiceArea && <Tag variant='secondary-info'>{snapshot.practiceArea}</Tag>}
						{solLabel && (
							<Tag variant={solVariant === 'secondary' ? 'secondary' : solVariant}>
								<Icon name='clock' size='x12' mie={4} />
								{t('Boards_Matters_SOL', { defaultValue: 'SOL' })}: {solLabel}
							</Tag>
						)}
					</Box>

					{/* Matter identity */}
					<SectionTitle>{t('Boards_Matters_Matter', { defaultValue: 'Matter' })}</SectionTitle>
					<Field label={t('Client')}>{snapshot.clientName}</Field>
					<Field label={t('Boards_Matters_Matter_Number', { defaultValue: 'Matter #' })}>{snapshot.matterNumber}</Field>
					<Field label={t('Boards_Matters_Cause_Number', { defaultValue: 'Cause #' })}>{snapshot.causeNumber}</Field>
					<Field label={t('Boards_Matters_Practice_Area', { defaultValue: 'Practice area' })}>{snapshot.practiceArea}</Field>
					<Field label={t('Boards_Matters_Stage', { defaultValue: 'Stage' })}>
						{snapshot.subStageName ? `${snapshot.stageName ?? ''} · ${snapshot.subStageName}` : snapshot.stageName}
					</Field>
					<Field label={t('Boards_Matters_DOI', { defaultValue: 'Date of incident' })}>{fmtDate(snapshot.incidentDate)}</Field>
					<Field label={t('Boards_Matters_SOL', { defaultValue: 'SOL' })}>{fmtDate(snapshot.solDate)}</Field>
					<Field label={t('Boards_Matters_Liability', { defaultValue: 'Liability' })}>{snapshot.liabilityStatus}</Field>

					{/* Team */}
					{(attorney || caseManager || team.length > 0) && (
						<>
							<SectionTitle>{t('Boards_Matters_Team', { defaultValue: 'Team' })}</SectionTitle>
							<Field label={t('Boards_Matters_Attorney', { defaultValue: 'Attorney' })}>{attorney}</Field>
							<Field label={t('Boards_Matters_Case_Manager', { defaultValue: 'Case manager' })}>{caseManager}</Field>
							{team
								.filter((m) => m.name !== attorney && m.name !== caseManager)
								.map((m, i) => (
									<Field key={`${m.role}-${i}`} label={m.role}>
										{m.name}
									</Field>
								))}
						</>
					)}

					{/* Medical / damages */}
					<SectionTitle>{t('Boards_Matters_Medical', { defaultValue: 'Medical' })}</SectionTitle>
					<Field label={t('Boards_Matters_Providers', { defaultValue: 'Providers' })}>{snapshot.providerCount}</Field>
					<Field label={t('Boards_Matters_Total_Billed', { defaultValue: 'Total billed' })}>
						{fmtCurrency(snapshot.totalBilled)}
					</Field>
					<Field label={t('Boards_Matters_Total_Balance', { defaultValue: 'Total balance' })}>
						{fmtCurrency(snapshot.totalBalance)}
					</Field>

					{/* Negotiation / resolution */}
					<SectionTitle>{t('Boards_Matters_Negotiation', { defaultValue: 'Negotiation' })}</SectionTitle>
					<Field label={t('Boards_Matters_Demand', { defaultValue: 'Demand' })}>
						{fmtCurrency(snapshot.lastDemandAmount)}
						{snapshot.demandExpiration ? (
							<Box is='span' fontScale='c1' color='hint'>
								{' '}
								({t('Boards_Matters_Due', { defaultValue: 'due' })} {fmtDate(snapshot.demandExpiration)})
							</Box>
						) : null}
					</Field>
					<Field label={t('Boards_Matters_Top_Offer', { defaultValue: 'Top offer' })}>
						{fmtCurrency(snapshot.lastOfferAmount)}
					</Field>
					<Field label={t('Boards_Matters_Settlement', { defaultValue: 'Settlement' })}>
						{fmtCurrency(snapshot.settlementAmount)}
					</Field>

					{/* Freshness footer */}
					<Box fontScale='micro' color='hint' mbs={12}>
						{snapshot.stale && (
							<Tag variant='secondary-warning' medium>
								{t('Boards_Matters_Stale', { defaultValue: 'Stale' })}
							</Tag>
						)}{' '}
						{fmtDate(snapshot.fetchedAt) &&
							t('Boards_Matters_Fetched_At', { date: fmtDate(snapshot.fetchedAt), defaultValue: 'Updated {{date}}' })}
					</Box>

					{/* Open-in deep links */}
					<Box display='flex' flexWrap='wrap' mbs={16} style={{ gap: '8px' }}>
						<Button small is='a' href={caseProHref} target='_blank' rel='noopener noreferrer'>
							<Icon name='new-window' size='x16' mie={4} />
							{t('Boards_Matters_Open_In_CasePro', { defaultValue: 'Open in CasePro' })}
						</Button>
						{litboxHref && (
							<Button small is='a' href={litboxHref} target='_blank' rel='noopener noreferrer'>
								<Icon name='clip' size='x16' mie={4} />
								{t('Boards_Matters_Open_In_LitBox', { defaultValue: 'Open in LitBox' })}
							</Button>
						)}
						{medchronHref && (
							<Button small is='a' href={medchronHref} target='_blank' rel='noopener noreferrer'>
								<Icon name='file' size='x16' mie={4} />
								{t('Boards_Matters_Open_In_MedChron', { defaultValue: 'Open in MedChron' })}
							</Button>
						)}
					</Box>
				</Box>
			)}

			{!isLoading && !isError && !snapshot && (
				<Box fontScale='c1' color='hint' p={8}>
					{t('No_results_found')}
				</Box>
			)}

			{/* M5 — Playbooks + Deadlines (board data; independent of the CasePro snapshot) */}
			{card._id && (
				<>
					<PlaybooksSection cardId={card._id} checklists={card.checklists} />
					<DeadlinesSection cardId={card._id} />
					{/* M8 — AI assist (summary / Stowers demand draft); hidden without boards-ai-generate */}
					<AiAssistSection cardId={card._id} />
				</>
			)}
		</Box>
	);
};

export default MatterPanel;
