import type { ExternalWorkspaceMember } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * useExternalMembers — the REAL org/workspace directory ("People" section) for one of the caller's
 * OWN external connections.
 *
 * Provider-agnostic mirror of useExternalChannels: calls `external-workspaces.members` with the
 * connection's `_id`; the endpoint loads the connection (ownership-scoped), decrypts the stored
 * credentials and runs THAT provider's live people listing. The result is the SAME discriminated 200
 * envelope as channels: on a provider/auth/config error it returns `{ ok:false, error, message }`
 * (NOT swallowed) so we surface the real message here for the panel to show plainly.
 *
 * `enabled` gates the fetch so it only runs while an external tile is actually selected.
 */
export const useExternalMembers = (
	connectionId: string | undefined,
	enabled: boolean,
): {
	members: ExternalWorkspaceMember[] | undefined;
	error: { error: string; message: string; status?: number } | undefined;
	isLoading: boolean;
	isError: boolean;
	refetch: () => void;
} => {
	const getMembers = useEndpoint('GET', '/v1/external-workspaces.members');

	const query = useQuery({
		queryKey: ['external-workspaces.members', connectionId ?? 'none'],
		queryFn: () => getMembers({ connectionId: connectionId as string }),
		// Only fetch with a real connection id selected (the rail always selects a concrete tile).
		enabled: enabled && Boolean(connectionId),
		// The directory changes rarely; keep it fresh-enough without hammering the provider.
		staleTime: 30_000,
		// Poll so presence/avatars feel live-ish without a manual refetch.
		refetchInterval: 30_000,
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
		members: data?.ok === true ? data.members : undefined,
		error: providerError ?? transportError,
		isLoading: query.isLoading,
		isError: Boolean(providerError) || query.isError,
		refetch: () => {
			void query.refetch();
		},
	};
};
