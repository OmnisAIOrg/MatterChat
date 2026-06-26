/*
 * MatterChat service-worker registration + update flow.
 *
 * Replaces RC's old "auto-reload within 10s" hack (jarring — it could yank the
 * page out mid-message). Instead we register the SW, watch for an updated SW,
 * and surface a non-blocking "New version available — Reload" affordance the
 * user controls (rendered by <PwaUpdatePrompt/>; see views/pwa).
 *
 * Safety: this file is imported from client/main.ts BEFORE React loads, so it
 * stays framework-free and never throws into the boot path — every branch is
 * guarded and failures only `console`-log. A bad registration must not white-
 * screen the app.
 */

export const PWA_UPDATE_EVENT = 'mc:pwa-update-available';

let waitingWorker: ServiceWorker | null = null;
let reloadingFromUpdate = false;

function announceUpdate(worker: ServiceWorker): void {
	waitingWorker = worker;
	try {
		window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT));
	} catch (err) {
		console.error('service worker: failed to announce update', err);
	}
}

/**
 * Called by the UI when the user clicks "Reload". Tells the waiting SW to take
 * over; the `controllerchange` listener below then reloads the page exactly once.
 */
export function applyPwaUpdate(): void {
	if (!waitingWorker) {
		window.location.reload();
		return;
	}
	try {
		waitingWorker.postMessage({ type: 'SKIP_WAITING' });
	} catch (err) {
		console.error('service worker: SKIP_WAITING failed, hard reloading', err);
		window.location.reload();
	}
}

/** True when an updated SW is installed and waiting (UI can also poll this). */
export function isPwaUpdateAvailable(): boolean {
	return waitingWorker !== null;
}

if ('serviceWorker' in navigator) {
	// When the controlling SW changes (because the user accepted an update),
	// reload once so the page runs the new build.
	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (reloadingFromUpdate) {
			return;
		}
		reloadingFromUpdate = true;
		window.location.reload();
	});

	navigator.serviceWorker
		.register('/enc.js', { scope: '/' })
		.then((reg) => {
			// A worker already waiting from a previous load (e.g. user ignored the
			// prompt and navigated): surface it.
			if (reg.waiting && navigator.serviceWorker.controller) {
				announceUpdate(reg.waiting);
			}

			reg.addEventListener('updatefound', () => {
				const { installing } = reg;
				if (!installing) {
					return;
				}
				installing.addEventListener('statechange', () => {
					// "installed" + an existing controller => this is an UPDATE, not a
					// first install. First installs activate silently (no toast).
					if (installing.state === 'installed' && navigator.serviceWorker.controller) {
						announceUpdate(installing);
					}
				});
			});
		})
		.catch((err) => {
			// Never fatal — the app works fine without the SW (just no offline/push).
			console.error(`service worker: registration failed: ${err}`);
		});
}
