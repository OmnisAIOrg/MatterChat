import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { desktopApi, useIsFramelessDesktop } from './desktopShell';

/**
 * Window lights for the FRAMELESS desktop shell.
 *
 * The desktop wrapper runs `frame: false, transparent: true` so the workspace strip can protrude
 * outside the bezel (Omnis Suite frame spec — Command Center ships the same treatment). That means
 * macOS draws no traffic lights and Windows/Linux draw no caption buttons, so the client has to
 * render them and drive them over IPC. Without this component there is no way to close the window.
 *
 * Renders null on the web, on the PWA, and on any desktop build that predates the `frameless`
 * capability flag — those still have real OS chrome, and drawing a second set of lights on top of
 * the native ones would be worse than drawing none.
 *
 * Sits in the 78px the NavBar already reserves on desktop (see MATTERCHAT_FRAME_CSS), so it costs
 * no layout. `app-region: no-drag` is essential: the NavBar is the window's drag surface, and
 * without opting out these buttons would drag the window instead of clicking.
 */

/** macOS light colors, matching the OS palette so the window reads as native. */
const LIGHTS = [
	{ id: 'close', fill: '#FF5F57', label: 'Close' },
	{ id: 'minimize', fill: '#FEBC2E', label: 'Minimize' },
	{ id: 'maximize', fill: '#28C840', label: 'Zoom' },
] as const;

const WindowLights = () => {
	const frameless = useIsFramelessDesktop();
	const [hovered, setHovered] = useState(false);

	const onClick = useCallback((id: (typeof LIGHTS)[number]['id']) => {
		if (id === 'close') void desktopApi()?.windowClose?.();
		else if (id === 'minimize') void desktopApi()?.windowMinimize?.();
		else void desktopApi()?.windowMaximize?.();
	}, []);

	// macOS convention: the glyphs only appear while the cluster is hovered.
	useEffect(() => {
		if (!frameless) setHovered(false);
	}, [frameless]);

	if (!frameless) {
		return null;
	}

	return (
		<div
			role='group'
			aria-label='Window controls'
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				position: 'fixed',
				top: 26,
				insetInlineStart: 26,
				zIndex: 100,
				display: 'flex',
				gap: 8,
				alignItems: 'center',
				// The NavBar is the drag region; interactive children MUST opt out or clicks become drags.
				WebkitAppRegion: 'no-drag',
				appRegion: 'no-drag',
			} as CSSProperties}
		>
			{LIGHTS.map((light) => (
				<button
					key={light.id}
					type='button'
					aria-label={light.label}
					title={light.label}
					onClick={() => onClick(light.id)}
					style={{
						width: 12,
						height: 12,
						padding: 0,
						border: 0,
						borderRadius: '50%',
						cursor: 'default',
						background: light.fill,
						// The same 1px top highlight every raised element in the shell gets.
						boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.35)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						lineHeight: 1,
						fontSize: 9,
						fontWeight: 700,
						color: hovered ? 'rgba(0, 0, 0, 0.55)' : 'transparent',
						transition: 'color 120ms ease-out',
					}}
				>
					{light.id === 'close' ? '✕' : light.id === 'minimize' ? '–' : '+'}
				</button>
			))}
		</div>
	);
};

export default WindowLights;
