/**
 * MatterChat fork — "Attach from LitBox" modal.
 *
 * Scoping mirrors the boards MatterPanel pattern: if the room is linked to a
 * matter workspace (room.litboxWorkspaceId / matterId) we point at that
 * workspace, otherwise we fall back to the organization's LitBox. On confirm we
 * insert a clickable reference link into the composer. There is no embeddable
 * LitBox picker component in this repo (MatterPanel itself only links out), so
 * this reproduces that link-out pattern rather than inventing a picker; the
 * LitBox route needs a real session/token to fully load — same caveat as boards.
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

/** Optional matter-linkage fields the fork may attach to a room. */
type MatterLinkedRoom = IRoom & {
	litboxWorkspaceId?: string;
	matterId?: string;
	matterCardId?: string;
	matterName?: string;
};

type LitBoxAttachModalProps = {
	room?: MatterLinkedRoom;
	onInsert: (text: string) => void;
	onClose: () => void;
};

const resolveScope = (room?: MatterLinkedRoom): { scoped: boolean; href: string; label: string } => {
	const workspaceId = room?.litboxWorkspaceId;
	const label = room?.matterName || room?.fname || room?.name || 'this channel';
	if (workspaceId) {
		return { scoped: true, href: `/admin/litbox/workspaces/${workspaceId}`, label };
	}
	return { scoped: false, href: '/admin/litbox', label };
};

const LitBoxAttachModal = ({ room, onInsert, onClose }: LitBoxAttachModalProps) => {
	const { scoped, href, label } = resolveScope(room);
	const url = `${window.location.origin}${href}`;

	const handleInsert = (): void => {
		const text = scoped ? `📎 Matter files — [Open in LitBox](${url})` : `📎 [Open files in LitBox](${url})`;
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
				<Box display='flex' alignItems='center' mbe={12}>
					<Icon name='file-document' size='x24' mie={8} />
					<Box>
						{scoped ? (
							<>
								Files are scoped to the matter workspace linked to <b>{label}</b>.
							</>
						) : (
							<>
								No matter workspace is linked to <b>{label}</b> — this will reference your organization&rsquo;s LitBox.
							</>
						)}
					</Box>
				</Box>
				<Box fontScale='c1' color='hint'>
					Insert a link to the files, or open LitBox to browse and copy a specific document link. Opening LitBox requires access to your
					organization&rsquo;s files.
				</Box>
			</ModalContent>
			<ModalFooter>
				<ModalFooterControllers>
					<Button is='a' href={href} target='_blank' rel='noopener noreferrer'>
						Open in LitBox
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
