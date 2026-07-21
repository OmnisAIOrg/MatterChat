/**
 * Loads an Omnis web-component bundle (served from apps/meteor/public/omnis-widgets/) exactly once,
 * no matter how many mount points ask for it. The bundles are hand-authored zero-dependency Web
 * Components (`<word-clock-widget>`, `<chi-orb>`) kept OUT of the Meteor/tsc pipeline on purpose —
 * loading them as static scripts avoids typing/eslint churn on vendored UI code and lets them be
 * reused verbatim across Omnis products. Each bundle self-guards its `customElements.define`.
 */
const inflight = new Map<string, Promise<void>>();

export function loadOmnisWidget(src: string): Promise<void> {
	const existing = inflight.get(src);
	if (existing) {
		return existing;
	}
	const promise = new Promise<void>((resolve, reject) => {
		if (document.querySelector(`script[data-omnis-widget="${src}"]`)) {
			resolve();
			return;
		}
		const script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.dataset.omnisWidget = src;
		script.addEventListener('load', () => resolve());
		script.addEventListener('error', () => reject(new Error(`Failed to load Omnis widget: ${src}`)));
		document.head.appendChild(script);
	});
	inflight.set(src, promise);
	return promise;
}

export const OMNIS_WIDGET_ASSET_BASE = '/omnis-widgets/enso-assets/';
