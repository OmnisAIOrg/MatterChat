/*
 * Small environment helpers shared by the PWA components.
 * All are defensive: they must work during SSR-less boot and never throw.
 */

/** True when the app is running as an installed PWA (standalone/minimal-ui). */
export function isStandalone(): boolean {
	try {
		return (
			window.matchMedia?.('(display-mode: standalone)').matches ||
			window.matchMedia?.('(display-mode: minimal-ui)').matches ||
			window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
			// iOS Safari legacy flag
			(window.navigator as unknown as { standalone?: boolean }).standalone === true
		);
	} catch {
		return false;
	}
}

/**
 * True when running inside the MatterChat Electron desktop wrapper.
 * The wrapper exposes `window.matterchatDesktop` via its preload contextBridge
 * (see MATTERCHAT-DESKTOP-PWA-SPEC.md A.2). When present, we suppress the
 * "Install MatterChat" PWA affordance — desktop users already have the app.
 */
export function isDesktopApp(): boolean {
	try {
		return typeof (window as unknown as { matterchatDesktop?: unknown }).matterchatDesktop !== 'undefined';
	} catch {
		return false;
	}
}

/** True on iOS/iPadOS Safari, which has no beforeinstallprompt (needs A2HS hint). */
export function isIos(): boolean {
	try {
		const ua = window.navigator.userAgent || '';
		const iOS = /iPad|iPhone|iPod/.test(ua);
		// iPadOS 13+ reports as Mac; detect via touch points.
		const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
		return iOS || iPadOS;
	} catch {
		return false;
	}
}

/** True for iOS Safari specifically (not Chrome/Firefox on iOS, which can't A2HS the same way). */
export function isIosSafari(): boolean {
	if (!isIos()) {
		return false;
	}
	const ua = window.navigator.userAgent || '';
	return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** base64url VAPID public key -> Uint8Array for pushManager.subscribe. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = window.atob(base64);
	const output = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		output[i] = raw.charCodeAt(i);
	}
	return output;
}
