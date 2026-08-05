import { css } from '@rocket.chat/css-in-js';
import { Box } from '@rocket.chat/fuselage';
import type { AllHTMLAttributes } from 'react';

import WellScrollShade from './WellScrollShade';

const MainContent = ({ className, children, ...props }: Omit<AllHTMLAttributes<HTMLDivElement>, 'is'>) => {
	const customCSS = css`
		@media print {
			overflow: visible !important; /* 1 */
			height: auto !important; /* 1 */
			max-height: none !important; /* 1 */
			flex-shrink: 0 !important; /* 1 */
		}

		@media (width <= 767px) {
			transition:
				right 0.25s cubic-bezier(0.5, 0, 0.1, 1),
				transform 0.1s linear;
			will-change: transform;
		}
	`;

	return (
		<Box
			is='main'
			id='main-content'
			className={[customCSS, className]}
			position='relative'
			zIndex={0}
			display='flex'
			flexDirection='column'
			flexGrow={1}
			flexShrink={1}
			flexBasis='100%'
			width='1vw'
			height='100%'
			{...props}
		>
			{/* MATTERCHAT: the well's top-edge scroll shade (frame spec §4.3). Absolutely positioned
			    against this box — which is why #main-content is already position:relative — so it adds
			    no layout. Invisible until something inside scrolls, and inert unless the depth flag is on. */}
			<WellScrollShade />
			{children}
		</Box>
	);
};

export default MainContent;
