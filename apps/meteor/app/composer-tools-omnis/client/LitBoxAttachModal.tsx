/**
 * MatterChat fork — "Attach from LitBox" modal (the LINK fallback).
 *
 * The opener (registerComposerActions) first tries to resolve the room's matter
 * workspace (room.matterId → CasePro snapshot → litboxWorkspaceId) and, when it
 * can, opens the real in-app MatterFilesModal instead of this modal. This modal
 * therefore only handles the fallback cases — no matter on the room, or a matter
 * whose workspace could not be resolved — and inserts a link to the real in-app
 * Files route (`/litbox`, the LitboxFilesView the left rail mounts). The old
 * `/admin/litbox*` hrefs pointed at routes that never existed.
 */
import type { IRoom } from '@rocket.chat/core-typings';
import {
	Box,
	Button,
	Icon,
	Modal,
	ModalClose,
	ModalContent,
	ModalFooter,
	ModalFooterControllers,
	ModalHeader,
	ModalHeaderText,
	ModalTitle,
} from '@rocket.chat/fuselage';

type LitBoxAttachModalProps = {
	room?: IRoom;
	onInsert: (text: string) => void;
	onClose: () => void;
};

// The real in-app Files route (LitboxFilesView). Rooms carry matterId/matterCardId,
// NOT a workspace id — when the opener resolved one it opened MatterFilesModal and
// this modal never rendered, so every link from here targets the org Files page.
const LITBOX_ROUTE = '/litbox';

const resolveScope = (room?: IRoom): { matterLinked: boolean; href: string; label: string } => {
	const label = room?.fname || room?.name || 'this channel';
	return { matterLinked: Boolean(room?.matterId), href: LITBOX_ROUTE, label };
};

const LitBoxAttachModal = ({ room, onInsert, onClose }: LitBoxAttachModalProps) => {
	const { matterLinked, href, label } = resolveScope(room);
	const url = `${window.location.origin}${href}`;

	const handleInsert = (): void => {
		const text = `📎 [Open Files (LitBox)](${url})`;
		onInsert(text);
		onClose();
	};

	return (
		<Modal>
			<ModalHeader>
				<ModalHeaderText>
					<ModalTitle>Attach from LitBox</ModalTitle>
				</ModalHeaderText>
				<ModalClose aria-label='Close' onClick={onClose} />
			</ModalHeader>
			<ModalContent>
				<Box display='flex' alignItems='center' marginBlockEnd={12}>
					<Icon name='file-document' size='x24' marginInlineEnd={8} />
					<Box>
						{matterLinked ? (
							<>
								The matter workspace for <b>{label}</b> couldn&rsquo;t be resolved right now — this will link to your organization&rsquo;s
								Files page instead.
							</>
						) : (
							<>
								No matter is linked to <b>{label}</b> — this will link to your organization&rsquo;s Files page.
							</>
						)}
					</Box>
				</Box>
				<Box fontScale='c1' color='hint'>
					Insert a link to the Files page, or open it to browse and copy a specific document link. Opening Files requires access to your
					organization&rsquo;s LitBox.
				</Box>
			</ModalContent>
			<ModalFooter>
				<ModalFooterControllers>
					<Button is='a' href={href} target='_blank' rel='noopener noreferrer'>
						Open Files
					</Button>
					<Button primary onClick={handleInsert}>
						Insert link
					</Button>
				</ModalFooterControllers>
			</ModalFooter>
		</Modal>
	);
};

export default LitBoxAttachModal;
