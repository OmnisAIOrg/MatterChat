import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * useExternalUnreadSummary — rolled-up unread/mention counts for ALL of the caller's connected
 * external workspaces, used to paint "feel-alive" notification badges on the org-switcher rail tiles.
 *
 * Reads `external-workspaces.unreadSummary` (no params; the endpoint enumerates the caller's OWN
 * connections server-side via findByUserId). The 200 envelope is the same discriminated shape as the
 * other external views: `{ ok:true, summaries }` on success, `{ ok:false, error, message }` on a hard
 * failure. In practice the handler is best-effort and always returns `ok:true` (a connection whose
 * provider can't report unreads defaults to 0/0), but we still treat anything that isn't `ok:true` —
 * including a transport throw — as "no badges" so the rail never breaks on a bad response.
 *
 * Polls on a 30s interval to stay roughly live without hammering the providers; `retry:false` keeps a
 * transient failure from fanning out into a retry storm (the next interval tick covers recovery).
 *
 * Provider-agnostic: returns a connectionId -> counts lookup the rail reads per-tile. Connections with
 * no unread simply have no entry (or a 0/0 entry) — callers should treat "missing" as 0/0.
 */

export type ExternalUnreadCounts = { unreadCount: number; mentionCount: number };

const EMPTY_COUNTS: ExternalUnreadCounts = { unreadCount: 0, mentionCount: 0 };

export const useExternalUnreadSummary = (): {
	/** connectionId -> { unreadCount, mentionCount }. Empty on ok:false / error / loading. */
	summaryByConnectionId: Map<string, ExternalUnreadCounts>;
	/** Resolve one connection's counts; always returns a value (0/0 when unknown). */
	getCountsForConnection: (connectionId: string | undefined) => ExternalUnreadCounts;
	isLoading: boolean;
} => {
	const getUnreadSummary = useEndpoint('GET', '/v1/external-workspaces.unreadSummary');

	const { data, isLoading } = useQuery({
		queryKey: ['external-workspaces.unreadSummary'],
		queryFn: () => getUnreadSummary(),
		// Roughly-live rail badges without hammering the providers.
		refetchInterval: 30_000,
		// A transient failure shouldn't retry-storm; the next interval tick recovers.
		retry: false,
	});

	const summaryByConnectionId = useMemo<Map<string, ExternalUnreadCounts>>(() => {
		const map = new Map<string, ExternalUnreadCounts>();
		// Anything that isn't an explicit ok:true envelope (ok:false, transport throw, loading) → no badges.
		if (data?.ok === true) {
			for (const summary of data.summaries) {
				map.set(summary.connectionId, {
					unreadCount: summary.unreadCount,
					mentionCount: summary.mentionCount,
				});
			}
		}
		return map;
	}, [data]);

	const getCountsForConnection = (connectionId: string | undefined): ExternalUnreadCounts =>
		(connectionId ? summaryByConnectionId.get(connectionId) : undefined) ?? EMPTY_COUNTS;

	return { summaryByConnectionId, getCountsForConnection, isLoading };
};
