import type { ExternalWorkspaceMessage } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

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
 * `postMessage`. On success the sent message is appended to the cached list IMMEDIATELY (the server's
 * echoed `message` when present, else a locally-constructed `{ author: 'You', text, createdAt: now }`)
 * so the send feels instant, and a NON-awaited invalidate refetches in the background as
 * reconciliation — react-query keeps the cached (optimistic) data on screen until the refetch lands,
 * so there is no flicker.
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

/**
 * The server lane is concurrently enriching the payloads (authorDisplayName / authorAvatarUrl /
 * mentions on messages, an echoed `message` on sendMessage). The client must work with OR without
 * those fields, preferring them when present — hence this widened, all-optional view of a message.
 */
export type EnrichedExternalMessage = ExternalWorkspaceMessage & {
	authorDisplayName?: string;
	authorAvatarUrl?: string;
	mentions?: Record<string, string>;
};

export const useExternalMessages = (
	connectionId: string | undefined,
	channelExternalId: string | undefined,
): {
	messages: EnrichedExternalMessage[] | undefined;
	/** Optional connection-wide Slack user-id → display-name map (present once the server lane ships it). */
	mentions: Record<string, string> | undefined;
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

	// Recently-sent echoes, kept OUTSIDE the react-query cache and merged into the output below.
	// The cache-prepend alone is not enough: the reconciling refetch REPLACES the cached list, and
	// Slack's conversations.history often omits a just-posted message for a few seconds — which made
	// a sent DM appear and then VANISH until some later refetch. An echo survives here until the
	// server list actually contains it (by id, or same text within 2 min for local-fallback ids),
	// with a retention ceiling as the safety valve. Keyed per channel so echoes never leak across.
	const recentEchoesRef = useRef<Map<string, { msg: EnrichedExternalMessage; at: number }[]>>(new Map());
	const echoKey = `${connectionId ?? ''}:${channelExternalId ?? ''}`;

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
			// INSTANT SEND: append the sent message to the cached list right away. Prefer the server's
			// echoed message (the server lane is adding it to the payload); construct a local echo
			// otherwise. Defaults-first spread so a PARTIAL echo still renders something sensible.
			const serverEcho = (result as { message?: Partial<EnrichedExternalMessage> })?.message;
			const echo: EnrichedExternalMessage = {
				externalId: (result as { externalId?: string })?.externalId ?? `local-echo-${Date.now()}`,
				author: 'You',
				text,
				createdAt: new Date().toISOString(),
				...(serverEcho && typeof serverEcho === 'object' ? serverEcho : {}),
			};
			queryClient.setQueryData<{ ok: boolean; messages?: EnrichedExternalMessage[] } | undefined>(queryKey, (current) => {
				if (current?.ok !== true || !Array.isArray(current.messages)) {
					return current;
				}
				// Guard the (unlikely) case a background refetch already delivered the real message.
				if (current.messages.some((m) => m.externalId === echo.externalId)) {
					return current;
				}
				// The list is stored newest-FIRST (the view reverses for display), so prepend.
				return { ...current, messages: [echo, ...current.messages] };
			});
			// Remember the echo OUTSIDE the cache too — the reconciling refetch replaces the cached
			// list, and provider history may not include the just-posted message yet (see merge below).
			const held = recentEchoesRef.current.get(echoKey) ?? [];
			recentEchoesRef.current.set(echoKey, [...held, { msg: echo, at: Date.now() }]);
			// Reconciliation: refetch in the background WITHOUT awaiting — the optimistic echo is already
			// on screen, and react-query keeps showing the cached data until the fresh list lands.
			void queryClient.invalidateQueries({ queryKey });
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

	// Merge surviving echoes into the output. An echo is confirmed (and dropped) once the server
	// list carries its externalId — or, for local-fallback ids, a message with the same text within
	// 2 minutes. Unconfirmed echoes stay visible up to the retention ceiling.
	const ECHO_RETENTION_MS = 10 * 60_000;
	const serverMessages = data?.ok === true ? data.messages : undefined;
	let mergedMessages = serverMessages;
	if (Array.isArray(serverMessages)) {
		const held = recentEchoesRef.current.get(echoKey) ?? [];
		if (held.length > 0) {
			const now = Date.now();
			const confirmed = (echo: EnrichedExternalMessage): boolean =>
				serverMessages.some(
					(m) =>
						m.externalId === echo.externalId ||
						(m.text === echo.text && Math.abs(Date.parse(m.createdAt) - Date.parse(echo.createdAt)) < 120_000),
				);
			const surviving = held.filter((e) => now - e.at < ECHO_RETENTION_MS && !confirmed(e.msg));
			if (surviving.length !== held.length) {
				recentEchoesRef.current.set(echoKey, surviving);
			}
			if (surviving.length > 0) {
				// Newest-first list: echoes are the newest — most recent echo first, then the server list.
				mergedMessages = [...surviving.map((e) => e.msg).reverse(), ...serverMessages];
			}
		}
	}

	return {
		messages: mergedMessages,
		// Defensive read — the field only exists once the server lane's payload enrichment ships.
		mentions: data?.ok === true ? (data as { mentions?: Record<string, string> }).mentions : undefined,
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
