import { isRoomFederated } from '@rocket.chat/core-typings';
import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import { usePermission, useSetting, useUser } from '@rocket.chat/ui-contexts';
import type { RoomToolboxActionConfig } from '@rocket.chat/ui-contexts';
import {
	useVideoConfDispatchOutgoing,
	useVideoConfIsCalling,
	useVideoConfIsRinging,
	useVideoConfLoadCapabilities,
} from '@rocket.chat/ui-video-conf';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoom } from '../../views/room/contexts/RoomContext';
import { useVideoConfWarning } from '../../views/room/contextualBar/VideoConference/hooks/useVideoConfWarning';
import { useCaseNotesHuddle } from '../useCaseNotesHuddle';

export const useHuddleRoomAction = () => {
	const { t } = useTranslation();
	const room = useRoom();
	const user = useUser();
	const federated = isRoomFederated(room);

	const ownUser = room.uids?.length === 1 || false;

	const permittedToPostReadonly = usePermission('post-readonly', room._id);
	const permittedToCallManagement = usePermission('call-management', room._id);

	const dispatchWarning = useVideoConfWarning();
	const dispatchPopup = useVideoConfDispatchOutgoing();
	const loadCapabilities = useVideoConfLoadCapabilities();
	const isCalling = useVideoConfIsCalling();
	const isRinging = useVideoConfIsRinging();

	// CaseNotes auto-notes hook (best-effort)
	const { notifyHuddleStart } = useCaseNotesHuddle();

	const enabledForDMs = useSetting('VideoConf_Enable_DMs', true);
	const enabledForChannels = useSetting('VideoConf_Enable_Channels', true);
	const enabledForTeams = useSetting('VideoConf_Enable_Teams', true);
	const enabledForGroups = useSetting('VideoConf_Enable_Groups', true);

	const groups = [
		enabledForDMs && 'direct',
		enabledForDMs && 'direct_multiple',
		enabledForGroups && 'group',
		enabledForTeams && 'team',
		enabledForChannels && 'channel',
	].filter((g): g is RoomToolboxActionConfig['groups'][number] => !!g);

	const visible = groups.length > 0;
	const allowed = visible && permittedToCallManagement && (!user?.username || !room.muted?.includes(user.username)) && !ownUser;
	const disabled = federated || (!!room.ro && !permittedToPostReadonly) || room.archived;
	const tooltip = disabled ? t('core.Video_Call_unavailable_for_this_type_of_room') : undefined;

	const handleStartHuddle = useStableCallback(async () => {
		if (isCalling || isRinging) {
			return;
		}

		try {
			await loadCapabilities();
			// Notify CaseNotes of huddle start (best-effort, non-blocking)
			notifyHuddleStart(room._id).catch(() => {
				// Silently fail - CaseNotes integration is optional
			});
			dispatchPopup({ rid: room._id });
		} catch (error: any) {
			dispatchWarning(error.error);
		}
	});

	return useMemo((): RoomToolboxActionConfig | undefined => {
		if (!allowed) {
			return undefined;
		}

		return {
			id: 'start-huddle',
			title: 'Start_Huddle',
			icon: 'mic',
			featured: true,
			action: handleStartHuddle,
			order: 2,
			groups,
			disabled,
			tooltip,
		};
	}, [allowed, groups, disabled, handleStartHuddle, tooltip]);
};
