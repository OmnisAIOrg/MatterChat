import type { IBoardDeadline, Serialized } from '@rocket.chat/core-typings';
import { Box, States, StatesIcon, StatesTitle, StatesSubtitle, Throbber, Button, Icon } from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint, useRouter, useToastMessageDispatch, useThemeMode } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../casepro';

/**
 * DeadlinesView — premium-refresh Deadlines screen (wave 3, design: premium-refresh/Deadlines.dc.html).
 *
 * Displays board-wide SOL + deadlines grouped into Overdue/Later sections. High-risk deadlines
 * that are overdue or due within 30 days can be acknowledged inline.
 *
 * Uses premium-refresh design tokens for a modern visual presentation with light+dark support.
 * Component is self-contained with its own token definitions via CSS variables.
 *
 * Wiring: register in BoardRouter.tsx as view type 'deadlines'.
 */

type Deadline = Serialized<IBoardDeadline>;

type Bucket = 'overdue' | 'later';

const RESOLVED_STATUSES: ReadonlyArray<IBoardDeadline['status']> = ['satisfied', 'waived', 'missed'];
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

const bucketOf = (d: Deadline): Bucket => {
	if (RESOLVED_STATUSES.includes(d.status)) {
		return 'later'; // resolved deadlines stay out of Overdue, shown in Later
	}
	const days = daysUntil(d.dueDate);
	if (days === undefined || days >= 0) {
		return 'later';
	}
	return 'overdue';
};

const DeadlineCard = ({
	deadline,
	onOpenCard,
	onAcknowledge,
	acknowledging,
	isDark,
}: {
	deadline: Deadline;
	onOpenCard: (cardId: string) => void;
	onAcknowledge: (deadlineId: string) => void;
	acknowledging: boolean;
	isDark: boolean;
}): ReactElement => {
	const { t } = useTranslation();
	const days = daysUntil(deadline.dueDate);
	const isHighRisk = deadline.highRisk ?? HIGH_RISK_KINDS.includes(deadline.kind);
	const isResolved = RESOLVED_STATUSES.includes(deadline.status);
	const isOverdue = days !== undefined && days < 0;
	const canAcknowledge = isHighRisk && !deadline.acknowledged && !isResolved;

	const dueLabel = (() => {
		const datePart = fmtDate(deadline.dueDate);
		if (!datePart) {
			return undefined;
		}
		if (isResolved || days === undefined) {
			return datePart;
		}
		if (isOverdue) {
			const pastDays = Math.abs(days);
			return `${datePart} (${pastDays}D PAST)`;
		}
		return `${datePart} (${days}D LEFT)`;
	})();

	const progressPct = (() => {
		if (!deadline.dueDate) return '0%';
		// Simple example: 100% if overdue, decreasing based on days left
		if (isOverdue) return '100%';
		if (days === undefined || days > 90) return '5%';
		if (days > 30) return '14%';
		if (days > 0) return '72%';
		return '100%';
	})();

	const kindLabel = (() => {
		const kindMap: Record<IBoardDeadline['kind'], string> = {
			SOL: 'Statute of limitations',
			filing: 'Filing',
			discovery: 'Discovery',
			mediation: 'Mediation',
			response: 'Response',
			custom: 'Custom',
		};
		return kindMap[deadline.kind] || deadline.kind;
	})();

	const riskLabel = isHighRisk ? 'High risk' : undefined;

	return (
		<Box
			style={{
				position: 'relative',
				background: `var(--mc-dl-surface)`,
				border: `1px solid var(--mc-dl-border)`,
				borderRadius: '13px',
				boxShadow: 'var(--mc-dl-shadow1)',
				padding: '15px 18px 15px 22px',
				display: 'flex',
				alignItems: 'center',
				gap: '18px',
				cursor: 'pointer',
				transition: 'all 0.15s ease',
			}}
			className='mc-deadline-card'
		>
			{/* Left accent bar */}
			<Box
				style={{
					position: 'absolute',
					left: 0,
					top: '12px',
					bottom: '12px',
					width: '3.5px',
					borderRadius: '0 4px 4px 0',
					background: isOverdue ? 'var(--mc-dl-red)' : 'var(--mc-dl-green-line)',
				}}
			/>

			{/* Content */}
			<Box style={{ flex: 1, minWidth: 0 }}>
				{/* Tags */}
				<Box style={{ display: 'flex', gap: '7px', marginBottom: '8px' }}>
					<Box
						is='span'
						style={{
							fontSize: '10.5px',
							fontWeight: 600,
							padding: '2.5px 9px',
							borderRadius: '99px',
							background: isOverdue ? 'var(--mc-dl-red-soft)' : 'var(--mc-dl-green-soft)',
							border: `1px solid ${isOverdue ? 'var(--mc-dl-red-line)' : 'var(--mc-dl-green-line)'}`,
							color: isOverdue ? 'var(--mc-dl-red)' : 'var(--mc-dl-green-ink)',
						}}
					>
						{kindLabel}
					</Box>
					{riskLabel && (
						<Box
							is='span'
							style={{
								fontSize: '10.5px',
								fontWeight: 600,
								padding: '2.5px 9px',
								borderRadius: '99px',
								background: 'var(--mc-dl-surface2)',
								border: '1px solid var(--mc-dl-border2)',
								color: 'var(--mc-dl-ink2)',
							}}
						>
							{riskLabel}
						</Box>
					)}
				</Box>

				{/* Title */}
				<Box
					style={{
						marginTop: '8px',
						fontSize: '14px',
						fontWeight: 650,
						color: 'var(--mc-dl-ink)',
					}}
				>
					{deadline.label || kindLabel}
				</Box>

				{/* Due date */}
				<Box
					style={{
						marginTop: '4px',
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
						fontSize: '12.5px',
						color: 'var(--mc-dl-ink2)',
					}}
				>
					<Icon name='calendar' size='x15' />
					Due: {dueLabel ?? '—'}
					{days !== undefined && (
						<Box
							is='span'
							style={{
								fontFamily: "'Geist Mono', monospace",
								fontSize: '10px',
								fontWeight: 600,
								padding: '2px 8px',
								borderRadius: '7px',
								background: isOverdue ? 'var(--mc-dl-red-soft)' : 'var(--mc-dl-green-soft)',
								border: `1px solid ${isOverdue ? 'var(--mc-dl-red-line)' : 'var(--mc-dl-green-line)'}`,
								color: isOverdue ? 'var(--mc-dl-red)' : 'var(--mc-dl-green-ink)',
							}}
						>
							{Math.abs(days)}D {isOverdue ? 'PAST' : 'LEFT'}
						</Box>
					)}
				</Box>

				{/* Progress bar */}
				<Box
					style={{
						marginTop: '10px',
						height: '4px',
						borderRadius: '99px',
						background: 'var(--mc-dl-surface2)',
						border: '1px solid var(--mc-dl-border)',
						overflow: 'hidden',
						maxWidth: '340px',
					}}
				>
					<Box
						style={{
							height: '100%',
							background: isOverdue ? 'var(--mc-dl-red)' : 'var(--mc-dl-green)',
							width: progressPct,
						}}
					/>
				</Box>
			</Box>

			{/* Action buttons */}
			<Box
				style={{
					display: 'flex',
					gap: '8px',
					flexShrink: 0,
				}}
			>
				<Button
					small
					onClick={() => onOpenCard(deadline.cardId)}
					className='mc-deadline-open-btn'
					style={{
						height: '31px',
						padding: '0 13px',
						borderRadius: '9px',
						border: `1px solid var(--mc-dl-border2)`,
						background: 'var(--mc-dl-surface)',
						color: 'var(--mc-dl-ink)',
						fontFamily: 'inherit',
						fontSize: '12.5px',
						fontWeight: 600,
						cursor: 'pointer',
						boxShadow: 'var(--mc-dl-shadow1)',
						transition: 'all 0.15s ease',
					}}
				>
					Open
				</Button>
				{canAcknowledge && (
					<Button
						small
						primary
						disabled={acknowledging}
						onClick={() => onAcknowledge(deadline._id)}
						className='mc-deadline-ack-btn'
						style={{
							height: '31px',
							padding: '0 13px',
							borderRadius: '9px',
							border: 'none',
							background: 'var(--mc-dl-green)',
							color: 'var(--mc-dl-on-green)',
							fontFamily: 'inherit',
							fontSize: '12.5px',
							fontWeight: 600,
							cursor: acknowledging ? 'not-allowed' : 'pointer',
							boxShadow: 'var(--mc-dl-shadow1)',
							transition: 'all 0.15s ease',
							opacity: acknowledging ? 0.6 : 1,
						}}
					>
						{acknowledging ? <Throbber inheritColor size='x12' /> : 'Acknowledge'}
					</Button>
				)}
			</Box>
		</Box>
	);
};

const DeadlinesView = (): ReactElement => {
	const { t } = useTranslation();
	const [, , theme] = useThemeMode();
	const isDark = theme === 'dark';
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
		const grouped: Record<Bucket, Deadline[]> = { overdue: [], later: [] };
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
		() =>
			deadlines
				.filter((d) => d.highRisk ?? HIGH_RISK_KINDS.includes(d.kind))
				.filter((d) => {
					const days = daysUntil(d.dueDate);
					return (days !== undefined && days < 30) || (days === undefined && !RESOLVED_STATUSES.includes(d.status));
				}).length,
		[deadlines],
	);

	return (
		<>
			<style
				dangerouslySetInnerHTML={{
					__html: `
				.mc-deadlines {
					--mc-dl-bg: ${isDark ? '#0F1512' : '#F6F6F3'};
					--mc-dl-surface: ${isDark ? '#151C17' : '#FFFFFF'};
					--mc-dl-surface2: ${isDark ? '#19211C' : '#FAFAF7'};
					--mc-dl-border: ${isDark ? '#242D27' : '#E7E6E0'};
					--mc-dl-border2: ${isDark ? '#2D372F' : '#DBDAD3'};
					--mc-dl-ink: ${isDark ? '#E9EDEA' : '#171D19'};
					--mc-dl-ink2: ${isDark ? '#A2ACA5' : '#57615B'};
					--mc-dl-ink3: ${isDark ? '#707B74' : '#8E968F'};
					--mc-dl-green: ${isDark ? '#3FBC7C' : '#17804D'};
					--mc-dl-green2: ${isDark ? '#57CD90' : '#0F6A3D'};
					--mc-dl-on-green: ${isDark ? '#08130D' : '#FFFFFF'};
					--mc-dl-green-soft: ${isDark ? '#152A1E' : '#E8F3ED'};
					--mc-dl-green-line: ${isDark ? '#265C3F' : '#CBE5D6'};
					--mc-dl-green-ink: ${isDark ? '#6FD6A3' : '#116240'};
					--mc-dl-red: ${isDark ? '#E0685D' : '#CF4438'};
					--mc-dl-red-soft: ${isDark ? '#32201D' : '#FBECEA'};
					--mc-dl-red-line: ${isDark ? '#5C332D' : '#F2CFCB'};
					--mc-dl-shadow1: ${isDark ? '0 1px 2px rgba(0,0,0,.35)' : '0 1px 2px rgba(23,29,25,.05),0 1px 3px rgba(23,29,25,.04)'};
					--mc-dl-shadow2: ${isDark ? '0 1px 2px rgba(0,0,0,.4),0 10px 28px -8px rgba(0,0,0,.5)' : '0 1px 2px rgba(23,29,25,.05),0 8px 24px -8px rgba(23,29,25,.14)'};
				}
				.mc-deadline-card:hover {
					box-shadow: var(--mc-dl-shadow2);
					transform: translateY(-1px);
				}
				.mc-deadline-open-btn:hover {
					border-color: var(--mc-dl-ink3);
				}
				.mc-deadline-ack-btn:not(:disabled):hover {
					background: var(--mc-dl-green2);
					transform: translateY(-1px);
				}
				.mc-deadline-ack-btn:not(:disabled):active {
					transform: translateY(0);
				}
			`,
				}}
			/>
			<Page className='mc-deadlines' style={{ background: 'var(--mc-dl-bg)' }}>
				<PageHeader
					title={
						<Box display='flex' alignItems='center' gap='12px'>
							<Box
								style={{
									width: '30px',
									height: '30px',
									borderRadius: '9px',
									background: 'var(--mc-dl-green-soft)',
									border: '1px solid var(--mc-dl-green-line)',
									display: 'grid',
									placeItems: 'center',
									color: 'var(--mc-dl-green-ink)',
								}}
							>
								<Icon name='calendar' size='x15' />
							</Box>
							<Box
								is='span'
								style={{
									margin: 0,
									fontSize: '19px',
									fontWeight: 650,
									letterSpacing: '-0.02em',
									color: 'var(--mc-dl-ink)',
								}}
							>
								{t('Boards_Matters_Deadlines', { defaultValue: 'Deadlines' })}
							</Box>
						</Box>
					}
				>
					{atRisk > 0 && (
						<Box
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								gap: '7px',
								fontSize: '12px',
								fontWeight: 600,
								padding: '5px 12px',
								borderRadius: '99px',
								background: 'var(--mc-dl-red-soft)',
								border: '1px solid var(--mc-dl-red-line)',
								color: 'var(--mc-dl-red)',
							}}
						>
							<Box
								is='span'
								style={{
									width: '7px',
									height: '7px',
									borderRadius: '99px',
									background: 'var(--mc-dl-red)',
								}}
							/>
							SOL at risk: {atRisk}
						</Box>
					)}
				</PageHeader>
				<PageScrollableContentWithShadow>
					<CaseProStubBanner marginBlockEnd={16} />

					{isLoading && (
						<Box display='flex' justifyContent='center' padding={24}>
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

					{!isLoading && !isError && deadlines.length > 0 && (
						<Box
							style={{
								maxWidth: '920px',
								margin: '0 auto',
								padding: '22px 28px 60px',
								animation: 'fadeUp 0.35s ease both',
							}}
						>
							{/* Overdue section */}
							{buckets.overdue.length > 0 && (
								<Box style={{ marginBottom: '30px' }}>
									<Box
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: '9px',
											marginBottom: '12px',
										}}
									>
										<Box
											is='span'
											style={{
												fontSize: '15px',
												fontWeight: 650,
												color: 'var(--mc-dl-ink)',
											}}
										>
											{t('Boards_Matters_Calendar_Overdue', { defaultValue: 'Overdue' })}
										</Box>
										<Box
											is='span'
											style={{
												minWidth: '19px',
												height: '19px',
												padding: '0 6px',
												borderRadius: '99px',
												background: 'var(--mc-dl-red-soft)',
												border: '1px solid var(--mc-dl-red-line)',
												color: 'var(--mc-dl-red)',
												fontSize: '11px',
												fontWeight: 600,
												display: 'grid',
												placeItems: 'center',
											}}
										>
											{buckets.overdue.length}
										</Box>
									</Box>
									<Box style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
										{buckets.overdue.map((d) => (
											<DeadlineCard
												key={d._id}
												deadline={d}
												onOpenCard={openCard}
												onAcknowledge={handleAcknowledge}
												acknowledging={acknowledgeMutation.isPending && acknowledgeMutation.variables === d._id}
												isDark={isDark}
											/>
										))}
									</Box>
								</Box>
							)}

							{/* Later section */}
							{buckets.later.length > 0 && (
								<Box>
									<Box
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: '9px',
											marginBottom: '12px',
										}}
									>
										<Box
											is='span'
											style={{
												fontSize: '15px',
												fontWeight: 650,
												color: 'var(--mc-dl-ink)',
											}}
										>
											{t('Boards_Matters_Calendar_Later', { defaultValue: 'Later' })}
										</Box>
										<Box
											is='span'
											style={{
												fontFamily: "'Geist Mono', monospace",
												fontSize: '11px',
												color: 'var(--mc-dl-ink3)',
											}}
										>
											{buckets.later.length}
										</Box>
									</Box>
									<Box style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
										{buckets.later.map((d) => (
											<DeadlineCard
												key={d._id}
												deadline={d}
												onOpenCard={openCard}
												onAcknowledge={handleAcknowledge}
												acknowledging={acknowledgeMutation.isPending && acknowledgeMutation.variables === d._id}
												isDark={isDark}
											/>
										))}
									</Box>
								</Box>
							)}
						</Box>
					)}
				</PageScrollableContentWithShadow>
			</Page>
		</>
	);
};

export default DeadlinesView;
