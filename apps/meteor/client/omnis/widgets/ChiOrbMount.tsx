import type { CSSProperties, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { askChi } from './askChi';
import { insertIntoComposer, sendChiReply } from './chiNotifications';
import { installDesktopFocusBridge } from './focusBridge';
import { loadOmnisWidget, omnisWidgetSrc, OMNIS_WIDGET_ASSET_BASE } from './loadOmnisWidget';
import { roomCoordinator } from '../../lib/rooms/roomCoordinator';

/**
 * Desktop (Electron) bridge exposed by MatterChat-Desktop's preload. Present only in the desktop
 * app: there, pop-out opens a NATIVE always-on-top window (Electron has no Document PiP), and that
 * window relays navigate actions back here so the main app moves, not the panel.
 */
type DesktopBridge = {
	isDesktop?: boolean;
	popOutChi?: () => Promise<unknown>; // ipcRenderer.invoke → thenable (awaited in popOut)
	closeChiWindow?: () => void;
	findChiWindow?: () => Promise<unknown>; // recenter + front the (possibly lost) native Chi window
	onChiWindowClosed?: (cb: () => void) => void;
	onNavigate?: (cb: (p: { rid: string; name: string; t: string }) => void) => void;
	navigateFromOrb?: (p: unknown) => void;
};
const desktopBridge = (): DesktopBridge | undefined => (window as unknown as { matterchatDesktop?: DesktopBridge }).matterchatDesktop;

/**
 * Floating Chi assistant orb — the same `<chi-orb>` used across Omnis products, wired to MatterChat's
 * Chi via askChi. EVERY control lives ON the orb ring (the grip above the ensō is the one drag handle;
 * pop-out sits next to the theme switch), so the in-app orb matches the popped-out desktop window —
 * no separate floating control bar. The orb emits `chi-drag` deltas (we move the in-app container) and
 * `chi-popout`; position persists in localStorage, minimized state inside the component.
 */
const POS_KEY = 'chi-orb-pos';
const POPPED_KEY = 'chi-popped'; // set by the popped-out window (shared localStorage) → no duplicate orb
const ORB_Z = 2147483000; // above the RC sidebar/rail so a dragged orb is never clipped behind it
const KEEP_ON_SCREEN = 52; // px of the widget that must stay reachable after a drag

// Desktop only: the user closed the native Chi window THIS session (its × = dismiss). Suppress the
// auto-pop-out until reload — but do NOT persist it, so Chi still opens on the next app launch. Reset
// whenever Chi is (re)opened. Web is unaffected (poppedOut = the PiP flag alone).
let chiDesktopDismissed = false;

// poppedOut here means "the orb lives in a PiP window" (web only — on desktop the render is gated on
// isDesktop and never shows the in-app orb). Driven solely by the shared 'chi-popped' flag.
function computePopped(): boolean {
	return localStorage.getItem(POPPED_KEY) === '1';
}

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
	const orbElRef = useRef<HTMLElement | null>(null);
	const pipWinRef = useRef<Window | null>(null);
	// Initialize from shared localStorage so a remount/reload while Chi is already popped out never mounts
	// a duplicate orb. On desktop we ALSO default to popped-out (unless the user docked it) so the in-app
	// orb never flashes before the auto-pop-out effect opens the native window.
	const [poppedOut, setPoppedOut] = useState<boolean>(computePopped);

	// Document Picture-in-Picture (browsers) OR the desktop app's native window bridge — either lets
	// the orb live OUTSIDE the app window.
	const desktop = desktopBridge();
	const canPopOut = 'documentPictureInPicture' in window || Boolean(desktop?.isDesktop);

	const clamp = useCallback((x: number, y: number): Pos => {
		const rect = containerRef.current?.getBoundingClientRect();
		const w = rect?.width || 200;
		// Allow the widget to go mostly off-screen, but never past the point where KEEP_ON_SCREEN px stays reachable.
		return {
			x: Math.min(Math.max(x, KEEP_ON_SCREEN - w), window.innerWidth - KEEP_ON_SCREEN),
			y: Math.min(Math.max(y, 0), window.innerHeight - KEEP_ON_SCREEN),
		};
	}, []);

	// Move the in-app container by a screen-space delta emitted from the orb's grip/launcher (chi-drag).
	const moveBy = useCallback(
		(dx: number, dy: number) => {
			setPos((p) => {
				const rect = containerRef.current?.getBoundingClientRect();
				const baseX = p ? p.x : (rect?.left ?? 0);
				const baseY = p ? p.y : (rect?.top ?? 0);
				return clamp(baseX + dx, baseY + dy);
			});
		},
		[clamp],
	);

	const popOut = useCallback(async () => {
		// Desktop app: open the NATIVE always-on-top Chi window (Electron has no Document PiP). Only hide
		// the in-app orb AFTER the native window actually opens — if popOutChi rejects, keep the orb so Chi
		// never just vanishes.
		const d = desktopBridge();
		chiDesktopDismissed = false; // opening Chi clears any this-session dismissal
		if (d?.isDesktop && d.popOutChi) {
			try {
				await d.popOutChi();
				localStorage.setItem(POPPED_KEY, '1');
				setPoppedOut(true);
			} catch {
				/* desktop app can't pop out — leave the in-app orb exactly where it is */
			}
			return;
		}
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
			const { body } = pip.document;
			body.style.margin = '0';
			body.style.background = 'transparent';
			body.style.display = 'flex';
			body.style.alignItems = 'center';
			body.style.justifyContent = 'center';
			body.style.overflow = 'hidden';
			body.appendChild(orb);
			localStorage.setItem(POPPED_KEY, '1');
			setPoppedOut(true);
			pip.addEventListener('pagehide', () => {
				if (hostRef.current && orbElRef.current) {
					hostRef.current.appendChild(orbElRef.current);
				}
				pipWinRef.current = null;
				localStorage.removeItem(POPPED_KEY);
				setPoppedOut(false);
			});
		} catch {
			/* dismissed / unsupported */
		}
	}, []);

	// Keep the latest moveBy/popOut reachable from the orb's (stable) event listeners.
	const moveByRef = useRef(moveBy);
	moveByRef.current = moveBy;
	const popOutRef = useRef(popOut);
	popOutRef.current = popOut;

	// Make a clicked desktop notification actually surface the window it navigates to (Electron ignores the
	// core onclick's renderer window.focus()).
	useEffect(() => {
		installDesktopFocusBridge();
	}, []);

	// Relays FROM the popped-out desktop Chi window (separate window, shared localStorage):
	//  · chi-flow-relay — Flow-dictated text destined for the room composer over here.
	//  · chi-reply-relay — a notification reply typed in the popout; post it as the member.
	useEffect(() => {
		const onStorage = (e: StorageEvent): void => {
			if (!e.newValue) {
				return;
			}
			try {
				if (e.key === 'chi-flow-relay') {
					const { text } = JSON.parse(e.newValue) as { text?: string };
					if (text && !insertIntoComposer(text)) {
						void navigator.clipboard?.writeText(text);
					}
				} else if (e.key === 'chi-reply-relay') {
					const { rid, text } = JSON.parse(e.newValue) as { rid?: string; text?: string };
					if (rid && text) {
						void sendChiReply({ data: { rid } }, text);
					}
				}
			} catch {
				/* malformed relay — ignore */
			}
		};
		window.addEventListener('storage', onStorage);
		return () => window.removeEventListener('storage', onStorage);
	}, []);

	// Persist the dragged position.
	useEffect(() => {
		if (pos) {
			localStorage.setItem(POS_KEY, JSON.stringify(pos));
		}
	}, [pos]);

	// Desktop only: when the popped-out native Chi window relays a navigate, drive the MAIN app here;
	// and restore the in-app orb when that window closes.
	useEffect(() => {
		const d = desktopBridge();
		if (!d?.isDesktop) {
			return;
		}
		d.onNavigate?.((p) => {
			try {
				roomCoordinator.openRouteLink(p.t as Parameters<typeof roomCoordinator.openRouteLink>[0], { rid: p.rid, name: p.name });
			} catch {
				/* ignore */
			}
		});
		// The native window's × dismisses Chi for THIS session (no auto-reopen until reload / Find Chi) —
		// session-scoped so it still opens on the next app launch.
		d.onChiWindowClosed?.(() => {
			chiDesktopDismissed = true;
			localStorage.removeItem(POPPED_KEY);
			setPoppedOut(false);
		});
	}, []);

	// Reconcile popped-out state with the ACTUAL window across remounts, reloads, workspace switches, and
	// refocus (the exact "clicked another org → a second Chi appeared" bug). The popped-out window owns the
	// 'chi-popped' flag in shared localStorage; re-read it on mount, on refocus, and on storage/visibility.
	useEffect(() => {
		const sync = (): void => setPoppedOut(computePopped());
		sync();
		window.addEventListener('focus', sync);
		window.addEventListener('storage', sync);
		document.addEventListener('visibilitychange', sync);
		return () => {
			window.removeEventListener('focus', sync);
			window.removeEventListener('storage', sync);
			document.removeEventListener('visibilitychange', sync);
		};
	}, []);

	// DESKTOP DEFAULT: Chi lives in its OWN floating window, not inside the app frame (the in-app orb is
	// in the way). On load, open it — unless the user dismissed it this session or it's already open.
	useEffect(() => {
		const d = desktopBridge();
		if (!d?.isDesktop || !d.popOutChi) {
			return;
		}
		if (chiDesktopDismissed || localStorage.getItem(POPPED_KEY) === '1') {
			return;
		}
		void popOutRef.current();
	}, []);

	// "Find Chi" (rail button). Desktop routes straight to findChiWindow; this handles the WEB path
	// (and an older desktop build without findChiWindow): focus the PiP if popped, else reveal the in-app
	// orb at its default resting spot.
	useEffect(() => {
		const onSummon = (): void => {
			const d = desktopBridge();
			if (d?.isDesktop) {
				if (d.findChiWindow) {
					void d.findChiWindow();
				} else if (d.popOutChi) {
					void d.popOutChi();
				}
				return;
			}
			if (pipWinRef.current) {
				try {
					pipWinRef.current.focus();
				} catch {
					/* ignore */
				}
				return;
			}
			const orb = orbElRef.current as (HTMLElement & { _min?: boolean; _toggle?: () => void }) | null;
			if (orb?._min && orb._toggle) {
				orb._toggle();
			}
			setPos(null); // back to the default bottom-right resting spot, on-screen
		};
		window.addEventListener('chi:summon', onSummon);
		return () => window.removeEventListener('chi:summon', onSummon);
	}, []);

	// Create the web component once its bundle is loaded, and wire the Chi adapter + orb events.
	useEffect(() => {
		let cancelled = false;
		// NOTE: this declaration must match the createElement cast below EXACTLY — a wider `history`
		// here fails assignability (param contravariance) and the lost narrowing cascades
		// "possibly undefined" over every later use of `el`.
		let el:
			| (HTMLElement & {
					ask?: (text: string, history: { who: 'me' | 'chi'; text: string }[]) => Promise<{ reply: string; needsConfirm: boolean }>;
			  })
			| undefined;
		// Start minimized (ensō launcher) the first time, so it's out of the way rather than a big orb
		// covering the app; the widget persists the user's choice from then on.
		if (localStorage.getItem('chi-orb-min') === null) {
			localStorage.setItem('chi-orb-min', '1');
		}
		void loadOmnisWidget(omnisWidgetSrc('chi-orb.js')).then(() => {
			if (cancelled || !hostRef.current) {
				return;
			}
			el = document.createElement('chi-orb') as HTMLElement & {
				ask?: (text: string, history: { who: 'me' | 'chi'; text: string }[]) => Promise<{ reply: string; needsConfirm: boolean }>;
			};
			el.setAttribute('theme', 'dark'); // default; the orb's own theme switcher persists the user's pick
			el.setAttribute('asset-base', OMNIS_WIDGET_ASSET_BASE);
			// Pop-out is a control ON the ring (next to the theme switch), matching the popped-out window;
			// the grip above the ensō is the one drag handle. Realtime voice lives in the popped-out native
			// window (transparent + reliable WebRTC), so the in-app orb stays chat + dictation.
			if (canPopOut) {
				el.setAttribute('popout-control', '1');
			}
			el.ask = (text: string, history: { who: 'me' | 'chi'; text: string }[]): Promise<{ reply: string; needsConfirm: boolean }> =>
				askChi(text, history);
			// Notification-card replies post straight back to the source room, as the member.
			(el as HTMLElement & { onreply?: (t: { data?: { rid?: string } }, text: string) => Promise<void> }).onreply = (target, text) =>
				sendChiReply(target, text);
			// Flow dictation → the room composer (clipboard is the orb's own fallback).
			el.addEventListener('chi-flow-insert', ((ev: Event): void => {
				const text = (ev as CustomEvent<{ text: string }>).detail?.text;
				if (text && !insertIntoComposer(text)) {
					void navigator.clipboard?.writeText(text);
				}
			}) as EventListener);
			// Action chips wired to real capabilities (catch-up / mentions / drafting).
			const orbApi = el as HTMLElement & { actions?: { label: string; command: string }[] };
			orbApi.actions = [
				{ label: 'Summarize my day', command: 'Catch me up — what needs my attention?' },
				{ label: 'Any mentions?', command: 'Do I have any mentions or unread messages?' },
				{ label: 'Draft a standup update', command: 'Draft a standup update from my recent activity' },
			];
			// Isolate the orb from MatterChat's global keyboard shortcuts (RC steals focus to the channel
			// composer on keystrokes when it doesn't see a focused <input> — the orb's input lives in a
			// shadow root). Swallow keyboard/clipboard events at the host in the BUBBLE phase (AFTER the
			// orb's own input handlers), so they never reach the document-level handlers. A capture-phase
			// listener would swallow the event before the orb's input saw it — which broke Enter-to-send.
			const swallow = (e: Event): void => e.stopPropagation();
			(['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'paste', 'cut', 'copy'] as const).forEach((type) => {
				el?.addEventListener(type, swallow);
			});
			// The orb's grip / launcher IS the drag handle — move the in-app container by its screen deltas.
			el.addEventListener('chi-drag', (ev: Event): void => {
				const d = (ev as CustomEvent<{ dx: number; dy: number }>).detail;
				if (d) {
					moveByRef.current(d.dx, d.dy);
				}
			});
			// The ring pop-out control.
			el.addEventListener('chi-popout', (): void => {
				void popOutRef.current();
			});
			orbElRef.current = el;
			hostRef.current.appendChild(el);
		});
		return () => {
			cancelled = true;
			el?.remove();
		};
	}, [canPopOut]);

	const containerStyle: CSSProperties = {
		position: 'fixed',
		left: pos ? pos.x : undefined,
		top: pos ? pos.y : undefined,
		right: pos ? undefined : 24,
		bottom: pos ? undefined : 24,
		zIndex: ORB_Z,
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		touchAction: 'none',
	};

	// DESKTOP: Chi lives ONLY in its own native window — never an in-app orb, never a floating pill (both
	// were "in the way"). We keep a hidden host for the (unused) orb element; the "Find Chi" rail button
	// (AppLeftRail) recenters/reopens the native window. The hidden host must exist so the mount effect's
	// appendChild has a home.
	if (desktop?.isDesktop) {
		return createPortal(<div ref={hostRef} style={{ display: 'none' }} />, document.body);
	}

	// WEB, popped to a Document-PiP window: keep a hidden home for the orb to return to on close. No pill —
	// the "Find Chi" rail button (chi:summon) brings it back / focuses it.
	if (poppedOut) {
		return createPortal(<div ref={hostRef} style={{ display: 'none' }} />, document.body);
	}

	// WEB, in-app: the draggable orb. Portaled to <body> so it escapes the stock #main-content z-0 stacking
	// context and is never clipped behind the z-2 sidebar (a higher z-index alone cannot escape that context).
	return createPortal(
		<div ref={containerRef} style={containerStyle}>
			<div ref={hostRef} style={{ touchAction: 'none' }} />
		</div>,
		document.body,
	);
};

export default ChiOrbMount;
