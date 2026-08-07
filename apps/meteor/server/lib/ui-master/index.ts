import type { ISettingColor } from '@rocket.chat/core-typings';
import { Settings } from '@rocket.chat/models';
import { escapeHTML } from '@rocket.chat/string-helpers';
import { Meteor } from 'meteor/meteor';
import { Inject } from 'meteor/meteorhacks:inject-initial';
import { Tracker } from 'meteor/tracker';

import { addScript, applyHeadInjections, headInjections, injectIntoBody, injectIntoHead } from './inject';
import { getMessageMaxParseLength } from '../../../lib/getMessageMaxParseLength';
import { withDebouncing } from '../../../lib/utils/highOrderFunctions';
import { settings } from '../../settings';
import { getURL } from '../utils/getURL';

import './scripts';

export * from './inject';

Meteor.startup(() => {
	Tracker.autorun(() => {
		const injections = Object.values(headInjections.all()).filter((injection): injection is NonNullable<typeof injection> => !!injection);
		Inject.rawModHtml('headInjections', applyHeadInjections(injections));
	});

	settings.watch<string>('Default_Referrer_Policy', (value) => {
		if (!value) {
			return injectIntoHead('noreferrer', '<meta name="referrer" content="same-origin" />');
		}

		injectIntoHead('noreferrer', `<meta name="referrer" content="${value}" />`);
	});

	settings.watch<boolean>('Use_RC_SDK', (value) => {
		injectIntoHead('Use_RC_SDK', `<meta name="rc-sdk-transport-enabled" content="${value ? 'on' : 'off'}" />`);
	});

	// MATTERCHAT: mobile PWA head. The served HTML carried NO viewport meta (so iOS rendered the app
	// at desktop width and shrink-scaled it into illegibility) and never linked the web-app manifest —
	// an "installed PWA" was a desktop-scaled bookmark. One-time static injection of the mobile-web
	// fundamentals: proper viewport (viewport-fit=cover unlocks env(safe-area-inset-*) for the
	// MobileTabBar/NavBar), the manifest link, the iOS standalone-mode metas, and the touch icon.
	injectIntoHead(
		'matterchat-mobile-pwa',
		// maximum-scale=1 + user-scalable=no is the app-grade zoom lockdown (what Slack/Discord
		// mobile web ship): it kills iOS's focus-an-input auto-zoom and double-tap/pinch zoom that
		// leave the app frame panned and "unlocked". This is an installed app surface, not a
		// document — zooming the chrome is never intended.
		`<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
		<link rel="manifest" href="${getURL('images/manifest.json')}" />
		<meta name="mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
		<link rel="apple-touch-icon" sizes="180x180" href="${getURL('images/pwa/apple-touch-icon.png')}" />
		${[
			// iOS standalone launch splash (chrome-color, no white flash). device-width/height are
			// CSS points; each PNG is that size × the pixel ratio. Covers the modern iPhone range;
			// unmatched devices just keep the default launch behavior.
			[430, 932, 3, '1290x2796'],
			[393, 852, 3, '1179x2556'],
			[390, 844, 3, '1170x2532'],
			[428, 926, 3, '1284x2778'],
			[375, 812, 3, '1125x2436'],
			[414, 896, 2, '828x1792'],
			[414, 896, 3, '1242x2688'],
			[375, 667, 2, '750x1334'],
		]
			.map(
				([w, h, r, file]) =>
					`<link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)" href="${getURL(`images/pwa/splash/splash-${file}.png`)}" />`,
			)
			.join('\n\t\t')}`,
	);

	// MATTERCHAT: Ensō boot splash — the same brand loading animation as the Omnis Command Center
	// desktop app (ported pattern: hold-mode charge + "Initializing" caption + 3.5s minimum, then
	// ignite + reveal once the app has painted). Loader + assets ship in public/enso/. Skipped for
	// embedded layouts and under DISABLE_ANIMATION (E2E). NOTE: must go through addScript (served
	// as a same-origin file) — a raw inline <script> is silently killed by the CSP.
	if (!process.env.DISABLE_ANIMATION) {
		addScript(
			'ensosplash',
			`(function () {
				if (/layout=embedded/.test(location.search)) return;
				var MIN = 3500;
				var started = performance.now();
				var revealed = false;
				var label = null;
				var labelAnim = null;
				function dismissLabel() {
					if (!label) return;
					try { labelAnim && labelAnim.cancel(); } catch (e) {}
					try { label.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 400, easing: 'ease', fill: 'forwards' }); } catch (e) {}
				}
				function reveal() {
					if (revealed) return;
					revealed = true;
					setTimeout(function () {
						dismissLabel();
						window.EnsoLoader && window.EnsoLoader.done();
					}, Math.max(0, MIN - (performance.now() - started)));
				}
				function watchReady() {
					var r = document.getElementById('react-root');
					if (r && r.firstElementChild) { requestAnimationFrame(function () { requestAnimationFrame(reveal); }); return; }
					var mo = new MutationObserver(function () {
						var el = document.getElementById('react-root');
						if (el && el.firstElementChild) {
							mo.disconnect();
							requestAnimationFrame(function () { requestAnimationFrame(reveal); });
						}
					});
					mo.observe(document.documentElement, { childList: true, subtree: true });
				}
				function boot() {
					if (!window.EnsoLoader) return;
					window.EnsoLoader.play({ hold: true, scrim: true, size: 240 });
					label = document.createElement('div');
					label.textContent = 'Initializing';
					label.style.cssText = 'position:fixed;left:0;right:0;top:calc(50% + 148px);z-index:100000;pointer-events:none;text-align:center;color:rgba(255,255,255,.82);font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:600;letter-spacing:3px;text-transform:uppercase;';
					document.body.appendChild(label);
					try { labelAnim = label.animate([{ opacity: 0.4 }, { opacity: 0.92 }, { opacity: 0.4 }], { duration: 2400, iterations: Infinity, easing: 'ease-in-out' }); } catch (e) {}
					window.addEventListener('enso-loader-done', function () { label && label.remove(); label = null; }, { once: true });
					watchReady();
					setTimeout(reveal, MIN + 8000); // safety cap — never hang on the splash
				}
				function start() {
					var s = document.createElement('script');
					s.src = '/enso/enso-loader.js';
					s.async = false;
					s.setAttribute('data-enso', 'EnsoLoader');
					s.onload = boot;
					s.onerror = function () {};
					document.head.appendChild(s);
				}
				if (document.body) { start(); } else { document.addEventListener('DOMContentLoaded', start); }
			})();`,
		);
	}

	if (process.env.DISABLE_ANIMATION) {
		injectIntoHead(
			'disable-animation',
			`
		<style>
			body, body * {
				animation: none !important;
			}
			</style>
			`,
		);
	}

	settings.watch<boolean>('Assets_SvgFavicon_Enable', (value) => {
		const standardFavicons = `
			<link rel="icon" sizes="16x16" type="image/png" href=${getURL('assets/favicon_16.png')} />
			<link rel="icon" sizes="32x32" type="image/png" href=${getURL('assets/favicon_32.png')} />`;

		if (value) {
			injectIntoHead(
				'Assets_SvgFavicon_Enable',
				`${standardFavicons}
				<link rel="icon" sizes="any" type="image/svg+xml" href=${getURL('assets/favicon.svg')} />`,
			);
		} else {
			injectIntoHead('Assets_SvgFavicon_Enable', standardFavicons);
		}
	});

	settings.watch<string>('theme-color-sidebar-background', (value) => {
		// Single source of truth for theme-color: the static matterchat-mobile-pwa block above
		// deliberately carries none (two theme-color tags = browser-chrome color flicker), so this
		// watcher must always emit one — fall back to the brand navy when the setting is unset.
		const escapedValue = escapeHTML(value || '#1A212C');
		injectIntoHead(
			'theme-color-sidebar-background',
			`<meta name="msapplication-TileColor" content="${escapedValue}" /><meta name="theme-color" content="${escapedValue}" />`,
		);
	});

	settings.watch<string>('Site_Name', (value = 'Rocket.Chat') => {
		const escapedValue = escapeHTML(value);
		injectIntoHead(
			'Site_Name',
			`<title>${escapedValue}</title>` +
				`<meta name="application-name" content="${escapedValue}">` +
				`<meta name="apple-mobile-web-app-title" content="${escapedValue}">`,
		);
	});

	settings.watch<string>('Meta_language', (value = '') => {
		const escapedValue = escapeHTML(value);
		injectIntoHead(
			'Meta_language',
			`<meta http-equiv="content-language" content="${escapedValue}"><meta name="language" content="${escapedValue}">`,
		);
	});

	settings.watch<string>('Meta_robots', (value = '') => {
		const escapedValue = escapeHTML(value);
		injectIntoHead('Meta_robots', `<meta name="robots" content="${escapedValue}">`);
	});

	settings.watch<string>('Meta_msvalidate01', (value = '') => {
		const escapedValue = escapeHTML(value);
		injectIntoHead('Meta_msvalidate01', `<meta name="msvalidate.01" content="${escapedValue}">`);
	});

	settings.watch<string>('Meta_google-site-verification', (value = '') => {
		const escapedValue = escapeHTML(value);
		injectIntoHead('Meta_google-site-verification', `<meta name="google-site-verification" content="${escapedValue}">`);
	});

	settings.watch<string>('Meta_fb_app_id', (value = '') => {
		const escapedValue = escapeHTML(value);
		injectIntoHead('Meta_fb_app_id', `<meta property="fb:app_id" content="${escapedValue}">`);
	});

	settings.watch<string>('Meta_custom', (value = '') => {
		injectIntoHead('Meta_custom', value);
	});

	const baseUrl = ((prefix) => {
		if (!prefix) {
			return '/';
		}

		prefix = prefix.trim();

		if (!prefix) {
			return '/';
		}

		return /\/$/.test(prefix) ? prefix : `${prefix}/`;
	})(__meteor_runtime_config__.ROOT_URL_PATH_PREFIX);

	injectIntoHead('base', `<base href="${baseUrl}">`);

	const escapedMessageMaxParseLength = escapeHTML(String(getMessageMaxParseLength()));
	injectIntoHead('MESSAGE_MAX_PARSE_LENGTH', `<meta name="rc-message-parser-max-length" content="${escapedMessageMaxParseLength}" />`);
});

const renderDynamicCssList = withDebouncing({ wait: 500 })(async () => {
	// const variables = RocketChat.models.Settings.findOne({_id:'theme-custom-variables'}, {fields: { value: 1}});
	const colors = await Settings.find({ _id: /theme-color-rc/i }, { projection: { value: 1, editor: 1 } }).toArray();
	const css = colors
		.filter((color): color is ISettingColor => !!color?.value)
		.map(({ _id, value, editor }) => {
			if (editor === 'expression') {
				return `--${_id.replace('theme-color-', '')}: var(--${value});`;
			}
			return `--${_id.replace('theme-color-', '')}: ${value};`;
		})
		.join('\n');
	injectIntoBody('dynamic-variables', `<style id='css-variables'> :root {${css}}</style>`);
});

await renderDynamicCssList();

settings.watchByRegex(/theme-color-rc/i, renderDynamicCssList);

injectIntoBody(
	'react-root',
	`
<noscript style="color: white; text-align:center">
	You need to enable JavaScript to run this app.
</noscript>
<div id="react-root">
	<div class="page-loading" role="alert" aria-busy="true" aria-live="polite" aria-label="loading">
		<div class="loading__animation">
			<div class="loading__animation__bounce"></div>
			<div class="loading__animation__bounce"></div>
			<div class="loading__animation__bounce"></div>
		</div>
	</div>
</div>
`,
);
