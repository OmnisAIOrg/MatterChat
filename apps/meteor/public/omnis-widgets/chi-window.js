/*
 * Standalone Chi orb for the desktop app's dedicated always-on-top window (chi-window.html).
 * External file (CSP blocks inline). Same origin as the app → shares localStorage, so it reads the
 * RC login token and calls the caller-scoped Chi endpoints directly. Adds a control bar (drag / resize
 * / realtime voice / close), since a popped-out orb needs those — the in-app orb gets them from React.
 *
 * The window is frameless + transparent. Critically, when the orb minimizes to its 76px launcher we
 * shrink the NATIVE window to hug it (96x96) — otherwise the original 460x640 transparent rectangle
 * lingers as an invisible click-blocker over whatever is behind it. In that puck state the whole thing
 * is manually draggable (a click still expands; a drag repositions).
 */
(function () {
	'use strict';
	var API = '/api/v1/chi.ask';
	var RT_API = '/api/v1/chi.realtime-session';
	var bridge = window.matterchatDesktop || {};
	var BASE_W = 460, BASE_H = 640, MINI = 96;
	var scale = 1;
	var minimized = false;

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

	function fullW() { return Math.round(BASE_W * scale); }
	function fullH() { return Math.round(BASE_H * scale); }
	function resizeWindow(w, h) { if (bridge.resizeChiWindow) bridge.resizeChiWindow(w, h); }

	// Minimize/expand: shrink the native window to hug the launcher (kills the invisible click-blocker)
	// and toggle the control bar. Driven by the orb's `chi-toggle` event so the state stays in sync
	// whether the user hits the orb's minimize button or its launcher.
	function setMode(min) {
		minimized = min;
		bar.style.display = min ? 'none' : 'flex';
		resizeWindow(min ? MINI : fullW(), min ? MINI : fullH());
	}
	document.addEventListener('chi-toggle', function (e) { setMode(!!(e.detail && e.detail.min)); });

	function applyScale(delta) {
		scale = Math.max(0.6, Math.min(1.6, scale + delta));
		if (!minimized) resizeWindow(fullW(), fullH());
		var orb = document.querySelector('chi-orb');
		if (orb) orb.style.transform = 'scale(' + scale + ')';
	}
	smaller.addEventListener('click', function () { applyScale(-0.15); });
	bigger.addEventListener('click', function () { applyScale(0.15); });
	closeBtn.addEventListener('click', function () { if (bridge.closeChiWindow) bridge.closeChiWindow(); });

	// ── manual drag of the puck ──────────────────────────────────────────────────────────────
	// In minimized (96x96) mode the enso launcher owns the click (→ expand), so we can't use
	// `-webkit-app-region:drag` (it would swallow that click). Instead track the pointer: movement past
	// a threshold repositions the window via IPC; a pointer-up with no movement falls through as a click
	// (the orb expands). A drag suppresses the trailing click so it doesn't also expand.
	var drag = null, justDragged = false;
	document.addEventListener('pointerdown', function (e) {
		if (!minimized) return;
		drag = { x: e.screenX, y: e.screenY, moved: false };
		try { document.documentElement.setPointerCapture(e.pointerId); drag.id = e.pointerId; } catch (_) {}
	});
	document.addEventListener('pointermove', function (e) {
		if (!drag) return;
		var dx = e.screenX - drag.x, dy = e.screenY - drag.y;
		if (!drag.moved && dx * dx + dy * dy < 16) return; // ~4px dead-zone
		drag.moved = true; drag.x = e.screenX; drag.y = e.screenY;
		if (bridge.moveChiBy) bridge.moveChiBy(dx, dy);
	});
	function endDrag() {
		if (drag) { if (drag.moved) justDragged = true; if (drag.id != null) { try { document.documentElement.releasePointerCapture(drag.id); } catch (_) {} } }
		drag = null;
	}
	document.addEventListener('pointerup', endDrag);
	document.addEventListener('pointercancel', endDrag);
	document.addEventListener('click', function (e) { if (justDragged) { justDragged = false; e.stopPropagation(); e.preventDefault(); } }, true);

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
		var orb = document.querySelector('chi-orb'); if (orb) orb.realtime = false; // back to the chat version
	}
	async function startVoice() {
		try {
			micBtn.style.color = '#30d158'; micBtn.style.background = 'rgba(48,209,88,.22)'; micBtn.title = 'Connecting…';
			var s = await fetch(RT_API, { method: 'POST', headers: authHeaders(), body: '{}' }).then(function (r) { return r.json(); });
			if (!s || !s.token) { micBtn.title = (s && s.error) || 'Voice not available'; stopVoice(); return; }
			var pc = new RTCPeerConnection();
			var audio = new Audio(); audio.autoplay = true;
			pc.addEventListener('track', function (e) { audio.srcObject = e.streams[0]; });
			// Ask macOS for mic access (TCC) FIRST. In the packaged desktop app this window loads a
			// remote origin, so getUserMedia fails silently without an explicit ask via the desktop
			// bridge. On the web (no bridge) this is skipped and getUserMedia runs normally.
			try {
				var b = window.matterchatDesktop;
				if (b && b.micAsk) {
					var g = await b.micAsk();
					if (g && g.microphone === false) { micBtn.title = 'Mic blocked — allow it in System Settings › Privacy › Microphone'; stopVoice(); return; }
				}
			} catch (e) { /* fall through to getUserMedia, which will surface any real error */ }
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
			// Flip the orb to its realtime LISTENING version; tapping it ends the call.
			var orb = document.querySelector('chi-orb'); if (orb) { orb.realtime = true; orb.onvoiceend = stopVoice; }
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
		// This IS the desktop app's Chi window: realtime IS available here (transparent native window,
		// its own WebRTC). Offer the orb's realtime UI (minimized mic + LISTENING) and wire its start/
		// end back to this window's OpenAI-realtime session.
		orb.setAttribute('realtime-available', '1');
		orb.onvoicestart = startVoice;
		orb.onvoiceend = stopVoice;
		orb.ask = ask;
		orb.actions = [
			{ label: 'Summarize my day', command: 'Catch me up — what needs my attention?' },
			{ label: 'Any mentions?', command: 'Do I have any mentions or unread messages?' },
			{ label: 'Draft a standup update', command: 'Draft a standup update from my recent activity' },
		];
		orb.style.cssText = '-webkit-app-region:no-drag;transform-origin:center;';
		wrap.appendChild(orb);
		setMode(false); // start expanded, window already at full size
	}
	mount();
})();
