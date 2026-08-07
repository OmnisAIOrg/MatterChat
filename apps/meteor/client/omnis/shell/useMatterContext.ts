import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { fetchMatterContext } from './omnisRest';
import type { OmnisMatterContext, OmnisMatterRef } from './omnisRest';
import { useOpenedRoom } from '../../lib/RoomManager';

/**
 * The matter-context rule, client side.
 *
 * > If the active screen is a matter channel, the matter is inherited and the
 * > user does nothing. If it is not, the user is asked — with a search over
 * > every matter in the firm.
 *
 * The hook returns the RESOLVED matter (bound or chosen) plus enough state for
 * a panel to render the right control. Two invariants it enforces, both of
 * which existed as bugs in the mockup this spec came from:
 *
 * 1. **Nothing is pre-selected outside a matter channel.** `selected` starts
 *    `undefined` and only a user action sets it. No "most recent matter", no
 *    "their only open matter" — filing a signed fee agreement into the wrong
 *    matter is materially worse than one extra click.
 * 2. **`resolved` is the single source of truth for consequence text.** A panel
 *    that promises "will be filed to X" must read X from here, never from the
 *    channel it happens to be open over. (The mockup's worst bug: outside a
 *    matter channel, picking *Duong v. Metro Transit* still promised to file
 *    into *Alvarez v. Diaz*.)
 */

export type MatterDestination =
	| { kind: 'matter'; matter: OmnisMatterRef }
	/** The non-matter path every panel offers — "General" / "Just me". */
	| { kind: 'personal' };

export type UseMatterContextResult = {
	/** True while the bound-matter probe is in flight. */
	isLoading: boolean;
	/** Set when the active screen is a matter channel. Read-only; no picker is shown. */
	bound: OmnisMatterRef | null;
	/** Tier 2 of the picker. Listing only. */
	recent: OmnisMatterRef[];
	/** What the user picked, when there was nothing to inherit. */
	selected: OmnisMatterRef | undefined;
	/** The effective destination, or undefined while nothing is resolved yet. */
	destination: MatterDestination | undefined;
	/** The resolved matter — the ONLY thing consequence text may name. */
	resolved: OmnisMatterRef | undefined;
	/** True when a picker should be rendered (i.e. nothing to inherit). */
	needsPicker: boolean;
	select(matter: OmnisMatterRef): void;
	choosePersonal(): void;
	/** Back to "nothing chosen" — the *change* affordance on the confirmed chip. */
	clear(): void;
};

export const useMatterContext = (): UseMatterContextResult => {
	const roomId = useOpenedRoom();

	const { data, isLoading } = useQuery<OmnisMatterContext>({
		queryKey: ['omnis', 'matter-context', roomId ?? 'none'],
		queryFn: () => fetchMatterContext(roomId),
		staleTime: 30_000,
	});

	const [selected, setSelected] = useState<OmnisMatterRef | undefined>(undefined);
	const [personal, setPersonal] = useState(false);

	const select = useCallback((matter: OmnisMatterRef) => {
		setPersonal(false);
		setSelected(matter);
	}, []);

	const choosePersonal = useCallback(() => {
		setSelected(undefined);
		setPersonal(true);
	}, []);

	const clear = useCallback(() => {
		setSelected(undefined);
		setPersonal(false);
	}, []);

	const bound = data?.bound ?? null;
	const resolved = bound ?? selected;

	const destination: MatterDestination | undefined = resolved
		? { kind: 'matter', matter: resolved }
		: personal
			? { kind: 'personal' }
			: undefined;

	return {
		isLoading,
		bound,
		recent: data?.recent ?? [],
		selected,
		destination,
		resolved,
		// Inside a matter channel there is nothing to ask for.
		needsPicker: !bound,
		select,
		choosePersonal,
		clear,
	};
};
