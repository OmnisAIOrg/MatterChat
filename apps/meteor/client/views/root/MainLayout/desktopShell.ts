import { useEffect, useState } from 'react';

/**
 * The desktop wrapper's bridge object, injected by MatterChat-Desktop's preload as
 * `window.matterchatDesktop`. Everything here is OPTIONAL on purpose: the same web client is served
 * to the browser, the PWA, and desktop builds of several different vintages, so every call site has
 * to tolerate the whole object — or any single method — being absent.
 */
export type MatterChatDesktopApi = {
	isDesktop?: boolean;
	/**
	 * True only on shells that run `frame: false, transparent: true`. Those draw NO native window
	 * controls, so the client owes them a set. Older shells leave this undefined and keep their OS
	 * chrome — which is why this is a positive capability flag rather than an inference from
	 * `isDesktop`.
	 */
	frameless?: boolean;
	windowMinimize?: () => Promise<unknown>;
	windowMaximize?: () => Promise<unknown>;
	windowClose?: () => Promise<unknown>;
	windowIsMaximized?: () => Promise<boolean>;
};

export const desktopApi = (): MatterChatDesktopApi | undefined =>
	(window as unknown as { matterchatDesktop?: MatterChatDesktopApi }).matterchatDesktop;

/**
 * Whether this client is running inside a frameless desktop shell.
 *
 * Read in an effect rather than at module scope: the preload injects the bridge before the page
 * loads, but reading it during render would make the value non-reactive across a hot reload and
 * would break SSR/tests where `window` may not carry it. Defaults to false, so every non-desktop
 * surface behaves exactly as before.
 */
export const useIsFramelessDesktop = (): boolean => {
	const [frameless, setFrameless] = useState(false);

	useEffect(() => {
		const api = desktopApi();
		// Require BOTH the flag and a usable close handler. A shell that advertises frameless but
		// cannot close the window would leave the user trapped, so treat that as not-frameless and
		// fall back to whatever native chrome exists.
		setFrameless(Boolean(api?.frameless && typeof api.windowClose === 'function'));
	}, []);

	return frameless;
};
