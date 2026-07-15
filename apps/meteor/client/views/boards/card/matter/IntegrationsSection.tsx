import type { IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Icon, Tag } from '@rocket.chat/fuselage';
import { useSetModal } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import MatterFilesModal from '../MatterFilesModal';
import MatterSection from './MatterSection';

type IntegrationsSectionProps = {
	snapshot: Serialized<IMatterSnapshot>;
};

/**
 * Integrations row — which sibling Omnis products already know this matter, and
 * a way in.
 *
 *  - LitBox: when the matter has a `litboxWorkspaceId`, a "Files" button opens
 *    the matter's CasePro LitBox files in-place (MatterFilesModal, scoped to the
 *    workspace) so staff never leave the card to browse documents.
 *  - MedChron: an informational tag (id in the tooltip). There is no
 *    admin-configured MedChron web-URL setting, so we never invent a deep link;
 *    when one lands, upgrading this to a link is a one-liner.
 *
 * ("Open in CasePro" lives in MatterHeader.) Hides entirely when neither
 * product knows the matter.
 */
const IntegrationsSection = ({ snapshot }: IntegrationsSectionProps): ReactElement | null => {
	const { t } = useTranslation();
	const setModal = useSetModal();

	const workspaceId = snapshot.litboxWorkspaceId;

	if (!workspaceId && !snapshot.medchronMatterId) {
		return null;
	}

	const openFiles = (): void => {
		if (!workspaceId) {
			return;
		}
		setModal(
			<MatterFilesModal
				workspaceId={workspaceId}
				label={snapshot.clientName || snapshot.matterName}
				onClose={(): void => setModal(null)}
			/>,
		);
	};

	return (
		<MatterSection title={t('Boards_Matters_Integrations', { defaultValue: 'Integrations' })} icon='clip'>
			<Box display='flex' flexWrap='wrap' alignItems='center' style={{ gap: '6px' }}>
				{workspaceId && (
					<Button
						small
						onClick={openFiles}
						title={`${t('Boards_Matters_LitBox_Workspace', { defaultValue: 'LitBox workspace' })}: ${workspaceId}`}
					>
						<Icon name='clip' size='x16' mie={4} />
						{t('Boards_Matters_Files', { defaultValue: 'Files' })}
					</Button>
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
