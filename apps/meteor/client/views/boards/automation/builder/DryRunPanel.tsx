import { Box, Callout, Icon, Tag } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Renders the result of `POST /v1/boards.automations.dryRun` — the planned actions
 * the automation WOULD run against the sample subject, WITHOUT mutating anything
 * (integration actions only validate). Each action shows its status (ok / skipped /
 * error) and the human `detail` the runner produced. This is the editor's "Test"
 * affordance (05-automation-engine.md §8.2 dry-run).
 */

// Mirrors the runner's per-action result (IAutomationActionResult) over the wire.
type DryRunActionResult = {
	index: number;
	type: string;
	ok?: boolean;
	status?: 'ok' | 'error' | 'skipped';
	detail?: string;
	error?: string;
	skippedReason?: string;
	validated?: boolean;
	executed?: boolean;
};

export type DryRunResult = {
	runId: string;
	status: string;
	actionsRun: unknown[];
};

const statusTag = (status: string | undefined, t: ReturnType<typeof useTranslation>['t']): ReactElement => {
	switch (status) {
		case 'ok':
			return <Tag variant='primary'>{t('Boards_Automation_RunStatus_ok', { defaultValue: 'OK' })}</Tag>;
		case 'error':
			return <Tag variant='danger'>{t('Boards_Automation_RunStatus_error', { defaultValue: 'Error' })}</Tag>;
		case 'skipped':
			return <Tag variant='secondary'>{t('Boards_Automation_RunStatus_skipped', { defaultValue: 'Skipped' })}</Tag>;
		default:
			return <Tag>{status ?? '—'}</Tag>;
	}
};

const DryRunPanel = ({ result }: { result: DryRunResult }): ReactElement => {
	const { t } = useTranslation();
	const actions = (result.actionsRun as DryRunActionResult[]) ?? [];

	return (
		<Box marginBlockStart={12}>
			<Callout type='info' icon='eye' title={t('Boards_Automation_DryRunTitle', { defaultValue: 'Dry run — nothing was changed' })}>
				{t('Boards_Automation_DryRunSubtitle', {
					defaultValue: 'These are the actions that would run. Integration actions were validated only.',
				})}
			</Callout>

			<Box marginBlockStart={12}>
				{actions.length === 0 && (
					<Box fontScale='c1' color='hint'>
						{t('Boards_Automation_DryRunNoActions', { defaultValue: 'No actions would run (conditions did not match).' })}
					</Box>
				)}
				{actions.map((a) => (
					<Box
						key={a.index}
						display='flex'
						alignItems='flex-start'
						marginBlockEnd={8}
						paddingBlock={8}
						paddingInline={8}
						backgroundColor='tint'
						borderRadius='x4'
					>
						<Icon name='arrow-forward' size='x16' marginInlineEnd={8} marginBlockStart={2} color='hint' />
						<Box flexGrow={1}>
							<Box display='flex' alignItems='center' marginBlockEnd={2}>
								<Box fontScale='p2b' color='default' marginInlineEnd={8}>
									{a.type}
								</Box>
								{statusTag(a.status, t)}
							</Box>
							{a.detail && (
								<Box fontScale='p2' color='default'>
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
							{a.validated !== undefined && (
								<Box fontScale='micro' color='hint'>
									{t('Boards_Automation_Validated', { defaultValue: 'Validated' })}: {a.validated ? '✓' : '✗'}
								</Box>
							)}
						</Box>
					</Box>
				))}
			</Box>
		</Box>
	);
};

export default DryRunPanel;
