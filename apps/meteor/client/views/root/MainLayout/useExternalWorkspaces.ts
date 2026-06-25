import type { ExternalWorkspaceClientConnection } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * useExternalWorkspaces — the caller's OWN connected external workspaces (Slack / Teams).
 *
 * Reads `external-workspaces.list` (per-user, no secrets). The org-switcher rail uses this to render
 * a tile for each connected external workspace — e.g. a "Teams" tile once the user has a connected
 * Microsoft Teams connection, and a "Slack" tile once the user has a connected Slack workspace.
 * Standalone-safe: when nothing is connected the list is empty and no external tiles render.
 *
 * Provider-agnostic: `connectionFor(provider)` returns the best connection for a provider (prefer a
 * fully-connected one; fall back to any so a consent_required/error connection still surfaces a tile,
 * and the channels panel explains the state).
 */
export const useExternalWorkspaces = (): {
	connections: ExternalWorkspaceClientConnection[];
	teamsConnection: ExternalWorkspaceClientConnection | undefined;
	slackConnection: ExternalWorkspaceClientConnection | undefined;
	connectionFor: (provider: ExternalWorkspaceClientConnection['provider']) => ExternalWorkspaceClientConnection | undefined;
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

	const connectionFor = (provider: ExternalWorkspaceClientConnection['provider']): ExternalWorkspaceClientConnection | undefined => {
		const forProvider = connections.filter((c) => c.provider === provider);
		return forProvider.find((c) => c.status === 'connected') ?? forProvider[0];
	};

	return {
		connections,
		teamsConnection: connectionFor('teams'),
		slackConnection: connectionFor('slack'),
		connectionFor,
		isLoading,
	};
};
