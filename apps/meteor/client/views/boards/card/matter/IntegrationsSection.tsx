import type { IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import { Box, Icon, Tag } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import MatterSection from './MatterSection';

type IntegrationsSectionProps = {
	snapshot: Serialized<IMatterSnapshot>;
};

/**
 * Integrations row — which sibling Omnis products already know this matter.
 * The snapshot carries opaque ids (litboxWorkspaceId / medchronMatterId) but
 * there is NO admin-configured web-URL setting for either product, so these
 * render as informational tags (id in the tooltip) rather than links — we
 * never invent URLs. When a LitBox/MedChron web-URL setting lands, upgrading
 * these to deep links is a one-liner each.
 */
const IntegrationsSection = ({ snapshot }: IntegrationsSectionProps): ReactElement | null => {
	const { t } = useTranslation();

	if (!snapshot.litboxWorkspaceId && !snapshot.medchronMatterId) {
		return null;
	}

	return (
		<MatterSection title={t('Boards_Matters_Integrations', { defaultValue: 'Integrations' })} icon='clip'>
			<Box display='flex' flexWrap='wrap' alignItems='center' style={{ gap: '6px' }}>
				{snapshot.litboxWorkspaceId && (
					<Tag
						variant='secondary'
						title={`${t('Boards_Matters_LitBox_Workspace', { defaultValue: 'LitBox workspace' })}: ${snapshot.litboxWorkspaceId}`}
					>
						<Icon name='clip' size='x12' mie={4} />
						{t('Boards_Matters_LitBox_Workspace', { defaultValue: 'LitBox workspace' })}
					</Tag>
				)}
				{snapshot.medchronMatterId && (
					<Tag
						variant='secondary'
						title={`${t('Boards_Matters_MedChron_Matter', { defaultValue: 'MedChron matter' })}: ${snapshot.medchronMatterId}`}
					>
						<Icon name='file' size='x12' mie={4} />
						{t('Boards_Matters_MedChron_Matter', { defaultValue: 'MedChron matter' })}
					</Tag>
				)}
			</Box>
		</MatterSection>
	);
};

export default IntegrationsSection;
