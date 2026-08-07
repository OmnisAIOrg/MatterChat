import type { IAutomationRun, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Callout, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * AutomationActivity — the run-log / audit view over `GET /v1/boards.automations.runs.list`.
 *
 * One expandable card per run (rule / button / scheduled / sequence step), newest
 * first: status chip, what fired it (event / manual / schedule), the subject card,
 * timing, and — when expanded — the per-action results (IAutomationActionResult) the
 * runner recorded, including skipped reasons and CasePro validate/execute flags. This
 * is the structured machine record (boards_automation_runs), complementing the human
 * boards_activities feed.
 */

type AutomationActivityProps = {
	boardId?: string;
	automationId?: string;
	cardId?: string;
	queryKey: readonly unknown[];
};

type RunActionResult = {
	index: number;
	type: string;
	status?: 'ok' | 'error' | 'skipped';
	detail?: string;
	error?: string;
	skippedReason?: string;
	validated?: boolean;
	executed?: boolean;
};

const runStatusTag = (status: string, t: ReturnType<typeof useTranslation>['t']): ReactElement => {
	switch (status) {
		case 'ok':
			return <Tag variant='primary'>{t('Boards_Automation_RunStatus_ok', { defaultValue: 'OK' })}</Tag>;
		case 'error':
			return <Tag variant='danger'>{t('Boards_Automation_RunStatus_error', { defaultValue: 'Error' })}</Tag>;
		case 'skipped':
			return <Tag variant='secondary'>{t('Boards_Automation_RunStatus_skipped', { defaultValue: 'Skipped' })}</Tag>;
		case 'dry-run':
			return <Tag variant='secondary'>{t('Boards_Automation_RunStatus_dryRun', { defaultValue: 'Dry run' })}</Tag>;
		default:
			return <Tag>{status}</Tag>;
	}
};

const RunCard = ({ run }: { run: Serialized<IAutomationRun> }): ReactElement => {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const actions = (run.actionsRun as RunActionResult[]) ?? [];

	return (
		<Box marginBlockEnd={8} paddingBlock={8} paddingInline={12} backgroundColor='tint' borderRadius='x4'>
			<Box display='flex' alignItems='center' onClick={() => setOpen((v) => !v)} style={{ cursor: 'pointer' }}>
				<Icon name={open ? 'chevron-down' : 'chevron-right'} size='x16' marginInlineEnd={8} color='hint' />
				<Box flexGrow={1} display='flex' flexDirection='column'>
					<Box display='flex' alignItems='center'>
						<Box fontScale='p2b' color='default' marginInlineEnd={8} withTruncatedText>
							{run.automationName ?? run.automationId}
						</Box>
						{runStatusTag(run.status, t)}
					</Box>
					<Box fontScale='micro' color='hint'>
						{run.event ?? '—'} · {new Date(run.startedAt as unknown as string).toLocaleString()}
						{run.durationMs !== undefined ? ` · ${run.durationMs}ms` : ''}
					</Box>
				</Box>
				<Box fontScale='micro' color='hint'>
					{actions.length} {t('Boards_Automation_ActionsCount', { defaultValue: 'actions' })}
				</Box>
			</Box>

			{open && (
				<Box marginBlockStart={8} paddingInlineStart={24}>
					{run.error && (
						<Callout type='danger' icon='warning' marginBlockEnd={8}>
							{run.error}
						</Callout>
					)}
					{actions.length === 0 && (
						<Box fontScale='c1' color='hint'>
							{t('No_results_found')}
						</Box>
					)}
					{actions.map((a) => (
						<Box key={a.index} display='flex' alignItems='flex-start' marginBlockEnd={6}>
							<Box marginInlineEnd={8} marginBlockStart={2}>
								{a.status === 'ok' && <Icon name='circle-check' size='x16' color='status-font-on-success' />}
								{a.status === 'error' && <Icon name='circle-cross' size='x16' color='status-font-on-danger' />}
								{a.status === 'skipped' && <Icon name='ban' size='x16' color='hint' />}
							</Box>
							<Box flexGrow={1}>
								<Box fontScale='p2' color='default'>
									{a.type}
								</Box>
								{a.detail && (
									<Box fontScale='c1' color='hint'>
										{a.detail}
									</Box>
								)}
								{a.error && (
									<Box fontScale='c1' color='danger'>
										{a.error}
									</Box>
								)}
								{a.skippedReason && (
									<Box fontScale='micro' color='hint'>
										{t('Boards_Automation_SkippedReason', { defaultValue: 'Reason' })}: {a.skippedReason}
									</Box>
								)}
							</Box>
						</Box>
					))}
				</Box>
			)}
		</Box>
	);
};

const AutomationActivity = ({ boardId, automationId, cardId, queryKey }: AutomationActivityProps): ReactElement => {
	const { t } = useTranslation();
	const listRuns = useEndpoint('GET', '/v1/boards.automations.runs.list');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: () =>
			listRuns({
				...(boardId ? { boardId } : {}),
				...(automationId ? { automationId } : {}),
				...(cardId ? { cardId } : {}),
				count: 100,
			}),
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

	const runs = data.runs ?? [];

	if (runs.length === 0) {
		return (
			<Box fontScale='c1' color='hint' padding={8}>
				{t('Boards_Automation_NoRuns', { defaultValue: 'No automation runs yet.' })}
			</Box>
		);
	}

	return (
		<Box>
			{runs.map((run) => (
				<RunCard key={run._id} run={run} />
			))}
		</Box>
	);
};

export default AutomationActivity;
