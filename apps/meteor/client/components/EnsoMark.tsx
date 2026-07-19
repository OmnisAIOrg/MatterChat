import type { CSSProperties, ReactElement } from 'react';
import React, { useEffect, useRef } from 'react';

/**
 * MatterChat Ensō brand mark — a React wrapper around the vanilla `enso-loader`
 * ambient loop (public/enso/), so MatterChat renders the same animated mark as
 * the rest of the Omnis suite (ported from Omnis Command Center's EnsoMark).
 *
 * Mounted with no `loading` prop it loops forever — the ambient rail mark.
 * Pass a boolean to gate it: `true` = looping, `false` = frozen static.
 *
 * The loader script is injected once and exposes the `EnsoLoader` global; the
 * ambient mount never blocks clicks, pauses offscreen, and honours
 * `prefers-reduced-motion` (all built into the loader itself).
 */

const SCRIPT_SRC = '/enso/enso-loader.js';
const GLOBAL_NAME = 'EnsoLoader';

type EnsoLoaderGlobal = {
	mount: (target: HTMLElement, opts?: { size?: number; assetBase?: string; zIndex?: number }) => { element?: HTMLElement; remove: () => void };
};

/** Inject the loader <script> once; resolve when its global object exists. */
function ensureLoader(): Promise<EnsoLoaderGlobal> {
	const w = window as unknown as Record<string, unknown>;
	if (w[GLOBAL_NAME]) return Promise.resolve(w[GLOBAL_NAME] as EnsoLoaderGlobal);
	return new Promise((resolve) => {
		if (!document.querySelector(`script[data-enso="${GLOBAL_NAME}"]`)) {
			const s = document.createElement('script');
			s.src = SCRIPT_SRC;
			s.async = false;
			s.setAttribute('data-enso', GLOBAL_NAME);
			document.head.appendChild(s);
		}
		const poll = (): void => {
			if (w[GLOBAL_NAME]) {
				resolve(w[GLOBAL_NAME] as EnsoLoaderGlobal);
				return;
			}
			setTimeout(poll, 60);
		};
		poll();
	});
}

type EnsoMarkProps = {
	/** Rendered mark size in px (square box; the brush is sized to fit). */
	size?: number;
	/** Omit to loop forever (ambient). Pass a boolean to gate: true = looping, false = static. */
	loading?: boolean;
	className?: string;
	style?: CSSProperties;
};

const EnsoMark = ({ size = 40, loading, className, style }: EnsoMarkProps): ReactElement => {
	const boxRef = useRef<HTMLSpanElement>(null);
	const animRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		let handle: { element?: HTMLElement; remove: () => void } | undefined;
		let cancelled = false;
		void ensureLoader().then((loader) => {
			if (cancelled || !boxRef.current) return;
			handle = loader.mount(boxRef.current, { size });
			animRef.current = handle?.element ?? null;
			if (typeof loading === 'boolean' && animRef.current) {
				animRef.current.classList.toggle('enso-static', !loading);
			}
		});
		return () => {
			cancelled = true;
			handle?.remove?.();
			animRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [size]);

	useEffect(() => {
		if (typeof loading === 'boolean' && animRef.current) {
			animRef.current.classList.toggle('enso-static', !loading);
		}
	}, [loading]);

	return (
		<span
			ref={boxRef}
			className={className}
			style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, ...style }}
			aria-hidden='true'
		/>
	);
};

export default EnsoMark;
