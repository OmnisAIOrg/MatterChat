import { css } from '@rocket.chat/css-in-js';
import { Box, States, StatesIcon, StatesTitle, StatesSubtitle, StatesActions, StatesAction } from '@rocket.chat/fuselage';
import type { ErrorInfo, ReactNode } from 'react';
import { Component, Fragment } from 'react';

/**
 * ExternalErrorBoundary — a CONTAINED crash barrier around the entire external-workspace subtree.
 *
 * The external workspace mode (ExternalSidebar + ExternalChannelView, for Teams OR Google Chat) is
 * the ONLY thing this wraps. If any external component throws during render (a bad import, an
 * undefined deref, a fuselage prop that throws, a lazy-chunk load failure surfaced as a render error)
 * this catches it HERE and shows a small "Couldn't load this workspace — Reload" message INSIDE the
 * external region. The error NEVER bubbles to RC's top-level error boundary, so the rest of the app
 * (and the way back to MatterChat via the M tile / "Back" action) stays alive. This is the structural
 * guarantee that a future provider-view bug can't take down the whole GUI again.
 *
 * "Reload" here means: drop the caught error and re-mount the children (via a remount key), so a
 * transient failure (e.g. a chunk that failed to load once) can recover without a full page reload.
 * If `onBack` is provided it also offers a clean exit out of workspace mode back to MatterChat.
 *
 * Implemented as a class component because React error boundaries REQUIRE the class lifecycle
 * (getDerivedStateFromError / componentDidCatch); there is no hook equivalent.
 */

type ExternalErrorBoundaryProps = {
	children: ReactNode;
	/** Optional: a clean way out of workspace mode (e.g. back to the native MatterChat workspace). */
	onBack?: () => void;
	/** Optional label for the back action; defaults to a plain "Back to MatterChat". */
	backLabel?: string;
	/** Optional label for the reload action; defaults to "Reload". */
	reloadLabel?: string;
};

type ExternalErrorBoundaryState = {
	hasError: boolean;
	/** Bumped on "Reload" to force a fresh mount of the children subtree. */
	remountKey: number;
};

const fallbackClass = css`
	display: flex;
	align-items: center;
	justify-content: center;
	flex-grow: 1;
	width: 100%;
	height: 100%;
	padding: 24px;
	background: var(--rcx-color-surface-light, #ffffff);
`;

class ExternalErrorBoundary extends Component<ExternalErrorBoundaryProps, ExternalErrorBoundaryState> {
	constructor(props: ExternalErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, remountKey: 0 };
	}

	static getDerivedStateFromError(): Partial<ExternalErrorBoundaryState> {
		// A child threw while rendering — switch to the contained fallback. Returning new state here is
		// what STOPS the error from propagating past this boundary.
		return { hasError: true };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		// Log for diagnostics; intentionally swallowed beyond this point so the app root never sees it.
		console.error('[ExternalWorkspace] view crashed and was contained by ExternalErrorBoundary:', error, info?.componentStack);
	}

	private handleReload = (): void => {
		// Clear the error and remount the subtree so a transient failure can recover in place.
		this.setState((prev) => ({ hasError: false, remountKey: prev.remountKey + 1 }));
	};

	override render(): ReactNode {
		const { children, onBack, backLabel, reloadLabel } = this.props;
		const { hasError, remountKey } = this.state;

		if (hasError) {
			return (
				<Box className={fallbackClass} role='alert'>
					<States>
						<StatesIcon name='warning' variation='danger' />
						<StatesTitle>Couldn&apos;t load this workspace</StatesTitle>
						<StatesSubtitle>Something went wrong showing this connected workspace. The rest of the app is fine.</StatesSubtitle>
						<StatesActions>
							<StatesAction onClick={this.handleReload}>{reloadLabel ?? 'Reload'}</StatesAction>
							{onBack && <StatesAction onClick={onBack}>{backLabel ?? 'Back to MatterChat'}</StatesAction>}
						</StatesActions>
					</States>
				</Box>
			);
		}

		// The remountKey forces React to throw away the old (possibly half-broken) subtree on reload.
		// A keyed Fragment changes identity without adding any DOM node, so the shell's flex layout
		// (rail + sidebar region + main) is unaffected.
		return <Fragment key={remountKey}>{children}</Fragment>;
	}
}

export default ExternalErrorBoundary;
