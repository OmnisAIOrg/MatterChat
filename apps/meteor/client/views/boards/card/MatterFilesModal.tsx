import { Box, Modal, ModalHeader, ModalTitle, ModalClose, ModalContent, Throbber } from '@rocket.chat/fuselage';
import { useUserId } from '@rocket.chat/ui-contexts';
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';

import LitboxEmbedBoundary from '../../litbox/LitboxEmbedBoundary';

/**
 * MatterFilesModal — browse ONE matter's CasePro LitBox files without leaving the
 * board card.
 *
 * It reuses the exact same embedded LitBox browser the `/litbox` Files page mounts
 * (`../../litbox/LitboxEmbed`), but scoped to the matter's LitBox workspace via the
 * `workspaceId` prop (instead of the org-wide view). The heavy
 * `@omnisaiorg/litbox-file-browser` package is loaded lazily here too, so opening a
 * card that never opens Files pays no bundle cost.
 *
 * The browser-side token is the caller's own MatterChat session token; the
 * `/_litbox` proxy validates it and injects the real LitBox credential server-side
 * (same contract as LitboxEmbed / LitboxFilesView). The embed is wrapped in
 * LitboxEmbedBoundary so a failure to load it degrades to an inline callout inside
 * the modal instead of white-screening the whole client.
 */
const LitboxEmbed = lazy(() => import('../../litbox/LitboxEmbed'));

type MatterFilesModalProps = {
	// The matter's CasePro LitBox workspace id (snapshot.litboxWorkspaceId). Required —
	// the opener only renders this modal when a workspace id is present.
	workspaceId: string;
	// Optional label for the modal title (e.g. the client's name).
	label?: string;
	onClose: () => void;
};

const MatterFilesModal = ({ workspaceId, label, onClose }: MatterFilesModalProps) => {
	const { t } = useTranslation();
	const userId = useUserId();
	const authToken = userId ? (window.localStorage.getItem('Meteor.loginToken') ?? '') : '';

	return (
		<Modal style={{ width: 'min(92vw, 1040px)', maxWidth: '92vw', height: '86vh', maxHeight: '90vh' }}>
			<ModalHeader>
				<ModalTitle>
					{t('Boards_Matters_Files', { defaultValue: 'Files' })}
					{label ? ` — ${label}` : ''}
				</ModalTitle>
				<ModalClose onClick={onClose} />
			</ModalHeader>
			<ModalContent>
				<Box display='flex' flexDirection='column' height='100%' style={{ minHeight: 0 }}>
					<LitboxEmbedBoundary>
						<Suspense
							fallback={
								<Box display='flex' justifyContent='center' alignItems='center' height='100%'>
									<Throbber />
								</Box>
							}
						>
							<LitboxEmbed authToken={authToken} workspaceId={workspaceId} />
						</Suspense>
					</LitboxEmbedBoundary>
				</Box>
			</ModalContent>
		</Modal>
	);
};

export default MatterFilesModal;
