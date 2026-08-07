import { Box } from '@rocket.chat/fuselage';
import type { ReactElement, ReactNode } from 'react';

import { OMNIS_WIDGET_Z_INDEX } from './OmnisWidget';

/**
 * The single `position: fixed` element the Omnis widgets live in.
 *
 * `column-reverse` means the first child renders NEAREST the bottom-right
 * corner and later ones stack above it, and because the stack is laid out by
 * flexbox rather than by computed offsets, a widget collapsing to its bubble
 * re-flows the others automatically instead of leaving a hole.
 *
 * `pointerEvents: 'none'` on the dock keeps the column from swallowing clicks on
 * the page underneath — without it the dock would be an invisible 400px-wide
 * dead strip down the right of every screen. Each widget re-enables pointer
 * events on its own root (`OmnisWidget` sets `pointerEvents: 'auto'`), so only
 * the painted area is clickable.
 */
const OmnisWidgetDock = ({ children }: { children: ReactNode }): ReactElement => (
	<Box
		position='fixed'
		display='flex'
		flexDirection='column-reverse'
		style={{
			right: 24,
			bottom: 24,
			zIndex: OMNIS_WIDGET_Z_INDEX,
			gap: 12,
			alignItems: 'flex-end',
			pointerEvents: 'none',
			maxHeight: 'calc(100vh - 48px)',
		}}
	>
		{children}
	</Box>
);

export default OmnisWidgetDock;
