import { css } from '@rocket.chat/css-in-js';
import { Box } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useState } from 'react';

/**
 * ExternalMessageAvatar — the 22px author avatar for a group-start row of the external channel view.
 *
 * Renders `avatarUrl` as an image when the server sends one (the ExternalSidebar `Box is='img'`
 * pattern — a raw <img> with String(cssFn) gets NO class and floods the row at natural size),
 * falling back to the provider-coloured initials dot on absence or load error. Its own module so
 * the img-failed state lives in a stable component (and ExternalChannelView stays one-component).
 */

// The 22px circular avatar image (same footprint/pattern as ExternalSidebar's Avatar).
const avatarImgClass = css`
	flex-shrink: 0;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	object-fit: cover;
	display: block;
	background: var(--rcx-color-surface-neutral, #e4e7ea);
	margin-block-start: 2px;
`;

// The 22px initials dot (background = provider colour via style, same as the sidebar Avatar).
const avatarDotClass = css`
	flex-shrink: 0;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 10px;
	font-weight: 700;
	color: #ffffff;
	line-height: 1;
	user-select: none;
	margin-block-start: 2px;
`;

const initialsOf = (name: string): string => (name.trim().match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();

const ExternalMessageAvatar = ({ name, avatarUrl, color }: { name: string; avatarUrl?: string; color: string }): ReactElement => {
	const [imgFailed, setImgFailed] = useState(false);
	if (avatarUrl && !imgFailed) {
		return <Box is='img' className={avatarImgClass} src={avatarUrl} alt='' onError={(): void => setImgFailed(true)} />;
	}
	return (
		<Box className={avatarDotClass} style={{ background: color }} aria-hidden>
			{initialsOf(name || '?')}
		</Box>
	);
};

export default ExternalMessageAvatar;
