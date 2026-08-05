import { useEffect, useRef } from 'react';

import { DEPTH_FLAG_CLASS } from './depthSkin';

/**
 * The well's top-edge scroll shade (frame spec §4.3).
 *
 * A 16px gradient pinned inside the well's top edge whose opacity ramps 0 → 1 over the first 40px
 * of scroll. Without it, content appears to *end* at the frame; with it, content passes *under*
 * the frame — which is what proves the well is recessed rather than merely bordered.
 *
 * WHY A CAPTURE-PHASE LISTENER: the spec assumes the well is itself the scroll container. In this
 * fork it isn't — `#main-content` is a fixed-height flex box and the scrolling element is whichever
 * region the current route mounts inside it (the message list, a Boards column, an admin table…).
 * `scroll` events don't bubble, but they DO propagate through the capture phase, so one listener on
 * the well catches every descendant scroller without the shade needing to know which route is up.
 *
 * Degrades to invisible: if nothing inside ever scrolls, opacity simply stays 0.
 */
const SHADE_RAMP_PX = 40;
/** Don't re-write the style for changes the eye can't see (spec §4.4). */
const OPACITY_EPSILON = 0.04;

const WellScrollShade = () => {
	const shadeRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const shade = shadeRef.current;
		const well = shade?.parentElement;
		if (!shade || !well) {
			return undefined;
		}

		let last = -1;
		let frame = 0;

		const paint = (): void => {
			frame = 0;
			// The scroller is whichever descendant is actually scrolled. Reading from the event target
			// keeps this correct across route changes without re-querying the DOM.
			const next = Math.min(Math.max(lastScrollTop / SHADE_RAMP_PX, 0), 1);
			if (last >= 0 && Math.abs(next - last) < OPACITY_EPSILON && next !== 0 && next !== 1) {
				return;
			}
			last = next;
			shade.style.opacity = String(next);
		};

		let lastScrollTop = 0;

		const onScroll = (event: Event): void => {
			const target = event.target as HTMLElement | Document | null;
			// Ignore horizontal-only scrollers and the document itself (the body never scrolls here).
			if (!target || target === document || !(target instanceof HTMLElement)) {
				return;
			}
			lastScrollTop = target.scrollTop;
			if (!frame) {
				frame = requestAnimationFrame(paint);
			}
		};

		well.addEventListener('scroll', onScroll, { capture: true, passive: true });
		return () => {
			well.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
			if (frame) {
				cancelAnimationFrame(frame);
			}
		};
	}, []);

	// Rendered unconditionally but styled only under the flag class, so toggling the reskin needs no
	// remount. aria-hidden + pointer-events:none (in CSS) keep it out of the a11y tree and hit-testing.
	return <div ref={shadeRef} className={`mc-scroll-shade ${DEPTH_FLAG_CLASS}-shade`} aria-hidden='true' />;
};

export default WellScrollShade;
