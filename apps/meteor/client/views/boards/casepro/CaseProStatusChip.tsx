import { Icon, Tag } from '@rocket.chat/fuselage';
import type { ComponentProps, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { isStubStatus, useCaseProStatus } from './useCaseProStatus';

type CaseProStatusChipProps = Omit<ComponentProps<typeof Tag>, 'variant' | 'icon' | 'children'>;

/**
 * Small CasePro connection chip (dot + label):
 *  - stub transport (or CasePro off)  → neutral chip "Stub" (sample data);
 *  - live transport, reachable        → success chip "Connected";
 *  - live transport, unreachable      → danger chip "Unreachable" (error in the title tooltip).
 *
 * Renders nothing while the status is unknown — loading, endpoint error, or the
 * viewer lacks `boards-casepro-view` (the endpoint 403s) — no crash, no banner.
 */
const CaseProStatusChip = (props: CaseProStatusChipProps): ReactElement | null => {
	const { t } = useTranslation();
	const { status, canView, isError, isLoading } = useCaseProStatus();

	if (!canView || isError || isLoading || !status) {
		return null;
	}

	if (isStubStatus(status)) {
		return (
			<Tag
				{...props}
				data-qa='casepro-status-chip'
				data-qa-status='stub'
				variant='secondary'
				title={t('CasePro_Connection_Status', { defaultValue: 'CasePro connection status' })}
			>
				<Icon name='circle' size='x12' mie={4} color='annotation' />
				{t('CasePro_Mode_Stub', { defaultValue: 'Stub' })}
			</Tag>
		);
	}

	if (status.reachable) {
		const latencyPart = status.latencyMs !== undefined ? ` · ${status.latencyMs}ms` : '';
		return (
			<Tag
				{...props}
				data-qa='casepro-status-chip'
				data-qa-status='connected'
				variant='secondary'
				title={`${t('CasePro_Mode_Live', { defaultValue: 'Live' })}${latencyPart}`}
			>
				<Icon name='success-circle' size='x12' mie={4} color='status-font-on-success' />
				{t('CasePro_Connected', { defaultValue: 'Connected' })}
			</Tag>
		);
	}

	return (
		<Tag
			{...props}
			data-qa='casepro-status-chip'
			data-qa-status='unreachable'
			variant='secondary-danger'
			title={status.error || t('CasePro_Unreachable', { defaultValue: 'Unreachable' })}
		>
			<Icon name='error-circle' size='x12' mie={4} color='status-font-on-danger' />
			{t('CasePro_Unreachable', { defaultValue: 'Unreachable' })}
		</Tag>
	);
};

export default CaseProStatusChip;
