import { Box, Button, ButtonGroup, Icon, Throbber } from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import type { ComponentProps, ReactElement } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import CaseProStatusChip from './CaseProStatusChip';
import { isStubStatus, useCaseProStatus } from './useCaseProStatus';
import { useTimeAgo } from '../../../hooks/useTimeAgo';

type CaseProConnectionControlsProps = {
	/** Existing sync handler (e.g. the Matters seedFromCasePro mutation). Omit to hide the Sync button. */
	onSync?: () => void;
	isSyncing?: boolean;
	/** When the last in-session sync succeeded (client-observed); omitted → no label. */
	lastSyncAt?: Date;
	small?: boolean;
} & Omit<ComponentProps<typeof Box>, 'onSync'>;

/**
 * Board-header cluster for the CasePro connection: status chip, "Test
 * connection" (refetches the status probe and toasts the outcome) and "Sync
 * now" (delegates to the existing sync handler passed in — no duplicated
 * endpoint logic here). Chip + Test hide themselves when the viewer lacks
 * `boards-casepro-view`; the Sync button keeps its historical visibility.
 */
const CaseProConnectionControls = ({
	onSync,
	isSyncing = false,
	lastSyncAt,
	small = false,
	...props
}: CaseProConnectionControlsProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const timeAgo = useTimeAgo();
	const { canView, isFetching, refetch } = useCaseProStatus();

	const handleTestConnection = useCallback(async () => {
		const result = await refetch();
		const status = result.data?.status;
		if (result.isError || !status) {
			dispatchToastMessage({ type: 'error', message: t('CasePro_Unreachable', { defaultValue: 'Unreachable' }) });
			return;
		}
		if (isStubStatus(status)) {
			dispatchToastMessage({ type: 'info', message: t('CasePro_Mode_Stub', { defaultValue: 'Stub' }) });
			return;
		}
		if (status.reachable) {
			dispatchToastMessage({ type: 'success', message: t('CasePro_Connected', { defaultValue: 'Connected' }) });
			return;
		}
		dispatchToastMessage({
			type: 'error',
			message: status.error
				? `${t('CasePro_Unreachable', { defaultValue: 'Unreachable' })}: ${status.error}`
				: t('CasePro_Unreachable', { defaultValue: 'Unreachable' }),
		});
	}, [refetch, dispatchToastMessage, t]);

	return (
		<Box display='flex' alignItems='center' style={{ gap: '8px' }} {...props}>
			<CaseProStatusChip />
			{lastSyncAt && (
				<Box is='span' fontScale='c1' color='hint' data-qa='casepro-last-sync'>
					{t('CasePro_Last_Sync', { defaultValue: 'Last sync' })}: {timeAgo(lastSyncAt)}
				</Box>
			)}
			<ButtonGroup>
				{canView && (
					<Button small={small} data-qa='casepro-test-connection' onClick={handleTestConnection} disabled={isFetching}>
						{isFetching ? <Throbber inheritColor size='x12' mie={4} /> : <Icon name='refresh' size='x16' mie={4} />}
						{t('CasePro_Test_Connection', { defaultValue: 'Test connection' })}
					</Button>
				)}
				{onSync && (
					<Button primary small={small} data-qa='casepro-sync-now' onClick={onSync} disabled={isSyncing}>
						{isSyncing ? <Throbber inheritColor size='x12' mie={4} /> : <Icon name='reload' size='x16' mie={4} />}
						{t('CasePro_Sync_Now', { defaultValue: 'Sync now' })}
					</Button>
				)}
			</ButtonGroup>
		</Box>
	);
};

export default CaseProConnectionControls;
