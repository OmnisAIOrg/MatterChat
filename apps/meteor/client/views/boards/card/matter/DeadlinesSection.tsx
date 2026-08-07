import type { BoardDeadlineKind, IBoardDeadline, Serialized } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import { Box, Button, ButtonGroup, CheckBox, Icon, InputBox, Select, Tag, TextInput, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, usePermission, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MatterSection from './MatterSection';
import { daysUntil, fmtDate, SOL_DANGER_DAYS, SOL_WARNING_DAYS } from './matterFormatters';

type DeadlinesSectionProps = {
	cardId: string;
};

const SOL_DANGER_KINDS: ReadonlyArray<IBoardDeadline['kind']> = ['SOL', 'filing'];
const RESOLVED_STATUSES: ReadonlyArray<IBoardDeadline['status']> = ['satisfied', 'waived', 'missed'];
const DEADLINE_KINDS: ReadonlyArray<BoardDeadlineKind> = ['SOL', 'filing', 'discovery', 'mediation', 'response', 'custom'];

const kindLabelDefault: Record<IBoardDeadline['kind'], string> = {
	SOL: 'Statute of limitations',
	filing: 'Filing',
	discovery: 'Discovery',
	mediation: 'Mediation',
	response: 'Response',
	custom: 'Custom',
};

const statusLabelDefault: Record<IBoardDeadline['status'], string> = {
	open: 'Open',
	acknowledged: 'Acknowledged',
	satisfied: 'Satisfied',
	waived: 'Waived',
	missed: 'Missed',
};

/**
 * Deadlines — the safety-critical SOL/deadline engine for this matter card.
 *
 * Upgrades over the original list:
 *  - per-deadline status Tag (open/acknowledged/satisfied/waived/missed) so a
 *    resolved deadline reads as resolved instead of just fading out;
 *  - an inline create form (kind + due date + optional label + high-risk flag)
 *    over POST /v1/boards.matters.deadlines.create, gated by the
 *    `boards-matters-deadlines-manage` permission;
 *  - "Mark satisfied" via POST /v1/boards.matters.deadlines.setStatus (same
 *    permission) — disabled on an unacknowledged high-risk deadline because
 *    the server requires acknowledgement before resolution;
 *  - Acknowledge stays on high-risk deadlines, gated by
 *    `boards-matters-deadlines-acknowledge`.
 *
 * Risk escalation is client-side date math: danger inside 30 days (or passed),
 * warning inside 90 days for high-risk kinds.
 */
const DeadlinesSection = ({ cardId }: DeadlinesSectionProps): ReactElement => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();

	const canManage = usePermission('boards-matters-deadlines-manage');
	const canAck = usePermission('boards-matters-deadlines-acknowledge');

	const listDeadlines = useEndpoint('GET', '/v1/boards.matters.deadlines.list');
	const createDeadline = useEndpoint('POST', '/v1/boards.matters.deadlines.create');
	const acknowledge = useEndpoint('POST', '/v1/boards.matters.deadlines.acknowledge');
	const setStatus = useEndpoint('POST', '/v1/boards.matters.deadlines.setStatus');

	const [formOpen, setFormOpen] = useState(false);
	const [kind, setKind] = useState<BoardDeadlineKind>('filing');
	const [dueDate, setDueDate] = useState('');
	const [label, setLabel] = useState('');
	const [highRisk, setHighRisk] = useState(false);

	const deadlinesQueryKey = ['boards', 'matters', 'deadlines', 'card', cardId];

	const { data, isLoading } = useQuery({
		queryKey: deadlinesQueryKey,
		queryFn: () => listDeadlines({ cardId }),
	});

	const deadlines = useMemo<Serialized<IBoardDeadline>[]>(
		() => (data?.deadlines as Serialized<IBoardDeadline>[] | undefined) ?? [],
		[data],
	);

	const kindOptions = useMemo<SelectOption[]>(
		() => DEADLINE_KINDS.map((k) => [k, t(`Boards_Matters_Deadline_Kind_${k}`, { defaultValue: kindLabelDefault[k] })] as [string, string]),
		[t],
	);

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: deadlinesQueryKey });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
	};

	const resetForm = (): void => {
		setFormOpen(false);
		setKind('filing');
		setDueDate('');
		setLabel('');
		setHighRisk(false);
	};

	const createMutation = useMutation({
		mutationFn: () =>
			createDeadline({
				cardId,
				kind,
				dueDate,
				...(label.trim() ? { label: label.trim() } : {}),
				...(highRisk ? { highRisk } : {}),
			}),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			resetForm();
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const acknowledgeMutation = useMutation({
		mutationFn: (deadlineId: string) => acknowledge({ deadlineId }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Matters_Deadline_Acknowledged', { defaultValue: 'Acknowledged' }) });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const satisfyMutation = useMutation({
		mutationFn: (deadlineId: string) => setStatus({ deadlineId, status: 'satisfied' }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Matters_Deadline_Status_satisfied', { defaultValue: 'Satisfied' }) });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const addAction = canManage ? (
		<Button tiny onClick={(): void => (formOpen ? resetForm() : setFormOpen(true))}>
			<Icon name={formOpen ? 'cross' : 'plus'} size='x12' marginInlineEnd={2} />
			{formOpen ? t('Cancel') : t('Boards_Matters_Deadline_Add', { defaultValue: 'Add deadline' })}
		</Button>
	) : undefined;

	return (
		<MatterSection title={t('Boards_Matters_Deadlines', { defaultValue: 'Deadlines' })} icon='stopwatch' action={addAction}>
			{formOpen && (
				<Box backgroundColor='tint' padding={12} borderRadius='x4' marginBlockEnd={12}>
					<Box display='flex' alignItems='center' marginBlockEnd={8} style={{ gap: '8px' }}>
						<Box flexGrow={1}>
							<Select
								small
								value={kind}
								options={kindOptions}
								onChange={(next): void => setKind(next as BoardDeadlineKind)}
								placeholder={t('Boards_Matters_Deadline', { defaultValue: 'Deadline' })}
							/>
						</Box>
						<InputBox
							type='date'
							value={dueDate}
							onChange={(e): void => setDueDate((e.target as HTMLInputElement).value)}
							aria-label={t('Boards_Matters_Deadline_Due', { defaultValue: 'Due' })}
						/>
					</Box>
					<Box marginBlockEnd={8}>
						<TextInput
							small
							value={label}
							onChange={(e): void => setLabel((e.target as HTMLInputElement).value)}
							placeholder={t('Boards_Matters_Deadline_Label', { defaultValue: 'Label (optional)' })}
						/>
					</Box>
					<Box display='flex' alignItems='center' justifyContent='space-between'>
						<Box is='label' display='flex' alignItems='center' fontScale='c1' color='default' style={{ gap: '6px', cursor: 'pointer' }}>
							<CheckBox checked={highRisk} onChange={(): void => setHighRisk(!highRisk)} />
							{t('Boards_Matters_Deadline_High_Risk', { defaultValue: 'High risk' })}
						</Box>
						<Button small primary disabled={!dueDate || createMutation.isPending} onClick={(): void => createMutation.mutate()}>
							{createMutation.isPending ? <Throbber inheritColor size='x12' /> : t('Save')}
						</Button>
					</Box>
				</Box>
			)}

			{isLoading && (
				<Box display='flex' justifyContent='center' padding={8}>
					<Throbber size='x16' />
				</Box>
			)}

			{!isLoading && deadlines.length === 0 && (
				<Box fontScale='c1' color='hint' marginBlockEnd={8}>
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
				const needsAck = isHighRisk && !deadline.acknowledged && !isResolved;
				const canSatisfy = canManage && !isResolved;
				const satisfyBlocked = needsAck; // server requires ack before a high-risk deadline can be resolved
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
					<Box
						key={deadline._id}
						display='flex'
						justifyContent='space-between'
						alignItems='flex-start'
						marginBlockEnd={10}
						style={{ gap: '8px' }}
					>
						<Box display='flex' flexDirection='column' style={{ gap: '4px', minWidth: 0 }}>
							<Box display='flex' alignItems='center' flexWrap='wrap' style={{ gap: '4px' }}>
								<Tag variant={variant === 'secondary' ? 'secondary' : variant}>
									{t(`Boards_Matters_Deadline_Kind_${deadline.kind}`, { defaultValue: kindLabelDefault[deadline.kind] })}
								</Tag>
								<Tag variant={isResolved ? 'secondary' : 'secondary-info'} medium>
									{t(`Boards_Matters_Deadline_Status_${deadline.status}`, { defaultValue: statusLabelDefault[deadline.status] })}
								</Tag>
								{needsAck && (
									<Tag variant='secondary-danger' medium>
										{t('Boards_Matters_Deadline_High_Risk', { defaultValue: 'High risk' })}
									</Tag>
								)}
							</Box>
							<Box fontScale='c1' color='hint' withTruncatedText>
								<Icon name='clock' size='x14' marginInlineEnd={4} />
								{t('Boards_Matters_Deadline_Due', { defaultValue: 'Due' })}: {dueLabel}
								{deadline.label ? ` · ${deadline.label}` : ''}
							</Box>
						</Box>
						<ButtonGroup style={{ flexShrink: 0 }}>
							{needsAck && canAck && (
								<Button
									tiny
									primary
									disabled={acknowledgeMutation.isPending && acknowledgeMutation.variables === deadline._id}
									onClick={(): void => acknowledgeMutation.mutate(deadline._id)}
								>
									{acknowledgeMutation.isPending && acknowledgeMutation.variables === deadline._id ? (
										<Throbber inheritColor size='x12' />
									) : (
										t('Boards_Matters_Deadline_Acknowledge', { defaultValue: 'Acknowledge' })
									)}
								</Button>
							)}
							{canSatisfy && (
								<Button
									tiny
									title={
										satisfyBlocked
											? t('Boards_Matters_Deadline_Requires_Acknowledgement', {
													defaultValue: 'Acknowledgement required before this deadline can be resolved',
												})
											: t('Boards_Matters_Deadline_Status_satisfied', { defaultValue: 'Satisfied' })
									}
									disabled={satisfyBlocked || (satisfyMutation.isPending && satisfyMutation.variables === deadline._id)}
									onClick={(): void => satisfyMutation.mutate(deadline._id)}
								>
									{satisfyMutation.isPending && satisfyMutation.variables === deadline._id ? (
										<Throbber inheritColor size='x12' />
									) : (
										<Icon name='check' size='x14' />
									)}
								</Button>
							)}
						</ButtonGroup>
					</Box>
				);
			})}
		</MatterSection>
	);
};

export default DeadlinesSection;
