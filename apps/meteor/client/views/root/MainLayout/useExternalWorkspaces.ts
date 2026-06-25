import type { ExternalProvider } from '@rocket.chat/core-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * useExternalWorkspaces — the caller's OWN connected external workspaces (Slack / Teams / Google Chat).
 *
 * Reads `external-workspaces.list` (per-user, no secrets). The org-switcher rail uses this to render
 * a tile for EACH connected external workspace — e.g. a "Teams" tile and/or a "Google Chat" tile once
 * the user has the matching connection. Standalone-safe: when nothing is connected the list is empty
 * and no external tiles render.
 *
 * Provider-agnostic: `externalConnections` is the full list of renderable tiles (one per provider
 * connection), `getConnectionById` resolves the selected tile back to its connection, and the named
 * `teamsConnection` / `googleConnection` are convenience lookups for callers that want one provider.
 */

/**
 * The connection shape AS THE LIST ENDPOINT RETURNS IT — the serialized form (Date fields arrive as
 * strings over the wire). Derived from the endpoint's own return type so consumers always line up
 * with what the API actually sends; this is the type the rail tiles + workspace views consume.
 */
export type ConnectedExternalWorkspace = Awaited<
	ReturnType<ReturnType<typeof useEndpoint<'GET', '/v1/external-workspaces.list'>>>
>['connections'][number];

/** For a given provider, prefer a fully-connected connection; else surface any (so an errored/consent
 * connection still gets a tile + an explanatory panel). */
const pickConnection = (connections: ConnectedExternalWorkspace[], provider: ExternalProvider): ConnectedExternalWorkspace | undefined => {
	const ofProvider = connections.filter((c) => c.provider === provider);
	return ofProvider.find((c) => c.status === 'connected') ?? ofProvider[0];
};

export const useExternalWorkspaces = (): {
	connections: ConnectedExternalWorkspace[];
	/** One renderable tile per provider connection (deduped: the best connection per provider). */
	externalConnections: ConnectedExternalWorkspace[];
	getConnectionById: (id: string | undefined) => ConnectedExternalWorkspace | undefined;
	teamsConnection: ConnectedExternalWorkspace | undefined;
	googleConnection: ConnectedExternalWorkspace | undefined;
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

	const connections: ConnectedExternalWorkspace[] = data?.connections ?? [];

	const teamsConnection = pickConnection(connections, 'teams');
	const googleConnection = pickConnection(connections, 'google');

	// The tiles to render: the best connection per external provider, in a stable order (Teams first,
	// then Google) so the rail is deterministic. Slack is surfaced separately (admin SlackBridge).
	const externalConnections = [teamsConnection, googleConnection].filter((c): c is ConnectedExternalWorkspace => Boolean(c));

	const getConnectionById = (id: string | undefined): ConnectedExternalWorkspace | undefined =>
		id ? connections.find((c) => c._id === id) : undefined;

	return { connections, externalConnections, getConnectionById, teamsConnection, googleConnection, isLoading };
};
