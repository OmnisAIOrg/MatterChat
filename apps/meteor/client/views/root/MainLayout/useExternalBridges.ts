import type { ExternalWorkspaceBridge } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { ExternalEnvelopeError } from './useExternalMessages';

/**
 * useExternalBridges — live-bridge state + actions for ONE channel/chat of the caller's OWN
 * external connection (the UI for the server's bridgeService, spec §3.3).
 *
 * READ: `external-workspaces.bridges` lists ALL of the caller's bridges (always ok — own records
 * only); this hook picks out the one matching (connectionId, channelExternalId), which drives the
 * header badge (bridged + realtime mode) and which action (bridge vs unbridge) is offered.
 *
 * BRIDGE: `external-workspaces.bridgeChannel` mirrors the channel into a new MatterChat room —
 * creates + tags the room, opens the provider's realtime subscription (webhook mode; degrades to
 * shared/outbound-only), and seeds recent history. Idempotent per (connection, channel).
 * UNBRIDGE: `external-workspaces.unbridgeChannel` stops mirroring (the room + history stay).
 *
 * Both actions ride errors back in the same 200 envelope as every other external-workspaces call
 * (`{ ok:false, error, message, status }` — NOT swallowed) and this hook surfaces the LAST action's
 * error as `actionError` so the view can render the real message plainly.
 *
 * Crash-safety: both args are optional, the query is gated by `enabled`, and every hook runs
 * unconditionally in a stable order — callable from the top of the channel view before any early
 * return (same discipline as useExternalMessages).
 */
export const useExternalBridges = (
	connectionId: string | undefined,
	channelExternalId: string | undefined,
): {
	/** The bridge record for THIS channel, when it is bridged. */
	bridge: ExternalWorkspaceBridge | undefined;
	isLoading: boolean;
	bridgeNow: (name?: string) => Promise<void>;
	unbridgeNow: () => Promise<void>;
	isBridging: boolean;
	isUnbridging: boolean;
	/** The LAST bridge/unbridge failure (real provider/auth message), cleared on the next attempt. */
	actionError: ExternalEnvelopeError | undefined;
} => {
	const queryClient = useQueryClient();
	const getBridges = useEndpoint('GET', '/v1/external-workspaces.bridges');
	const postBridge = useEndpoint('POST', '/v1/external-workspaces.bridgeChannel');
	const postUnbridge = useEndpoint('POST', '/v1/external-workspaces.unbridgeChannel');

	const enabled = Boolean(connectionId && channelExternalId);
	// ONE list query for all bridges (cheap own-records enumeration) — shared across channels, so
	// switching channels never refetches; the per-channel record is derived below.
	const queryKey = ['external-workspaces.bridges'];

	const query = useQuery({
		queryKey,
		queryFn: () => getBridges(),
		enabled,
		staleTime: 30_000,
		retry: false,
	});

	const bridge = query.data?.bridges?.find((b) => b.connectionId === connectionId && b.channelExternalId === channelExternalId);

	// Shared envelope-unwrap for both actions: an ok:false ride-back is thrown as a real Error so
	// the mutation's error state carries the provider's message + status.
	const throwEnvelope = (result: { ok: boolean; error?: string; message?: string; status?: number }): void => {
		if (result?.ok === false) {
			const err = new Error(result.message) as Error & { status?: number; providerError?: string };
			err.status = result.status;
			err.providerError = result.error;
			throw err;
		}
	};

	const bridgeMutation = useMutation({
		mutationFn: async (name?: string) => {
			const result = await postBridge({
				connectionId: connectionId as string,
				channelExternalId: channelExternalId as string,
				...(name ? { name } : {}),
			});
			throwEnvelope(result);
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	const unbridgeMutation = useMutation({
		mutationFn: async () => {
			const result = await postUnbridge({ connectionId: connectionId as string, channelExternalId: channelExternalId as string });
			throwEnvelope(result);
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	const bridgeNow = useCallback(
		async (name?: string): Promise<void> => {
			if (!enabled || bridgeMutation.isPending) {
				return;
			}
			// Clear the counterpart's stale error so `actionError` only ever shows the LAST attempt.
			unbridgeMutation.reset();
			await bridgeMutation.mutateAsync(name).catch(() => undefined); // surfaced via actionError, never unhandled
		},
		[enabled, bridgeMutation, unbridgeMutation],
	);

	const unbridgeNow = useCallback(async (): Promise<void> => {
		if (!enabled || unbridgeMutation.isPending) {
			return;
		}
		bridgeMutation.reset();
		await unbridgeMutation.mutateAsync().catch(() => undefined); // surfaced via actionError, never unhandled
	}, [enabled, bridgeMutation, unbridgeMutation]);

	const toEnvelopeError = (error: unknown): ExternalEnvelopeError => ({
		error: (error as { providerError?: string })?.providerError ?? 'bridge_failed',
		message: error instanceof Error ? error.message : 'Could not update the bridge.',
		status: (error as { status?: number })?.status,
	});

	// Only one mutation can hold an error at a time (each action resets the counterpart first).
	const failed = [bridgeMutation, unbridgeMutation].find((m) => m.isError);
	const actionError: ExternalEnvelopeError | undefined = failed ? toEnvelopeError(failed.error) : undefined;

	return {
		bridge,
		isLoading: query.isLoading && enabled,
		bridgeNow,
		unbridgeNow,
		isBridging: bridgeMutation.isPending,
		isUnbridging: unbridgeMutation.isPending,
		actionError,
	};
};
