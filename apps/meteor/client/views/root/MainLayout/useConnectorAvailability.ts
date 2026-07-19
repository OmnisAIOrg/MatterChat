import type { ExternalWorkspaceAvailability } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * useConnectorAvailability — which external-workspace connectors this server can offer,
 * computed server-side (settings AND env fallbacks) via GET /v1/external-workspaces.availability.
 *
 * This replaces the public-settings gate for the "Connect a workspace" surface: env-enabled
 * connectors (e.g. TEAMS_ENABLED=true with no admin setting) are invisible to `useSetting`,
 * which used to hide a fully-working connector from the add menu. Falls back to all-disabled
 * while loading — callers should render a loading state, not hide the surface.
 */
const FALLBACK: ExternalWorkspaceAvailability = {
	slack: { enabled: false, configured: false },
	teams: { enabled: false, configured: false },
	google: { enabled: false, configured: false },
};

export const useConnectorAvailability = (): { availability: ExternalWorkspaceAvailability; isLoading: boolean } => {
	const getAvailability = useEndpoint('GET', '/v1/external-workspaces.availability');
	const { data, isLoading } = useQuery({
		queryKey: ['external-workspaces', 'availability'],
		queryFn: () => getAvailability(),
		staleTime: 60_000,
		refetchOnMount: 'always',
	});
	return { availability: data?.availability ?? FALLBACK, isLoading };
};
