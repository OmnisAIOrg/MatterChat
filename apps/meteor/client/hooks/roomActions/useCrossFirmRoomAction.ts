import type { RoomToolboxActionConfig } from '@rocket.chat/ui-contexts';
import { useSetting } from '@rocket.chat/ui-contexts';
import { lazy, useMemo } from 'react';

const CrossFirm = lazy(() => import('../../views/room/contextualBar/CrossFirm'));

/**
 * Per-channel "Cross-firm · Opposing counsel" room action. Gated by the public CrossFirm_Enabled
 * setting (off by default — MatterChat is fully functional without it). CasePro-free: the panel keys
 * on the channel rid, so it works for any room with no Omnis suite integration.
 */
export const useCrossFirmRoomAction = () => {
	const enabled = useSetting('CrossFirm_Enabled', false);
	return useMemo((): RoomToolboxActionConfig | undefined => {
		if (!enabled) {
			return undefined;
		}
		return {
			id: 'cross-firm',
			groups: ['channel', 'group', 'team', 'direct', 'direct_multiple'],
			title: 'Cross-firm' as RoomToolboxActionConfig['title'],
			// 'balance' ships in the fork's icon font but is missing from the generated icon-name
			// union — type-level cast only.
			icon: 'balance' as RoomToolboxActionConfig['icon'],
			tabComponent: CrossFirm,
			order: 20,
		};
	}, [enabled]);
};
