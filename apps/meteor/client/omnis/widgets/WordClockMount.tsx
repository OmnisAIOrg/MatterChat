import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';

import { loadOmnisWidget, omnisWidgetSrc } from './loadOmnisWidget';
import { omnisWordsForToday } from './omnisWords';

/**
 * Mounts the `<word-clock-widget>` (iOS-lockscreen clock + Word of the Day) in the sidebar footer,
 * above the MatterChat wordmark. Imperatively creates the custom element (no JSX intrinsic-element
 * typing needed) and feeds it today's rotated word list.
 */
export const WordClockMount = (): ReactElement => {
	const hostRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		let el: (HTMLElement & { words?: unknown }) | undefined;
		void loadOmnisWidget(omnisWidgetSrc('word-clock-widget.js')).then(() => {
			if (cancelled || !hostRef.current) {
				return;
			}
			el = document.createElement('word-clock-widget');
			el.setAttribute('format', '12');
			// Under a Paper & Sky skin the clock joins the palette: mint accent (the stock
			// amber is the one yellow on an all-green screen) and a deep-green face — the
			// night-stand black read as the last neutral-grey slab on the sky.
			if (document.body.hasAttribute('data-skin')) {
				el.setAttribute('accent', '#8FE3A5');
				el.setAttribute('face', '#0B2417');
			} else {
				el.setAttribute('accent', '#ffd60a');
			}
			el.setAttribute('word-seconds', '9');
			el.setAttribute('clock-seconds', '5');
			el.words = omnisWordsForToday();
			hostRef.current.appendChild(el);
		});
		return () => {
			cancelled = true;
			el?.remove();
		};
	}, []);

	return <div ref={hostRef} style={{ padding: '4px 8px 8px' }} />;
};

export default WordClockMount;
