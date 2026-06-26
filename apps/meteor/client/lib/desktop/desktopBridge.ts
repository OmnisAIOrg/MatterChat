/**
 * Desktop bridge — feature-detection + helpers for the MatterChat desktop (Electron) shell.
 *
 * The desktop shell exposes a `window.matterchatDesktop` object via its preload `contextBridge`
 * (MATTERCHAT-DESKTOP-PWA-SPEC.md §A.2). The web app feature-detects it; EVERYTHING degrades to plain
 * web when it is absent (web + PWA run in a real browser and need none of this).
 *
 * This module is the single client-side place that:
 *   - detects whether we're running inside the desktop shell (`isDesktopApp`),
 *   - opens an OAuth/SSO URL in the SYSTEM browser via the bridge (`openExternal`) — required because
 *     Microsoft/Google block OAuth in embedded webviews (spec §A.4),
 *   - subscribes to `matterchat://` deep-links the shell forwards back after OAuth (`onDeepLink`).
 *
 * No secrets live here: the desktop OAuth hand-off carries only a status (connectors) or a single-use
 * credential token (SSO) on the `matterchat://` URL — never a long-lived token (spec §A.4/§A.5/§C.3).
 */

/** A `matterchat://` deep-link the desktop shell forwards back into the renderer. */
export type DesktopDeepLink = {
	/** Full URL, e.g. `matterchat://oauth/teams?status=ok` or `matterchat://login?token=...`. */
	url: string;
};

/**
 * The preload `contextBridge` surface (spec §A.2). All members are optional so a partial/older shell
 * still feature-detects safely.
 */
export type MatterchatDesktop = {
	/** Open a URL in the user's default SYSTEM browser (used for OAuth/SSO, not in-window). */
	openExternal?: (url: string) => void;
	/** Subscribe to `matterchat://` deep-links the OS handed to the app. Returns an unsubscribe fn. */
	onDeepLink?: (cb: (link: DesktopDeepLink) => void) => (() => void) | void;
	/** Static info about the host shell (version, platform). Presence alone signals "desktop". */
	getDesktopInfo?: () => unknown;
	setBadgeCount?: (n: number) => void;
	flashFrame?: () => void;
};

declare global {
	interface Window {
		matterchatDesktop?: MatterchatDesktop;
	}
}

/** True when running inside the MatterChat desktop shell (the bridge object is present). */
export function isDesktopApp(): boolean {
	return typeof window !== 'undefined' && Boolean(window.matterchatDesktop);
}

/** The bridge object, or undefined on web/PWA. */
export function getDesktopBridge(): MatterchatDesktop | undefined {
	return typeof window !== 'undefined' ? window.matterchatDesktop : undefined;
}

/**
 * Open an OAuth/SSO authorize URL the way the current channel requires:
 *  - DESKTOP: hand it to the system browser via `matterchatDesktop.openExternal` (embedded-webview
 *    OAuth is blocked by Microsoft/Google — spec §A.4). The server-side `client=desktop` branch then
 *    returns to the app via the `matterchat://` scheme.
 *  - WEB/PWA: a normal full-page navigation (unchanged behaviour).
 */
export function openAuthorizeUrl(url: string): void {
	const bridge = getDesktopBridge();
	if (bridge?.openExternal) {
		bridge.openExternal(url);
		return;
	}
	window.location.href = url;
}

/**
 * Subscribe to the desktop deep-link stream. No-op (returns a no-op unsubscribe) on web/PWA, so
 * callers can wire this unconditionally.
 */
export function onDesktopDeepLink(cb: (link: DesktopDeepLink) => void): () => void {
	const bridge = getDesktopBridge();
	if (!bridge?.onDeepLink) {
		return () => undefined;
	}
	const unsubscribe = bridge.onDeepLink(cb);
	return typeof unsubscribe === 'function' ? unsubscribe : () => undefined;
}
