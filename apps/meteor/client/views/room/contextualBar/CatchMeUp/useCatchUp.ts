import { useCallback, useEffect, useState } from 'react';

import { sdk } from '../../../../../app/utils/client/lib/SDKClient';

/**
 * MATTERCHAT: data for the channel-header "Catch me up" panel (F4).
 *
 * Talks to `GET /v1/chi.catchup`, which reads through the caller's own subscription for this
 * room. There is no client-side authority decision to get wrong here: a room the user is not in
 * comes back empty from the server.
 *
 * Fetched on OPEN, not on a subscription. The point of the panel is "what had I missed when I
 * walked in" — a live-updating list would move under the reader's finger as new messages arrive,
 * which is exactly the thing the room itself already does well.
 */
export type CatchUpMessage = {
	id: string;
	username: string;
	text: string;
	ts: string;
	/** Absolute permalink; empty when Site_Url is unset. The panel jumps in-app regardless. */
	link: string;
};

export type CatchUpState = {
	label: string;
	messages: CatchUpMessage[];
	unread: number;
	omitted: number;
	loading: boolean;
	error: boolean;
	reload: () => void;
};

type CatchUpResponse = {
	rid?: string;
	label?: string;
	unread?: number;
	mentions?: number;
	omitted?: number;
	messages?: CatchUpMessage[];
};

export const useCatchUp = (rid: string, fallbackLabel: string): CatchUpState => {
	const [state, setState] = useState<Omit<CatchUpState, 'reload'>>({
		label: fallbackLabel,
		messages: [],
		unread: 0,
		omitted: 0,
		loading: true,
		error: false,
	});
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setState((prev) => ({ ...prev, loading: true, error: false }));

		// The route is not declared in rest-typings (same as the other chi.* routes), so the
		// typed SDK cannot know it — cast at the call, not at the response.
		(sdk.rest.get as (endpoint: string, params: unknown) => Promise<unknown>)('/v1/chi.catchup', { rid })
			.then((raw) => {
				if (cancelled) {
					return;
				}
				const response = (raw || {}) as CatchUpResponse;
				setState({
					label: response.label || fallbackLabel,
					messages: Array.isArray(response.messages) ? response.messages : [],
					unread: typeof response.unread === 'number' ? response.unread : 0,
					omitted: typeof response.omitted === 'number' ? response.omitted : 0,
					loading: false,
					error: false,
				});
			})
			.catch(() => {
				if (!cancelled) {
					setState((prev) => ({ ...prev, loading: false, error: true }));
				}
			});

		return () => {
			cancelled = true;
		};
	}, [rid, fallbackLabel, nonce]);

	const reload = useCallback(() => setNonce((n) => n + 1), []);

	return { ...state, reload };
};
