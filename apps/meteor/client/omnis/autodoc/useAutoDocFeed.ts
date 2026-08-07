import { useUserId } from '@rocket.chat/ui-contexts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { sdk } from '../../../app/utils/client/lib/SDKClient';
import { omnisGet } from '../shell/omnisRest';

/**
 * The AutoDoc queue feed.
 *
 * ONE fetch for the initial state, then **deltas over the websocket** — the
 * client never polls. `server/lib/autodoc/feedPoller.ts` runs a single poller
 * per workspace, diffs on `status_changed_at`, and pushes only what changed to
 * users holding `view-document-queue`. The widget therefore updates the moment
 * OCR finishes, rather than up to one poll interval later, and a workspace with
 * fifty open tabs still makes one upstream request per interval.
 *
 * `staleTime: Infinity` is deliberate: the stream is the source of truth once
 * mounted, so React Query must not re-fetch behind its back and clobber a delta
 * that has already been applied.
 */

export type AutoDocStatus = 'ready' | 'quick_confirm' | 'needs_review' | 'processing' | 'failed';

export type AutoDocField = {
	name: string;
	label: string;
	value: string;
	confidence: number;
	region?: { page: number; x: number; y: number; width: number; height: number };
};

export type AutoDocDocument = {
	id: string;
	filename: string;
	documentType?: string;
	status: AutoDocStatus;
	confidence: number;
	status_changed_at: string;
	sizeBytes?: number;
	pageCount?: number;
	matterId?: string;
	matterGuess?: { matterId: string; matterName: string; confidence: number };
	fields?: AutoDocField[];
	previewUrl?: string;
	submittedBy?: string;
	submittedAt?: string;
	roomId?: string;
};

export type AutoDocFeed = {
	enabled: boolean;
	transport: 'stub' | 'native';
	reachable: boolean;
	webUrl: string;
	items: AutoDocDocument[];
	summary: { recent: number; ready: number; needsReview: number };
};

type FeedDelta = {
	changed: { id: string; changedAt: string; document: AutoDocDocument }[];
	removed: string[];
};

const QUERY_KEY = ['omnis', 'autodoc', 'feed'];

function applyDelta(feed: AutoDocFeed, delta: FeedDelta): AutoDocFeed {
	const byId = new Map(feed.items.map((item) => [item.id, item]));
	for (const id of delta.removed) {
		byId.delete(id);
	}
	for (const entry of delta.changed) {
		byId.set(entry.id, entry.document);
	}

	const items = [...byId.values()].sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
	return {
		...feed,
		items,
		summary: {
			recent: items.length,
			ready: items.filter((i) => i.status === 'ready').length,
			needsReview: items.filter((i) => i.status === 'needs_review' || i.status === 'quick_confirm').length,
		},
	};
}

export const useAutoDocFeed = (enabled: boolean) => {
	const uid = useUserId();
	const queryClient = useQueryClient();

	const query = useQuery<AutoDocFeed>({
		queryKey: QUERY_KEY,
		queryFn: () => omnisGet<AutoDocFeed>('/v1/autodoc.feed'),
		enabled,
		// The websocket owns freshness from here. See the note above.
		staleTime: Infinity,
	});

	useEffect(() => {
		if (!enabled || !uid) {
			return;
		}
		const { stop } = sdk.stream('notify-user', [`${uid}/autodoc-feed`], (delta: FeedDelta) => {
			queryClient.setQueryData<AutoDocFeed>(QUERY_KEY, (current) => (current ? applyDelta(current, delta) : current));
		});
		return stop;
	}, [enabled, uid, queryClient]);

	return query;
};

/** Force a refetch after a local mutation (approve / reject / submit). */
export const useInvalidateAutoDocFeed = () => {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
};
