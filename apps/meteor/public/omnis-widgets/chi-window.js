/*
 * Standalone Chi orb for the desktop app's dedicated always-on-top window (chi-window.html).
 * External file (CSP blocks inline). Same origin as the app → shares localStorage, so it reads the
 * RC login token and calls the caller-scoped Chi endpoints directly. Adds a control bar (drag / resize
 * / realtime voice / close), since a popped-out orb needs those — the in-app orb gets them from React.
 */
(function () {
	'use strict';
	var API = '/api/v1/chi.ask';
	var RT_API = '/api/v1/chi.realtime-session';
	var bridge = window.matterchatDesktop || {};

	function authHeaders() {
		var token = localStorage.getItem('Meteor.loginToken');
		var uid = localStorage.getItem('Meteor.userId');
		var h = { 'Content-Type': 'application/json' };
		if (token) h['X-Auth-Token'] = token;
		if (uid) h['X-User-Id'] = uid;
		return h;
	}

	// ── page + layout (CSP-safe: styles via JS) ─────────────────────────────────────────────
	document.documentElement.style.height = '100%';
	var b = document.body;
	b.style.cssText =
		'margin:0;height:100vh;background:transparent;overflow:hidden;display:flex;flex-direction:column;' +
		"align-items:center;justify-content:flex-start;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;";

	// Control bar (draggable region for the frameless window + buttons that must NOT be draggable).
	var bar = document.createElement('div');
	bar.style.cssText =
		'width:100%;height:30px;flex:0 0 30px;display:flex;align-items:center;gap:6px;padding:0 8px;box-sizing:border-box;' +
		'-webkit-app-region:drag;';
	function mkBtn(title, svg, bg, brd) {
		var el = document.createElement('button');
		el.title = title;
		el.innerHTML = svg;
		el.style.cssText =
			'-webkit-app-region:no-drag;width:22px;height:22px;border-radius:11px;cursor:pointer;display:flex;align-items:center;' +
			'justify-content:center;padding:0;color:#dfe3e8;background:' + (bg || 'rgba(20,24,29,.72)') + ';border:1px solid ' + (brd || 'rgba(255,255,255,.16)') + ';';
		return el;
	}
	var grip = document.createElement('div');
	grip.title = 'Drag Chi anywhere';
	grip.style.cssText = 'flex:1;height:100%;-webkit-app-region:drag;display:flex;align-items:center;gap:3px;padding-left:2px;';
	grip.innerHTML =
		'<span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.45)"></span>' +
		'<span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.45)"></span>' +
		'<span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.45)"></span>';
	var smaller = mkBtn('Smaller', '<svg width="10" height="10" viewBox="0 0 12 12"><path d="M2.5 6 h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
	var bigger = mkBtn('Bigger', '<svg width="10" height="10" viewBox="0 0 12 12"><path d="M6 2.5 v7 M2.5 6 h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
	var micBtn = mkBtn('Talk to Chi (voice)', '<svg width="11" height="11" viewBox="0 0 16 16"><rect x="6" y="1.5" width="4" height="8" rx="2" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M3.5 7.5 c0 2.5 2 4.5 4.5 4.5 s4.5 -2 4.5 -4.5 M8 12 v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>');
	var closeBtn = mkBtn('Bring Chi back into the app', '<svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>');
	bar.appendChild(grip);
	bar.appendChild(smaller);
	bar.appendChild(bigger);
	bar.appendChild(micBtn);
	bar.appendChild(closeBtn);
	b.appendChild(bar);

	var wrap = document.createElement('div');
	wrap.style.cssText = 'flex:1;width:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;';
	b.appendChild(wrap);

	// resize the native window (main process owns the actual size)
	var scale = 1;
	function applySize(delta) {
		scale = Math.max(0.6, Math.min(1.6, scale + delta));
		if (bridge.resizeChiWindow) bridge.resizeChiWindow(scale);
		var orb = document.querySelector('chi-orb');
		if (orb) orb.style.transform = 'scale(' + scale + ')';
	}
	smaller.addEventListener('click', function () { applySize(-0.15); });
	bigger.addEventListener('click', function () { applySize(0.15); });
	closeBtn.addEventListener('click', function () { if (bridge.closeChiWindow) bridge.closeChiWindow(); });

	// ── Chi text turn ───────────────────────────────────────────────────────────────────────
	function runActions(actions) {
		if (!Array.isArray(actions)) return;
		actions.forEach(function (a) {
			if (a && a.type === 'navigate' && bridge.navigateFromOrb) bridge.navigateFromOrb(a);
		});
	}
	function ask(text, history) {
		return fetch(API, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text: text, history: history }) })
			.then(function (res) { return res.json().then(function (d) {
				if (!res.ok || d.success === false) return (d && d.error) || "I couldn't reach Chi just now.";
				runActions(d.actions); return d.reply || '…';
			}); })
			.catch(function () { return "I couldn't reach Chi just now — check your connection."; });
	}

	// ── Realtime voice (OpenAI Realtime over WebRTC) ─────────────────────────────────────────
	var rtc = null;
	function stopVoice() {
		if (rtc) { try { rtc.pc.close(); } catch (e) {} try { rtc.mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} rtc = null; }
		micBtn.style.color = '#dfe3e8'; micBtn.style.background = 'rgba(20,24,29,.72)'; micBtn.title = 'Talk to Chi (voice)';
	}
	async function startVoice() {
		try {
			micBtn.style.color = '#30d158'; micBtn.style.background = 'rgba(48,209,88,.22)'; micBtn.title = 'Connecting…';
			var s = await fetch(RT_API, { method: 'POST', headers: authHeaders(), body: '{}' }).then(function (r) { return r.json(); });
			if (!s || !s.token) { micBtn.title = (s && s.error) || 'Voice not available'; stopVoice(); return; }
			var pc = new RTCPeerConnection();
			var audio = new Audio(); audio.autoplay = true;
			pc.addEventListener('track', function (e) { audio.srcObject = e.streams[0]; });
			var mic = await navigator.mediaDevices.getUserMedia({ audio: true });
			mic.getTracks().forEach(function (t) { pc.addTrack(t, mic); });
			pc.createDataChannel('oai-events');
			var offer = await pc.createOffer(); await pc.setLocalDescription(offer);
			var ans = await fetch('https://api.openai.com/v1/realtime?model=' + encodeURIComponent(s.model || 'gpt-4o-realtime-preview'), {
				method: 'POST', body: offer.sdp, headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/sdp' },
			});
			if (!ans.ok) { micBtn.title = 'Voice connection refused'; try { pc.close(); } catch (e) {} mic.getTracks().forEach(function (t) { t.stop(); }); stopVoice(); return; }
			await pc.setRemoteDescription({ type: 'answer', sdp: await ans.text() });
			rtc = { pc: pc, mic: mic }; micBtn.title = 'End voice call';
		} catch (e) { micBtn.title = 'Mic blocked — allow microphone access'; stopVoice(); }
	}
	micBtn.addEventListener('click', function () { if (rtc) stopVoice(); else startVoice(); });

	// ── mount ─────────────────────────────────────────────────────────────────────────────
	function mount() {
		if (!customElements.get('chi-orb')) return setTimeout(mount, 60);
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
		orb.style.cssText = '-webkit-app-region:no-drag;transform-origin:center;';
		wrap.appendChild(orb);
		// The orb's own minimize belongs to the in-app version — in a dedicated window use the ✕ bar
		// button (which brings it back into the app) instead of shrinking to a launcher-in-a-window.
		setTimeout(function () {
			try { var mb = orb.shadowRoot.getElementById('minbtn'); if (mb) mb.style.display = 'none'; } catch (e) {}
		}, 80);
	}
	mount();
})();
