import type { ExternalWorkspaceDirectChat } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';

/**
 * useExternalDirectChats — the REAL 1:1 + group DMs ("Chats" section) for one of the caller's OWN
 * external connections.
 *
 * Provider-agnostic mirror of useExternalChannels: calls `external-workspaces.directChats` with the
 * connection's `_id`; the endpoint loads the connection (ownership-scoped), decrypts the stored
 * credentials and runs THAT provider's live direct-chat listing. The result is the SAME discriminated
 * 200 envelope as channels: on a provider/auth/config error it returns `{ ok:false, error, message }`
 * (NOT swallowed) so we surface the real message here for the panel to show plainly.
 *
 * Each chat's `externalId` is the provider-native chat id — the SAME token messages/sendMessage take
 * (the provider detects a chat id vs a channel id), so a DM is read/posted exactly like a channel.
 *
 * `enabled` gates the fetch so it only runs while an external tile is actually selected.
 */
export const useExternalDirectChats = (
	connectionId: string | undefined,
	enabled: boolean,
): {
	chats: ExternalWorkspaceDirectChat[] | undefined;
	error: { error: string; message: string; status?: number } | undefined;
	isLoading: boolean;
	isError: boolean;
	refetch: () => void;
} => {
	const getDirectChats = useEndpoint('GET', '/v1/external-workspaces.directChats');

	const query = useQuery({
		queryKey: ['external-workspaces.directChats', connectionId ?? 'none'],
		queryFn: () => getDirectChats({ connectionId: connectionId as string }),
		// Only fetch with a real connection id selected (the rail always selects a concrete tile).
		enabled: enabled && Boolean(connectionId),
		// Live provider data; don't hammer it, but let a manual refetch pull fresh chats.
		staleTime: 15_000,
		// Poll so unread badges / recency feel live-ish without a manual refetch.
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
		chats: data?.ok === true ? data.chats : undefined,
		error: providerError ?? transportError,
		isLoading: query.isLoading,
		isError: Boolean(providerError) || query.isError,
		refetch: () => {
			void query.refetch();
		},
	};
};
