import type { ReactElement } from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
	Box,
	Button,
	ButtonGroup,
	Modal,
	ModalHeader,
	ModalTitle,
	ModalClose,
	ModalContent,
	ModalFooter,
	Throbber,
	Icon,
} from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';

// MATTERCHAT: Guest invite modal for adding guest users to boards.
// Guests can only access invited boards/channels and have watermarked exports.

type GuestInviteModalProps = {
	boardId: string;
	boardTitle: string;
	onClose: () => void;
};

const GuestInviteModal = ({ boardId, boardTitle, onClose }: GuestInviteModalProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const [emails, setEmails] = useState('');
	const [message, setMessage] = useState('');

	const inviteMutation = useMutation({
		mutationFn: async () => {
			const emailList = emails
				.split('\n')
				.map((e) => e.trim())
				.filter((e) => e.length > 0);

			if (emailList.length === 0) {
				throw new Error('At least one email address is required');
			}

			const response = await fetch('/api/v1/boards.inviteGuests', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					boardId,
					emails: emailList,
					message: message || undefined,
				}),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to invite guests');
			}

			return response.json();
		},
		onSuccess: (result) => {
			dispatchToastMessage({
				type: 'success',
				message: t('Guests_Invited_Successfully', {
					count: result.invited ?? 0,
					defaultValue: `Invited {{count}} guest(s) to the board`,
				}),
			});
			onClose();
		},
		onError: (error) => {
			dispatchToastMessage({
				type: 'error',
				message: error instanceof Error ? error.message : t('Error_Inviting_Guests', { defaultValue: 'Error inviting guests' }),
			});
		},
	});

	const handleInvite = useCallback(() => {
		inviteMutation.mutate();
	}, [inviteMutation]);

	return (
		<Modal open={true} onClose={onClose}>
			<ModalHeader>
				<ModalTitle>{t('Invite_Guests_To_Board', { defaultValue: 'Invite Guests to Board' })}</ModalTitle>
				<ModalClose onClick={onClose} />
			</ModalHeader>
			<ModalContent>
				<Box display='flex' flexDirection='column' gap={16}>
					<Box>
						<Box fontScale='p2' fontWeight='500' marginBlockEnd={8}>
							{t('Guest_Email_Addresses', { defaultValue: 'Email Addresses' })}
						</Box>
						<textarea
							style={{
								width: '100%',
								padding: '8px',
								borderRadius: '9px',
								border: '1px solid #E7E6E0',
								fontFamily: 'inherit',
								fontSize: '13px',
								minHeight: '120px',
								resize: 'vertical',
							}}
							placeholder={t('Enter_Email_Addresses_One_Per_Line', { defaultValue: 'Enter email addresses, one per line' })}
							value={emails}
							onChange={(e) => setEmails(e.currentTarget.value)}
						/>
						<Box fontScale='p3' color='hint' marginBlockStart={4}>
							{t('Guest_Email_Help_Text', {
								defaultValue: 'Enter one email address per line. Guests can only access invited boards and channels.',
							})}
						</Box>
					</Box>

					<Box>
						<Box fontScale='p2' fontWeight='500' marginBlockEnd={8}>
							{t('Invitation_Message', { defaultValue: 'Invitation Message' })} {t('Optional')}
						</Box>
						<textarea
							style={{
								width: '100%',
								padding: '8px',
								borderRadius: '9px',
								border: '1px solid #E7E6E0',
								fontFamily: 'inherit',
								fontSize: '13px',
								minHeight: '80px',
								resize: 'vertical',
							}}
							placeholder={t('Enter_Optional_Invitation_Message', { defaultValue: 'Enter optional invitation message...' })}
							value={message}
							onChange={(e) => setMessage(e.currentTarget.value)}
						/>
					</Box>

					<Box
						backgroundColor='surface2'
						padding={12}
						borderRadius={9}
						fontScale='p2'
						color='hint'
						display='flex'
						gap={8}
						alignItems='flex-start'
					>
						<Icon name='info' size={16} flexShrink={0} />
						<Box>
							{t('Guest_Permissions_Info', {
								defaultValue:
									'Guests will be assigned observer role on this board. They cannot create channels or access the directory. All exports will be watermarked.',
							})}
						</Box>
					</Box>
				</Box>
			</ModalContent>
			<ModalFooter>
				<ButtonGroup>
					<Button onClick={onClose}>{t('Boards_Export_Cancel', { defaultValue: 'Cancel' })}</Button>
					<Button
						primary
						onClick={handleInvite}
						disabled={inviteMutation.isPending || emails.trim().length === 0}
					>
						{inviteMutation.isPending ? <Throbber /> : null}
						{t('Send_Invitations', { defaultValue: 'Send Invitations' })}
					</Button>
				</ButtonGroup>
			</ModalFooter>
		</Modal>
	);
};

export default GuestInviteModal;
