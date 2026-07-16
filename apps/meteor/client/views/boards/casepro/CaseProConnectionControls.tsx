import { Box, IconButton } from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import type { ComponentProps, ReactElement } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import CaseProStatusChip from './CaseProStatusChip';
import { isStubStatus, useCaseProStatus } from './useCaseProStatus';

type CaseProConnectionControlsProps = {
	/** Existing sync handler (e.g. the Matters seedFromCasePro mutation). Omit to hide the Sync button. */
	onSync?: () => void;
	isSyncing?: boolean;
	/** When the last in-session sync succeeded (client-observed); omitted → no label. */
	lastSyncAt?: Date;
} & Omit<ComponentProps<typeof Box>, 'onSync'>;

/** Compact clock label for the strip, e.g. 2:14p / 11:05a (tabular-nums via CSS). */
const formatClockTime = (date: Date): string => {
	const hours = date.getHours();
	const minutes = `${date.getMinutes()}`.padStart(2, '0');
	return `${hours % 12 || 12}:${minutes}${hours >= 12 ? 'p' : 'a'}`;
};

/**
 * ONE dense CasePro strip for the board header (Ledger chrome): tiny dot+word
 * status, a quiet "synced 2:14p" figure, then compact ICON buttons — Sync now
 * (delegates to the sync handler passed in — no duplicated endpoint logic
 * here) and Test connection (refetches the status probe and toasts the
 * outcome). Chip + Test hide themselves when the viewer lacks
 * `boards-casepro-view`; the Sync button keeps its historical visibility.
 *
 * Both actions are icon-only with tooltips + aria-labels; the wide labelled
 * buttons ("Test connection" / "Sync now") are gone. The `data-qa` hooks
 * (`casepro-test-connection`, `casepro-sync-now`, `casepro-last-sync`) and all
 * click/refetch behavior are unchanged. The last-sync figure is dropped first
 * at narrow widths (CSS in ../BoardsChromeStyleTags.tsx).
 */
const CaseProConnectionControls = ({ onSync, isSyncing = false, lastSyncAt, ...props }: CaseProConnectionControlsProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
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
		// display/gap also inline so the strip still lays out under the stock
		// high-contrast theme, where the branded .mc-cp-strip CSS is not emitted.
		<Box display='flex' alignItems='center' style={{ gap: '6px' }} {...props} className='mc-cp-strip'>
			<CaseProStatusChip />
			{lastSyncAt && (
				<Box is='span' className='mc-cp-lastsync' data-qa='casepro-last-sync'>
					{t('CasePro_Synced_At', { time: formatClockTime(lastSyncAt), defaultValue: 'synced {{time}}' })}
				</Box>
			)}
			{onSync && (
				<IconButton
					small
					icon='reload'
					data-qa='casepro-sync-now'
					onClick={onSync}
					disabled={isSyncing}
					title={t('CasePro_Sync_Now', { defaultValue: 'Sync now' })}
					aria-label={t('CasePro_Sync_Now', { defaultValue: 'Sync now' })}
				/>
			)}
			{canView && (
				<IconButton
					small
					icon='refresh'
					data-qa='casepro-test-connection'
					onClick={handleTestConnection}
					disabled={isFetching}
					title={t('CasePro_Test_Connection', { defaultValue: 'Test connection' })}
					aria-label={t('CasePro_Test_Connection', { defaultValue: 'Test connection' })}
				/>
			)}
		</Box>
	);
};

export default CaseProConnectionControls;
