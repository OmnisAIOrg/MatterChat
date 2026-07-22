/*
 * Standalone Chi orb for the desktop app's dedicated always-on-top window (chi-window.html).
 * External file (CSP blocks inline). Same origin as the app → shares localStorage, so it reads the
 * RC login token and calls the caller-scoped Chi endpoints directly.
 *
 * The window is frameless + transparent and HUGS the orb (no square panel, minimal transparent
 * frame). EVERY control lives ON the orb (grip above the ensō = the one drag handle; ring buttons =
 * theme / minimize / +− size / close / frame). This harness has NO chrome of its own — a popped-out
 * orb that duplicated those controls in the transparent frame was redundant and confusing. It only:
 *   • sizes/moves the native window in response to the orb's events (chi-drag, chi-resize, chi-min,
 *     chi-close, chi-frame) via the desktop bridge (moveChiBy / resizeChiWindow), and
 *   • owns the realtime voice session (OpenAI Realtime over WebRTC), wired to the orb's mic button.
 *
 * When the orb minimizes we shrink the NATIVE window to hug the 80px launcher — otherwise the full
 * transparent rectangle lingers as an invisible click-blocker over whatever is behind it.
 */
(function () {
	'use strict';
	var API = '/api/v1/chi.ask';
	var RT_API = '/api/v1/chi.realtime-session';
	var bridge = window.matterchatDesktop || {};

	// Orb geometry (matches chi-orb.js): a 520px shell + ~14px halo ring, plus a little glow breathing room.
	var ORB_BOX = 548;   // 520 + 14*2 halo
	var MARGIN = 28;     // transparent breathing room each side (also room for the state glow)
	var LAUNCH = 80;     // minimized ensō launcher px at scale 1
	var minimized = localStorage.getItem('chi-orb-min') === '1';
	var frameShown = false;
	var curW = 0, curH = 0;

	function orbScale() { var s = parseFloat(localStorage.getItem('chi-orb-scale')); return s >= 0.7 && s <= 1.5 ? s : 1; }
	function fullSize() { return Math.round(ORB_BOX * orbScale()) + MARGIN * 2; }
	function puckSize() { return Math.max(96, Math.round(LAUNCH * orbScale()) + 28); }

	function authHeaders() {
		var token = localStorage.getItem('Meteor.loginToken');
		var uid = localStorage.getItem('Meteor.userId');
		var h = { 'Content-Type': 'application/json' };
		if (token) h['X-Auth-Token'] = token;
		if (uid) h['X-User-Id'] = uid;
		return h;
	}

	function resizeWindow(w, h) { curW = Math.round(w); curH = Math.round(h); if (bridge.resizeChiWindow) bridge.resizeChiWindow(curW, curH); }
	function moveWindow(dx, dy) { if (bridge.moveChiBy) bridge.moveChiBy(dx, dy); }

	// ── page (CSP-safe: styles via JS) — just a centered, transparent stage for the orb ─────────
	document.documentElement.style.height = '100%';
	var b = document.body;
	b.style.cssText =
		'margin:0;height:100vh;background:transparent;overflow:hidden;display:flex;align-items:center;justify-content:center;' +
		"font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;";

	// ── window frame reveal + resize handle ──────────────────────────────────────────────────
	// Hidden by default (no visible chrome). The orb's "frame" button flashes them so the user can SEE
	// the transparent window's real bounds and drag the corner to make the window bigger.
	var frame = document.createElement('div');
	frame.style.cssText = 'position:fixed;inset:3px;border:1.5px dashed rgba(59,155,255,.85);border-radius:20px;pointer-events:none;opacity:0;transition:opacity .25s;z-index:9;';
	var handle = document.createElement('div');
	handle.title = 'Drag to resize the window';
	handle.style.cssText = 'position:fixed;right:6px;bottom:6px;width:24px;height:24px;border-radius:7px;cursor:nwse-resize;opacity:0;transition:opacity .25s;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(20,24,29,.82);border:1px solid rgba(59,155,255,.7);color:#8fc2ff;';
	handle.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 4 L4 10 M10 7.5 L7.5 10"/></svg>';
	b.appendChild(frame);
	b.appendChild(handle);

	function setFrame(on) {
		frameShown = on;
		frame.style.opacity = on ? '1' : '0';
		handle.style.opacity = on ? '1' : '0';
		handle.style.pointerEvents = on ? 'auto' : 'none';
		clearTimeout(setFrame._t);
		if (on) setFrame._t = setTimeout(function () { if (frameShown && !handle._dragging) setFrame(false); }, 4500); // auto-hide
	}
	(function () { // drag the handle → resize the window (centered growth: the corner tracks the cursor)
		var st = null;
		handle.addEventListener('pointerdown', function (e) {
			e.stopPropagation(); handle._dragging = true;
			st = { x: e.screenX, y: e.screenY, w: curW || fullSize(), h: curH || fullSize() };
			try { handle.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
		});
		handle.addEventListener('pointermove', function (e) {
			if (!st) return;
			resizeWindow(Math.max(220, st.w + (e.screenX - st.x) * 2), Math.max(220, st.h + (e.screenY - st.y) * 2));
		});
		var up = function () { st = null; handle._dragging = false; setFrame(frameShown); };
		handle.addEventListener('pointerup', up);
		handle.addEventListener('pointercancel', up);
	})();

	// ── toast (the orb has no error surface; realtime status/errors land here) ─────────────────
	var toastEl = document.createElement('div');
	toastEl.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:84%;padding:9px 15px;border-radius:13px;font-size:12px;line-height:1.45;text-align:center;color:#fff;background:rgba(18,22,27,.94);border:1px solid rgba(255,255,255,.16);box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;transition:opacity .3s;pointer-events:none;z-index:11;';
	b.appendChild(toastEl);
	function toast(msg, ms) { toastEl.textContent = msg; toastEl.style.opacity = '1'; clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.style.opacity = '0'; }, ms || 3600); }

	// ── Chi text turn ─────────────────────────────────────────────────────────────────────────
	function runActions(actions) {
		if (!Array.isArray(actions)) return;
		actions.forEach(function (a) { if (a && a.type === 'navigate' && bridge.navigateFromOrb) bridge.navigateFromOrb(a); });
	}
	function ask(text, history) {
		return fetch(API, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text: text, history: history }) })
			.then(function (res) { return res.json().then(function (d) {
				if (!res.ok || d.success === false) return (d && d.error) || "I couldn't reach Chi just now.";
				runActions(d.actions); return d.reply || '…';
			}); })
			.catch(function () { return "I couldn't reach Chi just now — check your connection."; });
	}

	// ── Realtime voice (OpenAI Realtime over WebRTC) ───────────────────────────────────────────
	var rtc = null;
	function orbEl() { return document.querySelector('chi-orb'); }
	function stopVoice() {
		if (rtc) { try { rtc.pc.close(); } catch (e) { /* noop */ } try { rtc.mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* noop */ } rtc = null; }
		var orb = orbEl(); if (orb) orb.realtime = false; // back to the chat version
	}
	async function startVoice() {
		if (rtc) return; // already live
		try {
			toast('Connecting to Chi voice…', 6000);
			var s = await fetch(RT_API, { method: 'POST', headers: authHeaders(), body: '{}' }).then(function (r) { return r.json(); }).catch(function () { return null; });
			// No token = realtime isn't configured on the server. Surface WHY instead of silently snapping off.
			if (!s || !s.token) {
				toast((s && s.error) || 'Realtime voice isn’t set up yet — an admin can enable it and add an OpenAI key in Admin → Settings → Chi Assistant.', 7000);
				stopVoice(); return;
			}
			// macOS TCC mic grant FIRST: this window loads a REMOTE origin, so getUserMedia fails silently
			// in the packaged app without an explicit ask through the desktop bridge (mirrors EvidenceHunt).
			try {
				if (bridge.micAsk) { var g = await bridge.micAsk(); if (g && g.microphone === false) { toast('Microphone is blocked — allow it in System Settings → Privacy & Security → Microphone, then try again.', 7000); stopVoice(); return; } }
			} catch (e) { /* fall through to getUserMedia, which surfaces any real error */ }
			var pc = new RTCPeerConnection();
			var audio = new Audio(); audio.autoplay = true;
			pc.addEventListener('track', function (e) { audio.srcObject = e.streams[0]; });
			var mic;
			try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); }
			catch (e) { toast('Microphone is blocked — allow it in System Settings → Privacy & Security → Microphone, then try again.', 7000); try { pc.close(); } catch (_) { /* noop */ } stopVoice(); return; }
			mic.getTracks().forEach(function (t) { pc.addTrack(t, mic); });
			pc.createDataChannel('oai-events');
			var offer = await pc.createOffer(); await pc.setLocalDescription(offer);
			var ans = await fetch('https://api.openai.com/v1/realtime?model=' + encodeURIComponent(s.model || 'gpt-4o-realtime-preview'), {
				method: 'POST', body: offer.sdp, headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/sdp' },
			});
			if (!ans.ok) { toast('Voice connection was refused — try again in a moment.', 5000); try { pc.close(); } catch (e) { /* noop */ } mic.getTracks().forEach(function (t) { t.stop(); }); stopVoice(); return; }
			await pc.setRemoteDescription({ type: 'answer', sdp: await ans.text() });
			rtc = { pc: pc, mic: mic };
			var orb = orbEl(); if (orb) { orb.realtime = true; orb.onvoiceend = stopVoice; } // flip to LISTENING now that we're live
			toast('Listening — just talk. Tap the orb to end.', 2800);
		} catch (e) { toast('Voice couldn’t start. ' + (e && e.message ? e.message : ''), 5000); stopVoice(); }
	}

	// ── native-window sizing ────────────────────────────────────────────────────────────────
	function setMode(min) {
		minimized = min;
		resizeWindow(min ? puckSize() : fullSize(), min ? puckSize() : fullSize());
	}

	// ── mount ──────────────────────────────────────────────────────────────────────────────
	function mount() {
		if (!customElements.get('chi-orb')) return setTimeout(mount, 60);
		var orb = document.createElement('chi-orb');
		orb.setAttribute('theme', 'dark');                 // the orb persists the user's theme pick itself
		orb.setAttribute('asset-base', '/omnis-widgets/enso-assets/');
		orb.setAttribute('realtime-available', '1');       // THIS is the desktop app's Chi window → realtime lives here
		orb.setAttribute('window-controls', '1');          // grip = the one drag handle; adds close/frame ring controls
		orb.onvoicestart = startVoice;
		orb.onvoiceend = stopVoice;
		orb.ask = ask;
		orb.actions = [
			{ label: 'Summarize my day', command: 'Catch me up — what needs my attention?' },
			{ label: 'Any mentions?', command: 'Do I have any mentions or unread messages?' },
			{ label: 'Draft a standup update', command: 'Draft a standup update from my recent activity' },
		];
		b.appendChild(orb);

		// Relay the orb's control events to the native window.
		orb.addEventListener('chi-drag', function (e) { moveWindow(e.detail.dx, e.detail.dy); });
		orb.addEventListener('chi-min', function (e) { setMode(!!(e.detail && e.detail.min)); });
		orb.addEventListener('chi-resize', function () { if (!minimized) resizeWindow(fullSize(), fullSize()); });
		orb.addEventListener('chi-close', function () { if (bridge.closeChiWindow) bridge.closeChiWindow(); });
		orb.addEventListener('chi-frame', function () { setFrame(!frameShown); });

		setMode(minimized); // size the window to the orb's current state on open
	}
	mount();
})();
