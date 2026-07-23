// MATTERCHAT: in the Electron desktop wrapper a renderer `window.focus()` does NOT bring the
// BrowserWindow to the front — fronting an OS window is a main-process privilege. Rocket.Chat's core
// desktop-notification onclick (useNotification.ts) does `n.close(); window.focus(); router.navigate(...)`
// — so it already routes to the room, but the `window.focus()` is a no-op in Electron and the room opens
// BEHIND an unfocused window ("clicking the notification does nothing"). We route window.focus() through
// the desktop bridge's focusMainWindow so the SAME core click also surfaces the window. Additive, no RC
// core edit, idempotent, runs once.
type DesktopFocus = { isDesktop?: boolean; focusMainWindow?: () => Promise<unknown> };

export function installDesktopFocusBridge(): void {
	if (typeof window === 'undefined') {
		return;
	}
	const w = window as Window & { __mcFocusBridged?: boolean };
	if (w.__mcFocusBridged) {
		return;
	}
	const desktop = (window as unknown as { matterchatDesktop?: DesktopFocus }).matterchatDesktop;
	if (!desktop?.isDesktop || typeof desktop.focusMainWindow !== 'function') {
		return;
	}
	w.__mcFocusBridged = true;
	const nativeFocus = window.focus.bind(window);
	window.focus = (): void => {
		try {
			nativeFocus();
		} catch {
			/* ignore */
		}
		try {
			void desktop.focusMainWindow?.();
		} catch {
			/* ignore */
		}
	};
}
