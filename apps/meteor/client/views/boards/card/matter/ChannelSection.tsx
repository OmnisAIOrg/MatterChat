import type { IBoardCard, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, ButtonGroup, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useSetting, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import MatterSection from './MatterSection';
import { useMatterChannel } from './useMatterChannel';

type ChannelSectionProps = {
	cardId: string;
	link: Serialized<IBoardCard>['link'];
};

/**
 * Channel ↔ matter link — create/unlink a dedicated chat channel for this
 * matter and jump straight into it.
 *
 * Linked state shows the channel name (via rooms.info), the CasePro comms-log
 * status (linked channels log to CasePro by default; the per-channel opt-out
 * lives in the channel's Edit panel), a "Jump to channel" action that routes
 * into the room, and Unlink. Unlinked state offers Create channel
 * (`boards.matters.linkChannel` binds a fresh private group to the card).
 */
const ChannelSection = ({ cardId, link }: ChannelSectionProps): ReactElement => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();

	const linkChannel = useEndpoint('POST', '/v1/boards.matters.linkChannel');
	const unlinkChannel = useEndpoint('POST', '/v1/boards.matters.unlinkChannel');

	const { roomId, room: linkedRoom, canJump, jumpToChannel } = useMatterChannel(link);

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
	};

	const linkMutation = useMutation({
		mutationFn: () => linkChannel({ cardId }),
		onSuccess: () => {
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Matters_Channel_Linked', { defaultValue: 'Channel created and linked to this matter' }),
			});
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const unlinkMutation = useMutation({
		mutationFn: () => unlinkChannel({ cardId }),
		onSuccess: invalidate,
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	// Comms-log status: linked channels log to CasePro by default; the per-channel
	// opt-out lives in the channel's Edit panel ("Log to CasePro").
	const caseProEnabled = useSetting('CasePro_Enabled', false);
	const commsLogEnabledGlobally = useSetting('CasePro_Comms_Log_Enabled', true);
	const commsLogOn = Boolean(caseProEnabled && commsLogEnabledGlobally && linkedRoom && linkedRoom.caseProCommsLog?.enabled !== false);

	return (
		<MatterSection title={t('Boards_Matters_Channel', { defaultValue: 'Channel' })} icon='hash'>
			{roomId ? (
				<Box>
					<Box display='flex' alignItems='center' flexWrap='wrap' marginBlockEnd={8} style={{ gap: '6px' }}>
						<Tag>
							<Icon name='hash' size='x16' />{' '}
							{linkedRoom?.name ?? t('Boards_Matters_Channel_LinkedShort', { defaultValue: 'Channel linked' })}
						</Tag>
						{linkedRoom && (
							<Tag variant={commsLogOn ? 'primary' : undefined}>
								{commsLogOn
									? t('Boards_Matters_Comms_Log_On', { defaultValue: 'Logging to CasePro: On' })
									: t('Boards_Matters_Comms_Log_Off', { defaultValue: 'Logging to CasePro: Off' })}
							</Tag>
						)}
					</Box>
					<ButtonGroup>
						<Button small primary onClick={jumpToChannel} disabled={!canJump}>
							<Icon name='arrow-jump' size='x14' marginInlineEnd={4} />
							{t('Boards_Matters_Jump_To_Channel', { defaultValue: 'Jump to channel' })}
						</Button>
						<Button small onClick={(): void => unlinkMutation.mutate()} disabled={unlinkMutation.isPending}>
							{unlinkMutation.isPending ? (
								<Throbber inheritColor size='x12' />
							) : (
								t('Boards_Matters_Channel_Unlink', { defaultValue: 'Unlink' })
							)}
						</Button>
					</ButtonGroup>
				</Box>
			) : (
				<Button small primary onClick={(): void => linkMutation.mutate()} disabled={linkMutation.isPending}>
					{linkMutation.isPending ? (
						<Throbber inheritColor size='x12' />
					) : (
						<>
							<Icon name='plus' size='x14' marginInlineEnd={4} />
							{t('Boards_Matters_Channel_Create', { defaultValue: 'Create channel' })}
						</>
					)}
				</Button>
			)}
		</MatterSection>
	);
};

export default ChannelSection;
