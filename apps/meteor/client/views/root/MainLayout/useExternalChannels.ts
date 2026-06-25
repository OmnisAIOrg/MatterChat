import type { ExternalProvider } from '@rocket.chat/core-typings';
import type { ExternalWorkspaceChannelGroup } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * useExternalChannels — the REAL channels for one of the caller's OWN external-workspace connections,
 * provider-AGNOSTIC (Slack or Teams).
 *
 * Calls `external-workspaces.channels`, which loads the connection (ownership-scoped), decrypts the
 * stored credentials, and runs the provider's live `listChannels` (Teams: GET /me/joinedTeams ->
 * /teams/{id}/channels via Graph; Slack: GET conversations.list via the Web API). The result is a
 * discriminated envelope: on a provider/auth/config error the endpoint returns `{ ok:false, error,
 * message }` (NOT swallowed) so we surface the real message here for the panel to show plainly.
 *
 * Pass either a `connectionId` (preferred) or the `provider` (the endpoint then uses the user's most
 * recent connected connection for that provider). `enabled` gates the fetch so it only runs while the
 * tile is actually selected.
 */
export const useExternalChannels = (
	provider: ExternalProvider,
	connectionId: string | undefined,
	enabled: boolean,
): {
	groups: ExternalWorkspaceChannelGroup[] | undefined;
	error: { error: string; message: string; status?: number } | undefined;
	isLoading: boolean;
	isError: boolean;
	refetch: () => void;
} => {
	const getChannels = useEndpoint('GET', '/v1/external-workspaces.channels');

	const query = useQuery({
		queryKey: ['external-workspaces.channels', provider, connectionId ?? provider],
		queryFn: () => (connectionId ? getChannels({ connectionId }) : getChannels({ provider })),
		enabled,
		// Live provider data; don't hammer it, but let a manual refetch pull fresh channels.
		staleTime: 15_000,
		retry: false,
	});

	// The endpoint resolves with `ok:false` for a real provider error (it does NOT throw), so a
	// transport/unexpected throw is the only thing that lands in query.isError.
	const { data } = query;
	const providerError = data?.ok === false ? { error: data.error, message: data.message, status: data.status } : undefined;
	const transportError = query.isError
		? { error: 'request_failed', message: query.error instanceof Error ? query.error.message : 'Could not reach the server.' }
		: undefined;

	return {
		groups: data?.ok === true ? data.groups : undefined,
		error: providerError ?? transportError,
		isLoading: query.isLoading,
		isError: Boolean(providerError) || query.isError,
		refetch: () => {
			void query.refetch();
		},
	};
};
