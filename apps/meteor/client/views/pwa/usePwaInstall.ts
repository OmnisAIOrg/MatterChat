import { useEffect, useState, useCallback } from 'react';

import { isStandalone, isDesktopApp, isIosSafari } from './pwaEnv';

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;

// Capture the event as early as possible — it fires once and won't re-fire, so
// we stash it at module load (before React mounts the prompt component).
if (typeof window !== 'undefined') {
	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
		try {
			window.dispatchEvent(new CustomEvent('mc:pwa-installable'));
		} catch {
			/* ignore */
		}
	});
	window.addEventListener('appinstalled', () => {
		deferredPrompt = null;
		try {
			window.dispatchEvent(new CustomEvent('mc:pwa-installed'));
		} catch {
			/* ignore */
		}
	});
}

export type PwaInstallState = {
	/** Chromium/Firefox: a native install prompt is available. */
	canPromptInstall: boolean;
	/** iOS Safari: no prompt API — show the Add-to-Home-Screen hint instead. */
	showIosHint: boolean;
	/** Trigger the native install prompt (no-op on iOS). Returns the outcome. */
	promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
};

/**
 * Installability state per B.3.
 * Suppressed entirely when already installed (standalone) or inside the desktop
 * wrapper — we never tell desktop users to install a PWA.
 */
export function usePwaInstall(): PwaInstallState {
	const suppressed = isStandalone() || isDesktopApp();
	const [canPromptInstall, setCanPromptInstall] = useState(() => !suppressed && deferredPrompt !== null);

	useEffect(() => {
		if (suppressed) {
			return;
		}
		const onInstallable = () => setCanPromptInstall(true);
		const onInstalled = () => setCanPromptInstall(false);
		window.addEventListener('mc:pwa-installable', onInstallable);
		window.addEventListener('mc:pwa-installed', onInstalled);
		// Pick up an event that may have fired before this effect ran.
		if (deferredPrompt) {
			setCanPromptInstall(true);
		}
		return () => {
			window.removeEventListener('mc:pwa-installable', onInstallable);
			window.removeEventListener('mc:pwa-installed', onInstalled);
		};
	}, [suppressed]);

	const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
		if (!deferredPrompt) {
			return 'unavailable';
		}
		try {
			await deferredPrompt.prompt();
			const choice = await deferredPrompt.userChoice;
			deferredPrompt = null;
			setCanPromptInstall(false);
			return choice.outcome;
		} catch {
			return 'unavailable';
		}
	}, []);

	return {
		canPromptInstall,
		showIosHint: !suppressed && isIosSafari(),
		promptInstall,
	};
}
