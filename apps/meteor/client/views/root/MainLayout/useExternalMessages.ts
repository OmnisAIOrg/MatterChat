import type { ExternalWorkspaceMessage } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * useExternalMessages — REAL read + post for one channel/space of the caller's OWN external connection.
 *
 * Provider-agnostic via `connectionId` (Teams channels through Graph, Google Chat spaces through the
 * Chat REST API — the endpoint dispatches on the connection's provider).
 *
 * READ: `external-workspaces.messages` runs the provider's live `syncMessages` (newest-first) for the
 * caller's own connection. The endpoint resolves a discriminated 200 envelope: on a provider/auth/
 * config error (e.g. an admin-consent 403) it returns `{ ok:false, error, message, status }` (NOT
 * swallowed) so the view can show the real message plainly.
 *
 * POST: `external-workspaces.sendMessage` posts AS the user (delegated token) via the provider's
 * `postMessage`. After a successful send we refetch so the new message appears.
 *
 * The channel identity is whatever the channels list provided (`channelExternalId`, the provider-
 * native id — Teams `teamId|channelId`, Google `spaces/{id}`) — passed straight through.
 *
 * The provider returns messages newest-first; we present them newest-AT-BOTTOM like a chat, so the
 * view reverses them for display.
 *
 * Crash-safety: BOTH args are optional and the query/mutation are gated by `enabled`. Every hook
 * runs unconditionally and in a stable order regardless of whether a channel is selected, so this
 * hook can be called from the top of the channel view before any early return.
 */
export type ExternalEnvelopeError = { error: string; message: string; status?: number };

export const useExternalMessages = (
	connectionId: string | undefined,
	channelExternalId: string | undefined,
): {
	messages: ExternalWorkspaceMessage[] | undefined;
	error: ExternalEnvelopeError | undefined;
	isLoading: boolean;
	isFetching: boolean;
	refetch: () => void;
	send: (text: string) => Promise<void>;
	isSending: boolean;
	sendError: ExternalEnvelopeError | undefined;
} => {
	const queryClient = useQueryClient();
	const getMessages = useEndpoint('GET', '/v1/external-workspaces.messages');
	const postMessage = useEndpoint('POST', '/v1/external-workspaces.sendMessage');

	const enabled = Boolean(connectionId && channelExternalId);
	const queryKey = ['external-workspaces.messages', connectionId ?? '', channelExternalId ?? ''];

	const query = useQuery({
		queryKey,
		queryFn: () => getMessages({ connectionId: connectionId as string, channelExternalId: channelExternalId as string }),
		enabled,
		// Live provider data; a short stale time keeps it fresh on channel switch without hammering.
		staleTime: 10_000,
		retry: false,
	});

	const { data } = query;
	const providerError: ExternalEnvelopeError | undefined =
		data?.ok === false ? { error: data.error, message: data.message, status: data.status } : undefined;
	const transportError: ExternalEnvelopeError | undefined = query.isError
		? { error: 'request_failed', message: query.error instanceof Error ? query.error.message : 'Could not reach the server.' }
		: undefined;

	const sendMutation = useMutation({
		mutationFn: (text: string) =>
			postMessage({ connectionId: connectionId as string, channelExternalId: channelExternalId as string, text }),
	});

	const send = useCallback(
		async (text: string): Promise<void> => {
			if (!enabled) {
				return;
			}
			const result = await sendMutation.mutateAsync(text);
			// The send endpoint also rides errors back in a 200 envelope (ok:false) — throw so the caller
			// keeps the typed text and we surface the real provider/consent message.
			if (result?.ok === false) {
				const err = new Error(result.message) as Error & { status?: number; providerError?: string };
				err.status = result.status;
				err.providerError = result.error;
				throw err;
			}
			// Posted — pull the channel again so the new message shows (optimistic-free, simplest correct).
			await queryClient.invalidateQueries({ queryKey });
		},
		// queryKey is derived from the same deps; spreading it would add an unstable array identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[enabled, sendMutation, queryClient, connectionId, channelExternalId],
	);

	const sendError: ExternalEnvelopeError | undefined = sendMutation.isError
		? {
				error: (sendMutation.error as { providerError?: string })?.providerError ?? 'send_failed',
				message: sendMutation.error instanceof Error ? sendMutation.error.message : 'Could not send your message.',
				status: (sendMutation.error as { status?: number })?.status,
			}
		: undefined;

	return {
		messages: data?.ok === true ? data.messages : undefined,
		error: providerError ?? transportError,
		isLoading: query.isLoading && enabled,
		isFetching: query.isFetching,
		refetch: () => {
			void query.refetch();
		},
		send,
		isSending: sendMutation.isPending,
		sendError,
	};
};
