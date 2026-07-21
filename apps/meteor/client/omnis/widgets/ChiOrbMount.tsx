import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { askChi } from './askChi';
import { loadOmnisWidget, OMNIS_WIDGET_ASSET_BASE } from './loadOmnisWidget';

/**
 * Floating Chi assistant orb — the same `<chi-orb>` used across Omnis products, wired to MatterChat's
 * Chi via askChi (the existing @chi.bot DM pipeline). The whole widget is draggable by its grip
 * handle to ANYWHERE on screen — including mostly off-screen to tuck it out of MatterChat's way —
 * while a small always-reachable margin keeps the grip grabbable so it can be pulled back. The orb's
 * own minimize button (76px ensō launcher) is the other "get it out of the way" affordance. Position
 * persists in localStorage; the orb's minimized state persists inside the component itself.
 */
const POS_KEY = 'chi-orb-pos';
const KEEP_ON_SCREEN = 52; // px of the widget that must stay reachable after a drag

type Pos = { x: number; y: number };

function loadPos(): Pos | undefined {
	try {
		const raw = localStorage.getItem(POS_KEY);
		if (!raw) {
			return undefined;
		}
		const p = JSON.parse(raw) as Pos;
		if (typeof p?.x === 'number' && typeof p?.y === 'number') {
			return p;
		}
	} catch {
		/* ignore */
	}
	return undefined;
}

export const ChiOrbMount = (): ReactElement => {
	const hostRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	// null = the default resting spot (bottom-right, via CSS right/bottom). Once the user drags, it
	// becomes explicit {x,y} left/top coords. This avoids any first-paint measurement race.
	const [pos, setPos] = useState<Pos | null>(() => loadPos() ?? null);
	const drag = useRef<{ dx: number; dy: number } | null>(null);
	const orbElRef = useRef<HTMLElement | null>(null);
	const pipWinRef = useRef<Window | null>(null);
	const [poppedOut, setPoppedOut] = useState(false);
	// Document Picture-in-Picture = a real, always-on-top OS window we can move the orb into, so it
	// lives OUTSIDE the app window (Chrome/Edge; Electron when its Chromium enables it).
	const pipSupported = 'documentPictureInPicture' in window;

	// Create the web component once its bundle is loaded, and wire the Chi adapter.
	useEffect(() => {
		let cancelled = false;
		let el: (HTMLElement & { ask?: (text: string, history: unknown) => Promise<string> }) | undefined;
		// Start minimized (76px ensō launcher) the first time, so it's out of the way rather than a
		// 520px orb covering the app; the widget persists the user's choice from then on.
		if (localStorage.getItem('chi-orb-min') === null) {
			localStorage.setItem('chi-orb-min', '1');
		}
		void loadOmnisWidget('/omnis-widgets/chi-orb.js').then(() => {
			if (cancelled || !hostRef.current) {
				return;
			}
			el = document.createElement('chi-orb') as HTMLElement & {
				ask?: (text: string, history: { who: 'me' | 'chi'; text: string }[]) => Promise<string>;
			};
			el.setAttribute('theme', 'dark');
			el.setAttribute('asset-base', OMNIS_WIDGET_ASSET_BASE);
			el.ask = (text: string, history: { who: 'me' | 'chi'; text: string }[]): Promise<string> => askChi(text, history);
			// Suggested chips reflecting what Chi can actually do for a member (it navigates the UI +
			// manages your account; admins get the full ops surface on top).
			(el as HTMLElement & { actions?: { label: string; command: string }[] }).actions = [
				{ label: 'What can you do?', command: 'What can you help me with?' },
				{ label: 'Take me to a chat', command: 'Open my general channel' },
				{ label: 'My notification sound', command: 'What is my current notification sound?' },
			];
			// Isolate the orb from MatterChat's global keyboard shortcuts (RC steals focus to the channel
			// composer on keystrokes when it doesn't see a focused <input> — the orb's input lives in a
			// shadow root, so activeElement is the host and RC mis-fires). Swallow keyboard/clipboard
			// events at the host, in BOTH phases, so they never reach the document-level handlers.
			const swallow = (e: Event): void => e.stopPropagation();
			(['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'paste', 'cut', 'copy'] as const).forEach((type) => {
				el?.addEventListener(type, swallow);
				el?.addEventListener(type, swallow, true);
			});
			orbElRef.current = el;
			hostRef.current.appendChild(el);
		});
		return () => {
			cancelled = true;
			el?.remove();
		};
	}, []);

	const clamp = useCallback((x: number, y: number): Pos => {
		const rect = containerRef.current?.getBoundingClientRect();
		const w = rect?.width || 200;
		const h = rect?.height || 200;
		// Allow the widget to go mostly off-screen, but never past the point where KEEP_ON_SCREEN px
		// (which includes the grip) would be unreachable.
		return {
			x: Math.min(Math.max(x, KEEP_ON_SCREEN - w), window.innerWidth - KEEP_ON_SCREEN),
			y: Math.min(Math.max(y, 0), window.innerHeight - KEEP_ON_SCREEN),
		};
	}, []);

	const onGripDown = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			e.preventDefault();
			const rect = containerRef.current?.getBoundingClientRect();
			drag.current = { dx: e.clientX - (rect?.left ?? 0), dy: e.clientY - (rect?.top ?? 0) };
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
		},
		[],
	);

	const onGripMove = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (!drag.current) {
				return;
			}
			setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
		},
		[clamp],
	);

	const onGripUp = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (!drag.current) {
				return;
			}
			drag.current = null;
			try {
				(e.target as HTMLElement).releasePointerCapture(e.pointerId);
			} catch {
				/* ignore */
			}
			setPos((p) => {
				if (p) {
					localStorage.setItem(POS_KEY, JSON.stringify(p));
				}
				return p;
			});
		},
		[],
	);

	const popOut = useCallback(async () => {
		const orb = orbElRef.current;
		const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: unknown) => Promise<Window> } })
			.documentPictureInPicture;
		if (!orb || !dpip) {
			return;
		}
		try {
			const pip = await dpip.requestWindow({ width: 540, height: 640 });
			pipWinRef.current = pip;
			// Ensure the orb is EXPANDED (not the tiny launcher) in its own dedicated window.
			const orbAny = orb as unknown as { _min?: boolean; _toggle?: () => void };
			if (orbAny._min && orbAny._toggle) {
				orbAny._toggle();
			}
			const body = pip.document.body;
			body.style.margin = '0';
			body.style.background = 'transparent';
			body.style.display = 'flex';
			body.style.alignItems = 'center';
			body.style.justifyContent = 'center';
			body.style.overflow = 'hidden';
			body.appendChild(orb);
			setPoppedOut(true);
			pip.addEventListener('pagehide', () => {
				if (hostRef.current && orbElRef.current) {
					hostRef.current.appendChild(orbElRef.current);
				}
				pipWinRef.current = null;
				setPoppedOut(false);
			});
		} catch {
			/* dismissed / unsupported */
		}
	}, []);

	const containerStyle: CSSProperties = {
		position: 'fixed',
		left: pos ? pos.x : undefined,
		top: pos ? pos.y : undefined,
		right: pos ? undefined : 24,
		bottom: pos ? undefined : 24,
		zIndex: 9998,
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		touchAction: 'none',
	};

	const gripStyle: CSSProperties = {
		width: 46,
		height: 16,
		marginBottom: -6,
		borderRadius: 8,
		cursor: 'grab',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 3,
		background: 'rgba(20,24,29,.72)',
		border: '1px solid rgba(255,255,255,.16)',
		backdropFilter: 'blur(8px)',
		WebkitBackdropFilter: 'blur(8px)',
		zIndex: 1,
	};

	// While popped out, the orb lives in its own OS window; leave a small pill to bring it back.
	if (poppedOut) {
		return (
			<div style={{ ...containerStyle, alignItems: 'flex-end' }}>
				<button
					type='button'
					title='Bring Chi back into the window'
					onClick={() => pipWinRef.current?.close()}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						padding: '6px 12px',
						borderRadius: 16,
						cursor: 'pointer',
						color: '#dfe3e8',
						font: '600 12px -apple-system, BlinkMacSystemFont, sans-serif',
						background: 'rgba(20,24,29,.82)',
						border: '1px solid rgba(48,209,88,.4)',
						backdropFilter: 'blur(10px)',
						WebkitBackdropFilter: 'blur(10px)',
					}}
				>
					<span style={{ width: 8, height: 8, borderRadius: '50%', background: '#30d158' }} />
					Chi is in its own window ▸ bring back
				</button>
				<div ref={hostRef} style={{ display: 'none' }} />
			</div>
		);
	}

	return (
		<div ref={containerRef} style={containerStyle}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: -6, zIndex: 1 }}>
				<div
					title='Drag Chi anywhere'
					style={gripStyle}
					onPointerDown={onGripDown}
					onPointerMove={onGripMove}
					onPointerUp={onGripUp}
				>
					<span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,.5)' }} />
					<span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,.5)' }} />
					<span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,.5)' }} />
				</div>
				{pipSupported && (
					<button
						type='button'
						title='Pop Chi out into its own window'
						onClick={() => {
							void popOut();
						}}
						style={{
							width: 20,
							height: 16,
							borderRadius: 8,
							cursor: 'pointer',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							padding: 0,
							color: 'rgba(255,255,255,.7)',
							background: 'rgba(20,24,29,.72)',
							border: '1px solid rgba(255,255,255,.16)',
						}}
					>
						<svg width='9' height='9' viewBox='0 0 12 12' fill='none'>
							<path d='M4.5 2 H10 V7.5 M10 2 L5 7' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
							<path d='M8 7 V10 H2 V4 H5' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
						</svg>
					</button>
				)}
			</div>
			<div ref={hostRef} />
		</div>
	);
};

export default ChiOrbMount;
