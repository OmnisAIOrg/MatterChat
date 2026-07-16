import { Box } from '@rocket.chat/fuselage';
import type { ComponentProps, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { isStubStatus, useCaseProStatus } from './useCaseProStatus';

type CaseProStatusChipProps = Omit<ComponentProps<typeof Box>, 'children'>;

/**
 * CasePro connection state as a TINY dot + word (Ledger-dense chrome — not a
 * chip):
 *  - live transport, reachable        → green dot, word "CasePro" (Live · latency in the tooltip);
 *  - stub transport (or CasePro off)  → amber dot, word "Stub" (sample data);
 *  - live transport, unreachable      → red dot, word "Unreachable" (error in the tooltip).
 *
 * Dot colors come from the boards-chrome Ledger stylesheet
 * (../BoardsChromeStyleTags.tsx) via `.mc-cp-dot[data-state=…]`.
 *
 * Renders nothing while the status is unknown — loading, endpoint error, or the
 * viewer lacks `boards-casepro-view` (the endpoint 403s) — no crash, no banner.
 * The `data-qa` / `data-qa-status` hooks are unchanged from the Tag version.
 */
const CaseProStatusChip = (props: CaseProStatusChipProps): ReactElement | null => {
	const { t } = useTranslation();
	const { status, canView, isError, isLoading } = useCaseProStatus();

	if (!canView || isError || isLoading || !status) {
		return null;
	}

	if (isStubStatus(status)) {
		return (
			<Box
				is='span'
				{...props}
				className='mc-cp-status'
				data-qa='casepro-status-chip'
				data-qa-status='stub'
				title={t('CasePro_Connection_Status', { defaultValue: 'CasePro connection status' })}
			>
				<span className='mc-cp-dot' data-state='stub' aria-hidden='true' />
				{t('CasePro_Mode_Stub', { defaultValue: 'Stub' })}
			</Box>
		);
	}

	if (status.reachable) {
		const latencyPart = status.latencyMs !== undefined ? ` · ${status.latencyMs}ms` : '';
		return (
			<Box
				is='span'
				{...props}
				className='mc-cp-status'
				data-qa='casepro-status-chip'
				data-qa-status='connected'
				title={`${t('CasePro_Mode_Live', { defaultValue: 'Live' })}${latencyPart}`}
			>
				<span className='mc-cp-dot' data-state='connected' aria-hidden='true' />
				CasePro
			</Box>
		);
	}

	return (
		<Box
			is='span'
			{...props}
			className='mc-cp-status'
			data-qa='casepro-status-chip'
			data-qa-status='unreachable'
			title={status.error || t('CasePro_Unreachable', { defaultValue: 'Unreachable' })}
		>
			<span className='mc-cp-dot' data-state='unreachable' aria-hidden='true' />
			{t('CasePro_Unreachable', { defaultValue: 'Unreachable' })}
		</Box>
	);
};

export default CaseProStatusChip;
