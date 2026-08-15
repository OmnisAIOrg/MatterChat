import type { FirmInfoDTO } from '@rocket.chat/rest-typings';
import { useEndpoint, useSetting, useUserId } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

import { firmMineQueryKey } from './console/firmConsole';

/**
 * MATTERCHAT: "does this user belong to a firm, and do they own it?"
 *
 * Extracted so the navigation rail can ask the question in one line instead of
 * carrying a query of its own. Gated on `Firms_SelfServe_Enabled` and on being
 * logged in, so a workspace with firms turned off issues no request at all —
 * this runs on every screen, and a dead feature should cost nothing.
 *
 * `staleTime: Infinity` because firm membership does not change while you are
 * looking at the app; the console invalidates {@link firmMineQueryKey} itself
 * when something happens that would change the answer.
 */
export const useMyFirm = (): { firm: FirmInfoDTO | null; isLoading: boolean } => {
	const selfServeEnabled = useSetting('Firms_SelfServe_Enabled', false);
	const userId = useUserId();
	const getMyFirm = useEndpoint('GET', '/v1/firms.mine');

	const { data, isLoading } = useQuery({
		queryKey: firmMineQueryKey,
		queryFn: () => getMyFirm(),
		enabled: selfServeEnabled === true && Boolean(userId),
		staleTime: Infinity,
	});

	return { firm: data?.firm ?? null, isLoading };
};
