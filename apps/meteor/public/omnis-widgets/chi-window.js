/*
 * Standalone Chi orb for the desktop app's dedicated always-on-top window (chi-window.html).
 * External file (not inline) so the workspace Content-Security-Policy allows it. Same origin as the
 * main app → SHARES localStorage, so we read the RC login token and call the caller-scoped Chi
 * endpoint directly. Navigate actions are relayed to the MAIN window over IPC (window.matterchatDesktop)
 * so "take me to #general" drives the real app, not this panel. Styling is applied via JS (CSP-safe).
 */
(function () {
	'use strict';
	var API = '/api/v1/chi.ask';

	// CSP-safe styling (no inline <style>): dark, transparent page with a top drag strip for the
	// frameless Electron window, orb centered.
	document.documentElement.style.height = '100%';
	var b = document.body;
	b.style.margin = '0';
	b.style.height = '100vh';
	b.style.background = 'transparent';
	b.style.overflow = 'hidden';
	b.style.display = 'flex';
	b.style.alignItems = 'center';
	b.style.justifyContent = 'center';
	b.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif";

	var drag = document.createElement('div');
	drag.style.cssText = 'position:fixed;top:0;left:0;right:0;height:26px;z-index:10;-webkit-app-region:drag;';
	b.appendChild(drag);

	function authHeaders() {
		var token = localStorage.getItem('Meteor.loginToken');
		var uid = localStorage.getItem('Meteor.userId');
		var h = { 'Content-Type': 'application/json' };
		if (token) h['X-Auth-Token'] = token;
		if (uid) h['X-User-Id'] = uid;
		return h;
	}

	function runActions(actions) {
		if (!Array.isArray(actions)) return;
		var bridge = window.matterchatDesktop;
		actions.forEach(function (a) {
			if (a && a.type === 'navigate' && bridge && bridge.navigateFromOrb) bridge.navigateFromOrb(a);
		});
	}

	function ask(text, history) {
		return fetch(API, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text: text, history: history }) })
			.then(function (res) {
				return res.json().then(function (data) {
					if (!res.ok || data.success === false) return (data && data.error) || "I couldn't reach Chi just now.";
					runActions(data.actions);
					return data.reply || '…';
				});
			})
			.catch(function () {
				return "I couldn't reach Chi just now — check your connection.";
			});
	}

	function mount() {
		if (!customElements.get('chi-orb')) {
			// chi-orb.js not ready yet — retry shortly.
			return setTimeout(mount, 60);
		}
		try { localStorage.setItem('chi-orb-min', '0'); } catch (e) {}
		var orb = document.createElement('chi-orb');
		orb.setAttribute('theme', 'dark');
		orb.setAttribute('asset-base', '/omnis-widgets/enso-assets/');
		orb.ask = ask;
		orb.actions = [
			{ label: 'What can you do?', command: 'What can you help me with?' },
			{ label: 'Take me to a chat', command: 'Open my general channel' },
			{ label: 'My notification sound', command: 'What is my current notification sound?' },
		];
		// stop the orb's own keystrokes from being treated as window drags
		orb.style.cssText = '-webkit-app-region:no-drag;';
		b.appendChild(orb);
	}
	mount();
})();
