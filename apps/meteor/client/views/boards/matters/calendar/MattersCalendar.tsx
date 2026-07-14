import type { IBoardDeadline, Serialized } from '@rocket.chat/core-typings';
import {
	Box,
	Button,
	Icon,
	States,
	StatesIcon,
	StatesTitle,
	StatesSubtitle,
	Tag,
	Throbber,
} from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';

/**
 * MattersCalendar — the `/boards/matters/calendar` view (M5 client).
 *
 * A board-wide agenda of SOL + deadlines (the safety-critical engine,
 * differentiators.md §4). On mount it resolves the canonical matters board via
 * `boards.matters.ensureBoard`, then reads every deadline on the board via
 * `GET /v1/boards.matters.deadlines.list?boardId=…` and groups them into time
 * buckets (Overdue / This week / This month / Later / Resolved).
 *
 * Escalation: high-risk (SOL/filing) deadlines that are overdue or due within
 * 30 days render red; within 90 days amber. High-risk deadlines that are still
 * open can be acknowledged inline (`POST /v1/boards.matters.deadlines.acknowledge`)
 * — the server requires acknowledgement before such a deadline can be resolved.
 *
 * Date fields arrive JSON-serialized (ISO strings), hence `Serialized<IBoardDeadline>`
 * and string-tolerant date helpers — mirrors MatterPanel.tsx.
 *
 * Wiring: register at route name `boards-matters-calendar`
 * (path `/boards/matters/calendar`) gated by `boards-matters-view`.
 * See return summary.
 */

const SOL_WARNING_DAYS = 90; // amber: within 90 days
const SOL_DANGER_DAYS = 30; // red: within 30 days (or already passed)
const HIGH_RISK_KINDS: ReadonlyArray<IBoardDeadline['kind']> = ['SOL', 'filing'];

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

type Deadline = Serialized<IBoardDeadline>;

type Bucket = 'overdue' | 'week' | 'month' | 'later' | 'resolved';

const RESOLVED_STATUSES: ReadonlyArray<IBoardDeadline['status']> = ['satisfied', 'waived', 'missed'];

const bucketOf = (d: Deadline): Bucket => {
	if (RESOLVED_STATUSES.includes(d.status)) {
		return 'resolved';
	}
	const days = daysUntil(d.dueDate);
	if (days === undefined) {
		return 'later';
	}
	if (days < 0) {
		return 'overdue';
	}
	if (days <= 7) {
		return 'week';
	}
	if (days <= 31) {
		return 'month';
	}
	return 'later';
};

// The visual urgency of a deadline: high-risk near/overdue = danger, etc.
const variantOf = (d: Deadline): 'danger' | 'warning' | 'secondary' => {
	if (RESOLVED_STATUSES.includes(d.status)) {
		return 'secondary';
	}
	const days = daysUntil(d.dueDate);
	const isHighRisk = d.highRisk ?? HIGH_RISK_KINDS.includes(d.kind);
	if (days === undefined) {
		return 'secondary';
	}
	if (days <= SOL_DANGER_DAYS) {
		return isHighRisk ? 'danger' : 'warning';
	}
	if (days <= SOL_WARNING_DAYS && isHighRisk) {
		return 'warning';
	}
	return 'secondary';
};

const kindLabelKey = (kind: IBoardDeadline['kind']): string => `Boards_Matters_Deadline_Kind_${kind}`;
const kindLabelDefault: Record<IBoardDeadline['kind'], string> = {
	SOL: 'Statute of limitations',
	filing: 'Filing',
	discovery: 'Discovery',
	mediation: 'Mediation',
	response: 'Response',
	custom: 'Custom',
};

const DeadlineCard = ({
	deadline,
	onOpenCard,
	onAcknowledge,
	acknowledging,
}: {
	deadline: Deadline;
	onOpenCard: (cardId: string) => void;
	onAcknowledge: (deadlineId: string) => void;
	acknowledging: boolean;
}): ReactElement => {
	const { t } = useTranslation();
	const variant = variantOf(deadline);
	const days = daysUntil(deadline.dueDate);
	const isHighRisk = deadline.highRisk ?? HIGH_RISK_KINDS.includes(deadline.kind);
	const isResolved = RESOLVED_STATUSES.includes(deadline.status);
	const canAcknowledge = isHighRisk && !deadline.acknowledged && !isResolved;

	const dueLabel = (() => {
		const datePart = fmtDate(deadline.dueDate);
		if (!datePart) {
			return undefined;
		}
		if (days === undefined || isResolved) {
			return datePart;
		}
		if (days < 0) {
			return t('Boards_Matters_SOL_Passed', { date: datePart, defaultValue: '{{date}} (passed)' });
		}
		return t('Boards_Matters_SOL_In_Days', { date: datePart, days, defaultValue: '{{date}} ({{days}}d)' });
	})();

	const borderColor =
		variant === 'danger' ? 'status-font-on-danger' : variant === 'warning' ? 'status-font-on-warning' : 'extra-light';

	return (
		<Box
			display='flex'
			alignItems='flex-start'
			justifyContent='space-between'
			pb={12}
			pi={12}
			mbe={8}
			bg='tint'
			borderRadius='x4'
			borderInlineStartWidth='x4'
			borderInlineStartStyle='solid'
			borderInlineStartColor={borderColor}
			style={{ gap: '12px' }}
		>
			<Box display='flex' flexDirection='column' style={{ gap: '4px', minWidth: 0 }}>
				<Box display='flex' alignItems='center' flexWrap='wrap' style={{ gap: '6px' }}>
					<Tag variant={variant === 'secondary' ? 'secondary' : variant}>
						{t(kindLabelKey(deadline.kind), { defaultValue: kindLabelDefault[deadline.kind] })}
					</Tag>
					{isHighRisk && (
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
					{isResolved && (
						<Tag variant='secondary' medium>
							{t(`Boards_Matters_Deadline_Status_${deadline.status}`, { defaultValue: deadline.status })}
						</Tag>
					)}
				</Box>
				<Box fontScale='p2b' color='default' withTruncatedText>
					{deadline.label || t(kindLabelKey(deadline.kind), { defaultValue: kindLabelDefault[deadline.kind] })}
				</Box>
				<Box fontScale='c1' color='hint'>
					<Icon name='calendar' size='x14' mie={4} />
					{t('Boards_Matters_Deadline_Due', { defaultValue: 'Due' })}: {dueLabel ?? '—'}
				</Box>
				{deadline.notes && (
					<Box fontScale='micro' color='hint' withTruncatedText>
						{deadline.notes}
					</Box>
				)}
			</Box>

			<Box display='flex' flexDirection='column' alignItems='flex-end' style={{ gap: '6px', flexShrink: 0 }}>
				<Button small onClick={() => onOpenCard(deadline.cardId)}>
					<Icon name='squares' size='x16' mie={4} />
					{t('Open')}
				</Button>
				{canAcknowledge && (
					<Button small primary disabled={acknowledging} onClick={() => onAcknowledge(deadline._id)}>
						{acknowledging ? <Throbber inheritColor size='x12' /> : t('Boards_Matters_Deadline_Acknowledge', { defaultValue: 'Acknowledge' })}
					</Button>
				)}
			</Box>
		</Box>
	);
};

const BucketSection = ({ title, children }: { title: ReactNode; children: ReactNode }): ReactElement => (
	<Box mbs={20}>
		<Box fontScale='h4' color='default' mbe={8}>
			{title}
		</Box>
		{children}
	</Box>
);

const MattersCalendar = (): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();

	const ensureBoard = useEndpoint('POST', '/v1/boards.matters.ensureBoard');
	const listDeadlines = useEndpoint('GET', '/v1/boards.matters.deadlines.list');
	const acknowledge = useEndpoint('POST', '/v1/boards.matters.deadlines.acknowledge');

	const boardQuery = useQuery({
		queryKey: ['boards', 'matters', 'ensure'],
		queryFn: () => ensureBoard({}),
		staleTime: Infinity,
	});

	const boardId = boardQuery.data?.board?._id;

	const deadlinesQuery = useQuery({
		queryKey: ['boards', 'matters', 'deadlines', 'board', boardId],
		queryFn: () => listDeadlines({ boardId: boardId as string }),
		enabled: Boolean(boardId),
	});

	const acknowledgeMutation = useMutation({
		mutationFn: (deadlineId: string) => acknowledge({ deadlineId }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Matters_Deadline_Acknowledged', { defaultValue: 'Acknowledged' }) });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'matters', 'deadlines', 'board', boardId] });
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	const deadlines = useMemo<Deadline[]>(() => (deadlinesQuery.data?.deadlines as Deadline[] | undefined) ?? [], [deadlinesQuery.data]);

	const buckets = useMemo(() => {
		const grouped: Record<Bucket, Deadline[]> = { overdue: [], week: [], month: [], later: [], resolved: [] };
		for (const d of deadlines) {
			grouped[bucketOf(d)].push(d);
		}
		const byDue = (a: Deadline, b: Deadline): number => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
		(Object.keys(grouped) as Bucket[]).forEach((k) => grouped[k].sort(byDue));
		return grouped;
	}, [deadlines]);

	const openCard = (cardId: string): void => {
		router.navigate({ name: 'boards-matters', params: { cardId } });
	};

	const handleAcknowledge = (deadlineId: string): void => {
		acknowledgeMutation.mutate(deadlineId);
	};

	const isLoading = boardQuery.isLoading || deadlinesQuery.isLoading;
	const isError = boardQuery.isError || deadlinesQuery.isError;

	const atRisk = useMemo(
		() => deadlines.filter((d) => variantOf(d) === 'danger' && !RESOLVED_STATUSES.includes(d.status)).length,
		[deadlines],
	);

	const sections: { bucket: Bucket; title: string }[] = [
		{ bucket: 'overdue', title: t('Boards_Matters_Calendar_Overdue', { defaultValue: 'Overdue' }) },
		{ bucket: 'week', title: t('Boards_Matters_Calendar_This_Week', { defaultValue: 'This week' }) },
		{ bucket: 'month', title: t('Boards_Matters_Calendar_This_Month', { defaultValue: 'This month' }) },
		{ bucket: 'later', title: t('Boards_Matters_Calendar_Later', { defaultValue: 'Later' }) },
		{ bucket: 'resolved', title: t('Boards_Matters_Calendar_Resolved', { defaultValue: 'Resolved' }) },
	];

	return (
		<Page>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='calendar' size='x24' mie={8} color='hint' />
						<Box withTruncatedText>{t('Boards_Matters_Deadlines', { defaultValue: 'Deadlines' })}</Box>
					</Box>
				}
			>
				{atRisk > 0 && (
					<Tag variant='secondary-danger'>
						<Icon name='clock' size='x12' mie={4} />
						{t('Boards_Matters_SOL_At_Risk', { defaultValue: 'SOL at risk' })}: {atRisk}
					</Tag>
				)}
			</PageHeader>
			<PageScrollableContentWithShadow>
				<CaseProStubBanner mbe={16} />

				{isLoading && (
					<Box display='flex' justifyContent='center' p={24}>
						<Throbber />
					</Box>
				)}

				{isError && !isLoading && (
					<States>
						<StatesIcon name='warning' variation='danger' />
						<StatesTitle>{t('Something_went_wrong')}</StatesTitle>
						<StatesSubtitle>
							<Button small onClick={() => deadlinesQuery.refetch()}>
								{t('Reload_page')}
							</Button>
						</StatesSubtitle>
					</States>
				)}

				{!isLoading && !isError && deadlines.length === 0 && (
					<States>
						<StatesIcon name='calendar' />
						<StatesTitle>{t('No_results_found')}</StatesTitle>
						<StatesSubtitle>
							{t('Boards_Matters_Calendar_Empty', { defaultValue: 'No deadlines are tracked on the matters board yet.' })}
						</StatesSubtitle>
					</States>
				)}

				{!isLoading &&
					!isError &&
					deadlines.length > 0 &&
					sections.map(({ bucket, title }) =>
						buckets[bucket].length > 0 ? (
							<BucketSection key={bucket} title={`${title} (${buckets[bucket].length})`}>
								{buckets[bucket].map((d) => (
									<DeadlineCard
										key={d._id}
										deadline={d}
										onOpenCard={openCard}
										onAcknowledge={handleAcknowledge}
										acknowledging={acknowledgeMutation.isPending && acknowledgeMutation.variables === d._id}
									/>
								))}
							</BucketSection>
						) : null,
					)}
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default MattersCalendar;
