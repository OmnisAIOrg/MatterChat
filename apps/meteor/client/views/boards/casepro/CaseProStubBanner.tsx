import { Box, Callout } from '@rocket.chat/fuselage';
import type { ComponentProps, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCaseProStubMode } from './useCaseProStatus';

type CaseProStubBannerProps = {
	/** 'matters' → warning "stub mode" callout; 'leads' → info "local-only intake" callout. */
	variant?: 'matters' | 'leads';
} & Omit<ComponentProps<typeof Box>, 'variant'>;

/**
 * Shared "you are looking at fabricated data" banner. Shows whenever the stub
 * transport is active (per the status endpoint, falling back to the public
 * `CasePro_Transport` / `CasePro_Enabled` settings) — NOT off `CasePro_Enabled`
 * alone, which used to hide the warning while stub rows were displayed.
 * Renders nothing in live mode. Extra props (spacing etc.) go to the wrapper Box.
 */
const CaseProStubBanner = ({ variant = 'matters', ...props }: CaseProStubBannerProps): ReactElement | null => {
	const { t } = useTranslation();
	const isStub = useCaseProStubMode();

	if (!isStub) {
		return null;
	}

	if (variant === 'leads') {
		return (
			<Box data-qa='casepro-stub-banner' {...props}>
				<Callout type='info' icon='info-circled' title={t('Boards_Leads_LocalOnly_Title', { defaultValue: 'Intake is local-only' })}>
					{t('Boards_Leads_LocalOnly_Description', {
						defaultValue:
							'CasePro is not connected, so leads stay on this board and are not synced to CasePro intake. Enable CasePro to sync.',
					})}
				</Callout>
			</Box>
		);
	}

	return (
		<Box data-qa='casepro-stub-banner' {...props}>
			<Callout type='warning' icon='info' title={t('Boards_Matters_Stub_Title', { defaultValue: 'CasePro is in stub mode' })}>
				{t('Boards_Matters_Stub_Description', {
					defaultValue: 'CasePro is not connected — matters shown here use sample data, not live records.',
				})}
			</Callout>
		</Box>
	);
};

export default CaseProStubBanner;
