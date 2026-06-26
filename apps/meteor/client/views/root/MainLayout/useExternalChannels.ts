import type { ExternalWorkspaceChannelGroup } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * useExternalChannels — the REAL channels/spaces for one of the caller's OWN external connections.
 *
 * Provider-agnostic: drives the channel list for any external workspace (Teams channels via Graph,
 * Google Chat spaces via the Chat REST API). Calls `external-workspaces.channels` with the
 * connection's `_id`; the endpoint loads the connection (ownership-scoped), decrypts the stored
 * credentials, and runs THAT provider's live `listChannels`. The result is a discriminated envelope:
 * on a provider/auth/config error it returns `{ ok:false, error, message }` (NOT swallowed) so we
 * surface the real message here for the panel to show plainly.
 *
 * `enabled` gates the fetch so it only runs while an external tile is actually selected.
 */
export const useExternalChannels = (
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
		queryKey: ['external-workspaces.channels', connectionId ?? 'none'],
		queryFn: () => getChannels({ connectionId: connectionId as string }),
		// Only fetch with a real connection id selected (no provider fallback: the rail always selects
		// a concrete connection tile).
		enabled: enabled && Boolean(connectionId),
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
