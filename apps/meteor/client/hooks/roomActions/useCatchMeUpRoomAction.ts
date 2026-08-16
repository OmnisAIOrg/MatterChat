import type { RoomToolboxActionConfig } from '@rocket.chat/ui-contexts';
import { lazy, useMemo } from 'react';

const CatchMeUp = lazy(() => import('../../views/room/contextualBar/CatchMeUp'));

/**
 * MATTERCHAT: the channel-header entry point for "Catch me up" (F4).
 *
 * The spec asks for this to be reachable "from the channel header, from the orb, and on mobile".
 * The orb and mobile both go through the Chi tool loop; this is the header, and it deliberately
 * does NOT require a model to be configured — it reads the unread messages and their jump links
 * straight from `chi.catchup`. A workspace with no LLM still gets the useful half.
 *
 * Ungated on purpose: there is no setting to be off, because there is nothing to configure and
 * nothing to spend. It is the user's own unread messages, in a list.
 */
export const useCatchMeUpRoomAction = () =>
	useMemo(
		(): RoomToolboxActionConfig => ({
			id: 'catch-me-up',
			groups: ['channel', 'group', 'team', 'direct', 'direct_multiple'],
			title: 'Chi_Catch_Me_Up',
			icon: 'clock',
			tabComponent: CatchMeUp,
			order: 19,
		}),
		[],
	);
