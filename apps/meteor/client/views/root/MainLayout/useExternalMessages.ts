import type { ExternalWorkspaceMessage } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

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

	// Sent-message echoes, kept OUTSIDE the react-query cache and merged into the output below.
	// WHY DURABLE (localStorage, not just memory): Slack's conversations.history API — which this
	// browse view re-reads on every load — does NOT return a custom (non-Marketplace) app's OWN
	// sent messages, verified end-to-end: chat.postMessage returns a real ts, yet a same-channel
	// history read seconds AND days later never contains it. So a message sent from MatterChat would
	// be invisible here forever even though it reached Slack. We therefore PERSIST every sent message
	// per (connection, channel) in localStorage and always merge it in — so the user's own messages
	// survive reloads and days, independent of what Slack's read returns. An echo is dropped only if
	// the server list genuinely carries it (dedup), with a 30-day retention ceiling.
	const echoKey = `${connectionId ?? ''}:${channelExternalId ?? ''}`;
	const echoStoreKey = `mc-ext-sent:${echoKey}`;
	const ECHO_RETENTION_MS = 30 * 24 * 60 * 60_000; // 30 days
	const ECHO_MAX_PER_CHANNEL = 500;

	const loadEchoes = useCallback((): { msg: EnrichedExternalMessage; at: number }[] => {
		try {
			const raw = window.localStorage.getItem(echoStoreKey);
			const arr = raw ? (JSON.parse(raw) as { msg: EnrichedExternalMessage; at: number }[]) : [];
			return Array.isArray(arr) ? arr.filter((e) => Date.now() - e.at < ECHO_RETENTION_MS) : [];
		} catch {
			return [];
		}
	}, [echoStoreKey, ECHO_RETENTION_MS]);

	const saveEchoes = useCallback(
		(arr: { msg: EnrichedExternalMessage; at: number }[]): void => {
			try {
				const capped = arr.slice(-ECHO_MAX_PER_CHANNEL);
				if (capped.length === 0) {
					window.localStorage.removeItem(echoStoreKey);
				} else {
					window.localStorage.setItem(echoStoreKey, JSON.stringify(capped));
				}
			} catch {
				// localStorage full/unavailable — degrade silently (echo just won't persist this session).
			}
		},
		[echoStoreKey, ECHO_MAX_PER_CHANNEL],
	);

	// A re-render nudge for when an echo is added/dropped (localStorage writes don't trigger a render).
	const [, bumpEchoRender] = useState(0);

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
			// INSTANT + DURABLE SEND — echo persisted to localStorage, never to the react-query cache.
			// (Cache-prepend was the OLD bug: it made the echo look server-confirmed instantly, so it got
			// dropped, then the refetch wiped it — appeared ~1s then vanished. Keeping serverMessages pure
			// means an echo is dropped ONLY when REAL provider history carries it.) Prefer the server's
			// echoed message; local fallback otherwise.
			const serverEcho = (result as { message?: Partial<EnrichedExternalMessage> })?.message;
			const echo: EnrichedExternalMessage = {
				externalId: (result as { externalId?: string })?.externalId ?? `local-echo-${Date.now()}`,
				author: 'You',
				text,
				createdAt: new Date().toISOString(),
				...(serverEcho && typeof serverEcho === 'object' ? serverEcho : {}),
			};
			saveEchoes([...loadEchoes(), { msg: echo, at: Date.now() }]);
			// Force a render so the merge picks up the new echo immediately.
			bumpEchoRender((n) => n + 1);
			// Reconciliation: refetch in the background WITHOUT awaiting — the echo stays visible (via the
			// localStorage merge) until the fresh provider list genuinely contains it.
			void queryClient.invalidateQueries({ queryKey });
		},
		// queryKey is derived from the same deps; spreading it would add an unstable array identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[enabled, sendMutation, queryClient, connectionId, channelExternalId, loadEchoes, saveEchoes],
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
	// 2 minutes. Unconfirmed echoes stay visible up to the 30-day retention ceiling.
	const serverMessages = data?.ok === true ? data.messages : undefined;
	let mergedMessages = serverMessages;
	const held = loadEchoes();
	if (held.length > 0) {
		const now = Date.now();
		// Confirmation requires a valid server list: only mark echoes as confirmed if we have
		// server data to check against. If the server fetch failed or returned error, we show
		// ALL unconfirmed echoes to persist them through the error window.
		const confirmed = (echo: EnrichedExternalMessage): boolean => {
			if (!Array.isArray(serverMessages)) {
				// No server data yet (error/loading) — don't confirm; show the echo.
				return false;
			}
			return serverMessages.some(
				(m) =>
					m.externalId === echo.externalId ||
					(m.text === echo.text && Math.abs(Date.parse(m.createdAt) - Date.parse(echo.createdAt)) < 120_000),
			);
		};
		const surviving = held.filter((e) => now - e.at < ECHO_RETENTION_MS && !confirmed(e.msg));
		if (surviving.length !== held.length) {
			saveEchoes(surviving);
		}
		if (surviving.length > 0) {
			// Newest-first list: echoes are the newest — most recent echo first, then the server list.
			const echoMessages = surviving.map((e) => e.msg).reverse();
			mergedMessages = Array.isArray(serverMessages) ? [...echoMessages, ...serverMessages] : echoMessages;
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
