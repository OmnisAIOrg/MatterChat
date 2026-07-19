import { Box, css } from '@rocket.chat/fuselage';
import { memo, useMemo } from 'react';

/**
 * HuddleButton: Premium-styled huddle button for room header
 *
 * Uses design tokens from docs/design/premium-refresh/README.md:
 * - radius: 8px (small controls)
 * - colors: primary green #17804D (light) / #3FBC7C (dark)
 * - shadow: shadow1 (resting), shadow2 (hover)
 * - typography: 13.5px body font
 */

const huddleButtonStyles = css`
	.huddle-button {
		display: inline-grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 8px;
		background-color: transparent;
		color: var(--ink3, #8e968f);
		cursor: pointer;
		transition: all 120ms cubic-bezier(0.2, 0.8, 0.3, 1);
		padding: 0;

		&:hover {
			background-color: var(--surface2, #fafaf7);
			color: var(--ink, #171d19);
			box-shadow: 0 1px 2px rgba(23, 29, 25, 0.05), 0 8px 24px -8px rgba(23, 29, 25, 0.14);
		}

		&:active {
			transform: translateY(1px);
		}

		svg {
			width: 18px;
			height: 18px;
			stroke-width: 1.7;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		/* Dark theme */
		@media (prefers-color-scheme: dark) {
			color: var(--ink3, #707b74);

			&:hover {
				background-color: var(--surface2, #19211c);
				color: var(--ink, #e9edea);
				box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px -8px rgba(0, 0, 0, 0.6);
			}
		}
	}
`;

type HuddleButtonProps = {
	onClick: () => void;
	disabled?: boolean;
	tooltip?: string;
	testId?: string;
};

/**
 * MicrophoneIcon: Inline SVG mic icon (lucide-style)
 */
const MicrophoneIcon = () => (
	<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round'>
		<rect x='9.5' y='3.5' width='5' height='11' rx='2.5' />
		<path d='M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21' />
	</svg>
);

const HuddleButton = ({ onClick, disabled = false, tooltip, testId }: HuddleButtonProps) => {
	const buttonAttrs = useMemo(
		() => ({
			'data-testid': testId,
			...(tooltip && { title: tooltip }),
		}),
		[testId, tooltip],
	);

	return (
		<>
			<style>{huddleButtonStyles}</style>
			<button
				className='huddle-button'
				onClick={onClick}
				disabled={disabled}
				type='button'
				{...buttonAttrs}
			>
				<MicrophoneIcon />
			</button>
		</>
	);
};

export default memo(HuddleButton);
