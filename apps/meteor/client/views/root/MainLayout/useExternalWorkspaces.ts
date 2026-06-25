import type { ExternalWorkspaceClientConnection } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * useExternalWorkspaces — the caller's OWN connected external workspaces (Slack / Teams).
 *
 * Reads `external-workspaces.list` (per-user, no secrets). The org-switcher rail uses this to render
 * a tile for each connected external workspace — e.g. a "Teams" tile once the user has a connected
 * Microsoft Teams connection. Standalone-safe: when nothing is connected the list is empty and no
 * external tiles render.
 */
export const useExternalWorkspaces = (): {
	connections: ExternalWorkspaceClientConnection[];
	teamsConnection: ExternalWorkspaceClientConnection | undefined;
	isLoading: boolean;
} => {
	const listConnections = useEndpoint('GET', '/v1/external-workspaces.list');

	const { data, isLoading } = useQuery({
		queryKey: ['external-workspaces.list'],
		queryFn: () => listConnections(),
		// Connections change only on connect/disconnect (a full-page redirect), so this rarely needs
		// to refetch; a short stale time keeps the rail from hammering the endpoint.
		staleTime: 30_000,
	});

	const connections = data?.connections ?? [];
	// Prefer a fully-connected Teams connection; fall back to any teams connection so a
	// consent_required / error connection still surfaces a tile (the panel explains the state).
	const teamsConnections = connections.filter((c) => c.provider === 'teams');
	const teamsConnection = teamsConnections.find((c) => c.status === 'connected') ?? teamsConnections[0];

	return { connections, teamsConnection, isLoading };
};
