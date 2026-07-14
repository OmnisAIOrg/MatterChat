import { useEndpoint, usePermission, useSetting } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * CasePro connection status (client side).
 *
 * Wraps GET /v1/boards.casepro.status — the "is CasePro real?" probe that ships
 * with the live transport. The endpoint is guarded by the `boards-casepro-view`
 * permission, so the query only runs for holders of that permission; a 403 (or
 * any transport error) simply leaves `status` undefined and consumers render
 * nothing rather than an error state.
 */

export type CaseProConnectionStatus = {
	enabled: boolean;
	/** 'stub' = fabricated sample rows; anything else ('native' | 'mcp') = live. */
	transport: 'stub' | 'native' | 'mcp' | string;
	baseUrl: string;
	authMode: string;
	orgId: string;
	reachable: boolean;
	latencyMs?: number;
	error?: string;
};

export const caseProStatusQueryKey = ['boards', 'casepro', 'status'] as const;

export const useCaseProStatus = () => {
	const canView = usePermission('boards-casepro-view');
	const getStatus = useEndpoint('GET', '/v1/boards.casepro.status');

	const { data, isLoading, isError, isFetching, refetch } = useQuery({
		queryKey: caseProStatusQueryKey,
		queryFn: () => getStatus({}),
		enabled: canView,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		retry: false,
	});

	const status = data?.status as CaseProConnectionStatus | undefined;

	return { status, canView, isLoading, isError, isFetching, refetch };
};

/** True when boards data is fabricated (CasePro off, or the stub transport is active). */
export const isStubStatus = (status: CaseProConnectionStatus): boolean => !status.enabled || status.transport === 'stub';

/**
 * Should the "sample data" banner show? Prefers the live status endpoint; when
 * that is unavailable (viewer lacks `boards-casepro-view`, or the probe errored)
 * it falls back to the public settings. `CasePro_Transport` defaults to 'stub'
 * client-side, so a missing/unsynced value fails safe — the banner shows.
 *
 * Note this intentionally no longer keys off `CasePro_Enabled` alone: with the
 * master switch on but the stub transport active, the old check hid the warning
 * while fabricated rows were displayed.
 */
export const useCaseProStubMode = (): boolean => {
	const { status, canView, isError } = useCaseProStatus();
	const enabledSetting = useSetting('CasePro_Enabled', false);
	const transportSetting = useSetting('CasePro_Transport', 'stub');

	if (canView && !isError && status) {
		return isStubStatus(status);
	}

	return !enabledSetting || transportSetting === 'stub';
};
