import type { IAutomation, Serialized } from '@rocket.chat/core-typings';
import {
	Box,
	Button,
	Callout,
	Icon,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Tag,
	Throbber,
	ToggleSwitch,
} from '@rocket.chat/fuselage';
import type { Keys as IconName } from '@rocket.chat/icons';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { KIND_LABEL } from './lib/catalog';

/**
 * AutomationList — a Fuselage table of automations for one tab (filtered by `kind`)
 * or, in the admin console, all automations (kind omitted, boardId omitted = global +
 * board-scoped).
 *
 * Reads `GET /v1/boards.automations.list`. Each row shows name, kind, scope, run
 * count + last run, an enable ToggleSwitch (PATCH via update), and Run/Edit actions.
 *  - enable toggle  -> POST /v1/boards.automations.update { automationId, patch:{ enabled } }
 *  - run now        -> POST /v1/boards.automations.run (buttons / on-demand)
 * The toggle/run are gated by the parent passing `canManage` / `canRun`.
 */

type AutomationListProps = {
	boardId?: string;
	kind?: string;
	queryKey: readonly unknown[];
	canManage: boolean;
	canRun: boolean;
	/** open the builder for an existing automation (contextualbar only) */
	onEdit?: (automation: Serialized<IAutomation>) => void;
	/** show the board column (admin console, where rows span boards) */
	showScope?: boolean;
};

const fmtDate = (d?: string): string => (d ? new Date(d).toLocaleString() : '—');

const AutomationList = ({ boardId, kind, queryKey, canManage, canRun, onEdit, showScope }: AutomationListProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const listEndpoint = useEndpoint('GET', '/v1/boards.automations.list');
	const updateEndpoint = useEndpoint('POST', '/v1/boards.automations.update');
	const runEndpoint = useEndpoint('POST', '/v1/boards.automations.run');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: () =>
			listEndpoint({
				...(boardId ? { boardId } : {}),
				...(kind ? { kind } : {}),
				count: 100,
			}),
	});

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey });
	};

	const toggleMutation = useMutation({
		mutationFn: ({ automationId, enabled }: { automationId: string; enabled: boolean }) =>
			updateEndpoint({ automationId, patch: { enabled } }),
		onSuccess: invalidate,
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const runMutation = useMutation({
		mutationFn: (automationId: string) => runEndpoint({ automationId }),
		onSuccess: (result) => {
			dispatchToastMessage({
				type: result.status === 'error' ? 'error' : 'success',
				message: t('Boards_Automation_RanWithStatus', { defaultValue: 'Ran ({{status}})', status: result.status }),
			});
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' padding={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small marginBlockStart={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	const automations = data.automations ?? [];
	const colSpan = showScope ? 6 : 5;

	return (
		<Table fixed>
			<TableHead>
				<TableRow>
					<TableCell>{t('Name')}</TableCell>
					{showScope && <TableCell>{t('Boards_Automation_Scope', { defaultValue: 'Scope' })}</TableCell>}
					<TableCell>{t('Type')}</TableCell>
					<TableCell align='end'>{t('Boards_Automation_Runs', { defaultValue: 'Runs' })}</TableCell>
					<TableCell>{t('Boards_Automation_Enabled', { defaultValue: 'Enabled' })}</TableCell>
					<TableCell align='end'>{t('Actions')}</TableCell>
				</TableRow>
			</TableHead>
			<TableBody>
				{automations.map((automation) => {
					const isButton = automation.kind === 'card-button' || automation.kind === 'board-button';
					return (
						<TableRow key={automation._id} action={Boolean(onEdit)} onClick={onEdit ? () => onEdit(automation) : undefined}>
							<TableCell>
								<Box display='flex' alignItems='center'>
									{automation.icon && <Icon name={automation.icon as IconName} size='x16' marginInlineEnd={6} color='hint' />}
									<Box display='flex' flexDirection='column'>
										<Box display='flex' alignItems='center'>
											<Box withTruncatedText marginInlineEnd={6}>
												{automation.name}
											</Box>
											{automation.isSystem && <Tag>{t('Default', { defaultValue: 'Default' })}</Tag>}
										</Box>
										{automation.lastErrorAt && (
											<Box fontScale='micro' color='danger' withTruncatedText>
												{automation.lastError ?? t('Boards_Automation_RunStatus_error', { defaultValue: 'Error' })}
											</Box>
										)}
									</Box>
								</Box>
							</TableCell>
							{showScope && (
								<TableCell>
									{automation.scope === 'global' ? (
										<Tag variant='secondary'>{t('Boards_Automation_Scope_global', { defaultValue: 'Global' })}</Tag>
									) : (
										<Box withTruncatedText color='hint'>
											{automation.boardId ?? '—'}
										</Box>
									)}
								</TableCell>
							)}
							<TableCell>
								<Tag variant='secondary'>{t(KIND_LABEL[automation.kind] as Parameters<typeof t>[0])}</Tag>
							</TableCell>
							<TableCell align='end'>
								<Box display='flex' flexDirection='column' alignItems='flex-end'>
									<Box>{automation.runCount ?? 0}</Box>
									<Box fontScale='micro' color='hint'>
										{fmtDate(automation.lastRunAt as unknown as string)}
									</Box>
								</Box>
							</TableCell>
							<TableCell onClick={(e) => e.stopPropagation()}>
								<ToggleSwitch
									checked={automation.enabled}
									disabled={!canManage || toggleMutation.isPending}
									onChange={(e) => toggleMutation.mutate({ automationId: automation._id, enabled: (e.target as HTMLInputElement).checked })}
								/>
							</TableCell>
							<TableCell align='end' onClick={(e) => e.stopPropagation()}>
								{isButton && canRun && (
									<Button small marginInlineEnd={4} disabled={runMutation.isPending} onClick={() => runMutation.mutate(automation._id)}>
										<Icon name='play' size='x16' marginInlineEnd={4} />
										{t('Boards_Automation_Run_Now', { defaultValue: 'Run' })}
									</Button>
								)}
								{onEdit && (
									<Button small onClick={() => onEdit(automation)}>
										{automation.isSystem ? t('View', { defaultValue: 'View' }) : t('Edit')}
									</Button>
								)}
							</TableCell>
						</TableRow>
					);
				})}
				{automations.length === 0 && (
					<TableRow>
						<TableCell colSpan={colSpan}>
							<Box fontScale='c1' color='hint'>
								{t('No_results_found')}
							</Box>
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
};

export default AutomationList;
