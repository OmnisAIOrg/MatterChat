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
	var DEFAULT_ACTIONS = [
		{ label: 'Summarize my day', command: 'Catch me up — what needs my attention?' },
		{ label: 'Any mentions?', command: 'Do I have any mentions or unread messages?' },
		{ label: 'Draft a standup update', command: 'Draft a standup update from my recent activity' },
	];

	// Advertise this popped-out window's existence to the MAIN app window. Both share the same origin +
	// Electron partition → shared localStorage, so the in-app orb reads this flag and hides itself instead
	// of mounting a DUPLICATE orb after a reload / workspace switch / refocus while Chi is popped out.
	try { localStorage.setItem('chi-popped', '1'); } catch (e) { /* noop */ }
	['pagehide', 'beforeunload', 'unload'].forEach(function (evt) {
		window.addEventListener(evt, function () { try { localStorage.removeItem('chi-popped'); } catch (e) { /* noop */ } });
	});

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
				if (!res.ok || d.success === false) return { reply: (d && d.error) || "I couldn't reach Chi just now.", needsConfirm: false };
				runActions(d.actions); return { reply: d.reply || '…', needsConfirm: !!d.needsConfirm };
			}); })
			.catch(function () { return { reply: "I couldn't reach Chi just now — check your connection.", needsConfirm: false }; });
	}

	// ── Realtime voice (OpenAI Realtime over WebRTC) ───────────────────────────────────────────
	var rtc = null;
	var starting = false; // a connect is in flight (~2s). A 2nd tap during it must NOT open a 2nd session
	                      // (EH lesson: two sessions = two voices answering at once).
	function orbEl() { return document.querySelector('chi-orb'); }

	// Tool-calling over the data channel (mirrors EvidenceHunt's proven GA loop). The voice model has
	// two tools (declared server-side at mint): do_it(request) and suggest_actions(actions). do_it
	// routes ANY actionable request through the SAME chi.ask turn the typed orb uses — so navigation,
	// summaries, user management, settings and the confirm/park flow all run with the member's own
	// permissions, and we speak the result back. suggest_actions fills the tappable chips.
	// `outstanding` = tool calls whose result hasn't been sent yet; the response only continues once ALL
	// are back (a do_it + suggest_actions emitted together must not let the model speak before do_it's
	// server turn resolves). Reset per session; every handler guards `rtc.dc === dc` so a dying channel's
	// late events/replies can't corrupt the next session's state.
	var rtState = { responseActive: false, pendingContinue: false, callNames: null, outstanding: 0 };
	function dcSend(dc, obj) { try { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj)); } catch (e) { /* noop */ } }
	// Continue the model's turn once tool results are in — deferred if a response is still active (issuing
	// response.create then is an API error); the response.done handler + a per-reply watchdog re-fire it.
	function continueTurn(dc) {
		if (!rtc || rtc.dc !== dc || rtState.outstanding > 0) return;
		if (rtState.responseActive) rtState.pendingContinue = true; else dcSend(dc, { type: 'response.create' });
	}
	// Inject a typed/tapped request into the LIVE voice conversation (same brain as speech — never forks
	// to a second model). Guarded like a tool continuation so tapping a chip WHILE Chi is speaking doesn't
	// fire an unguarded response.create (→ active-response error → dead chip).
	function sendUserTurn(text) {
		var t = String(text || '').trim(); if (!t || !rtc || !rtc.dc) return;
		dcSend(rtc.dc, { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: t }] } });
		if (rtState.responseActive) rtState.pendingContinue = true; else dcSend(rtc.dc, { type: 'response.create' });
	}
	// Tapping the realtime Confirm/Cancel chip resumes the parked action DETERMINISTICALLY (server-side,
	// via the same confirm token the chat button uses) — NOT by hoping the voice model re-calls do_it,
	// which is what left it frozen. The action always runs; then we hand the outcome to the model to speak.
	function runConfirm(token) {
		var o = orbEl();
		ask(token, []).then(function (r) {
			var text = (r && r.reply) || (token === 'confirm' ? 'Done.' : 'Cancelled.');
			if (o && o.updateActions) o.updateActions(DEFAULT_ACTIONS); // swap the Confirm/Cancel chips back
			if (rtc && rtc.dc) {
				dcSend(rtc.dc, { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'I tapped ' + (token === 'confirm' ? 'Confirm' : 'Cancel') + '. Result: ' + String(text).slice(0, 500) + '. Tell me briefly what happened.' }] } });
				if (rtState.responseActive) rtState.pendingContinue = true; else dcSend(rtc.dc, { type: 'response.create' });
			}
		});
	}
	function wireDataChannel(dc) {
		dc.addEventListener('message', function (evt) {
			if (!rtc || rtc.dc !== dc) return; // ignore a superseded channel's late events
			var e; try { e = JSON.parse(evt.data); } catch (_) { return; }
			switch (e.type) {
				// Live captions — feed the transcripts the session already emits to the orb's caption
				// ribbon (blue = the member, green = Chi). Purely visual; no session behavior changes.
				case 'conversation.item.input_audio_transcription.completed': {
					var oCap = orbEl(); if (oCap && oCap.caption && e.transcript) oCap.caption('me', e.transcript);
					break;
				}
				case 'response.output_audio_transcript.done': {
					var oCap2 = orbEl(); if (oCap2 && oCap2.caption && e.transcript) oCap2.caption('chi', e.transcript);
					break;
				}
				case 'response.created': rtState.responseActive = true; break;
				case 'response.done': {
					rtState.responseActive = false;
					var st = (e.response && e.response.status) || 'completed';
					if (st === 'cancelled') { rtState.pendingContinue = false; break; } // user barged in
					if (rtState.pendingContinue) { rtState.pendingContinue = false; continueTurn(dc); }
					break;
				}
				// GA's function_call_arguments.done carries no name → build call_id→name from output_item.
				// Count each function_call once (on .added) so continueTurn waits for every sibling call.
				case 'response.output_item.added':
					if (e.item && e.item.type === 'function_call' && e.item.call_id) { if (e.item.name) rtState.callNames.set(e.item.call_id, e.item.name); rtState.outstanding++; }
					break;
				case 'response.output_item.done':
					if (e.item && e.item.type === 'function_call' && e.item.call_id && e.item.name) rtState.callNames.set(e.item.call_id, e.item.name);
					break;
				case 'response.function_call_arguments.done': {
					var name = e.name || (rtState.callNames && rtState.callNames.get(e.call_id || '')) || 'do_it';
					var args = {}; try { args = JSON.parse(e.arguments || '{}'); } catch (_) { /* noop */ }
					// Send the tool result, decrement the outstanding count, then continue when all are in.
					// A 6s watchdog re-fires a lost continuation so a dropped response never leaves dead air.
					var reply = function (output) {
						if (!rtc || rtc.dc !== dc) return;
						dcSend(dc, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: e.call_id, output: output } });
						if (rtState.outstanding > 0) rtState.outstanding--;
						continueTurn(dc);
						setTimeout(function () { if (rtc && rtc.dc === dc && !rtState.responseActive && rtState.pendingContinue) { rtState.pendingContinue = false; dcSend(dc, { type: 'response.create' }); } }, 6000);
					};
					if (name === 'suggest_actions') {
						var acts = Array.isArray(args.actions) ? args.actions.filter(function (a) { return a && typeof a.label === 'string' && typeof a.command === 'string'; }).slice(0, 3) : [];
						var orb = orbEl(); if (orb && acts.length && orb.updateActions) orb.updateActions(acts);
						reply('{"ok":true}'); break;
					}
					var request = String(args.request || args.text || '').trim();
					if (!request) { reply('{"ok":false,"error":"empty request"}'); break; }
					// do_it → the SAME chi.ask turn the typed orb uses (full permissions + navigation +
					// confirm/park). ask() always resolves to { reply, needsConfirm } (never rejects), so a result
					// is always sent back. On a parked destructive action, also surface tappable Confirm/Cancel chips.
					void (function () {
						ask(request, []).then(function (r) {
							if (r && r.needsConfirm) { var o = orbEl(); if (o && o.updateActions) o.updateActions([{ label: 'Confirm', command: 'confirm' }, { label: 'Cancel', command: 'cancel' }]); }
							reply(JSON.stringify({ ok: true, result: String((r && r.reply) || '').slice(0, 1500), needsConfirm: !!(r && r.needsConfirm) }));
						}).catch(function (err) { reply(JSON.stringify({ ok: false, error: (err && err.message) || 'failed' })); });
					})();
					break;
				}
				// A tool result / injected turn that raced a VAD-created response is rejected — queue the
				// continuation so the in-flight response's `done` re-fires it (else the result is never spoken).
				case 'error':
					if (e.error && e.error.code === 'conversation_already_has_active_response') { rtState.pendingContinue = true; }
					else if (e.error && e.error.message) { toast('Voice: ' + e.error.message, 5000); }
					break;
				default: break;
			}
		});
	}
	function stopVoice() {
		if (rtc) { try { rtc.pc.close(); } catch (e) { /* noop */ } try { rtc.mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* noop */ } rtc = null; }
		var orb = orbEl(); if (orb) orb.realtime = false; // back to the chat version
	}
	async function startVoice() {
		if (rtc || starting) return; // already live, or a connect is in flight
		starting = true;
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
			// Surface a dropped connection instead of freezing silently (EH lesson).
			pc.addEventListener('connectionstatechange', function () {
				if (!rtc || rtc.pc !== pc) return; // only the live session
				if (pc.connectionState === 'failed') { toast('Voice connection lost — tap the mic to reconnect.', 6000); stopVoice(); }
			});
			var mic;
			try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
			catch (e) { toast('Microphone is blocked — allow it in System Settings → Privacy & Security → Microphone, then try again.', 7000); try { pc.close(); } catch (_) { /* noop */ } stopVoice(); return; }
			mic.getTracks().forEach(function (t) { pc.addTrack(t, mic); });
			rtState = { responseActive: false, pendingContinue: false, callNames: new Map(), outstanding: 0 };
			var dc = pc.createDataChannel('oai-events');
			wireDataChannel(dc);
			var offer = await pc.createOffer(); await pc.setLocalDescription(offer);
			// GA WebRTC endpoint (/v1/realtime/calls) — the old /v1/realtime?model=… was the removed beta
			// flow. Bearer = the ephemeral ek_ secret minted server-side; response text is the SDP answer.
			var ans = await fetch('https://api.openai.com/v1/realtime/calls?model=' + encodeURIComponent(s.model || 'gpt-realtime'), {
				method: 'POST', body: offer.sdp, headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/sdp' },
			});
			if (!ans.ok) { toast('Voice connection was refused — try again in a moment.', 5000); try { pc.close(); } catch (e) { /* noop */ } mic.getTracks().forEach(function (t) { t.stop(); }); stopVoice(); return; }
			await pc.setRemoteDescription({ type: 'answer', sdp: await ans.text() });
			rtc = { pc: pc, mic: mic, dc: dc };
			var orb = orbEl(); if (orb) { orb.realtime = true; orb.onvoiceend = stopVoice; } // flip to LISTENING now that we're live
			toast('Listening — just talk. Tap the orb to end.', 2800);
		} catch (e) { toast('Voice couldn’t start. ' + (e && e.message ? e.message : ''), 5000); stopVoice(); }
		finally { starting = false; }
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
		// While realtime is live, tapping an action chip speaks that request INTO the voice conversation
		// (same brain). Confirm/Cancel are special-cased to the deterministic park-resume so they never freeze.
		orb.onaction = function (cmd) { if (cmd === 'confirm' || cmd === 'cancel') { runConfirm(cmd); } else { sendUserTurn(cmd); } };
		orb.ask = ask;
		orb.actions = DEFAULT_ACTIONS;
		b.appendChild(orb);

		// Relay the orb's control events to the native window.
		orb.addEventListener('chi-drag', function (e) { moveWindow(e.detail.dx, e.detail.dy); });
		orb.addEventListener('chi-min', function (e) { setMode(!!(e.detail && e.detail.min)); });
		orb.addEventListener('chi-resize', function () { if (!minimized) resizeWindow(fullSize(), fullSize()); });
		orb.addEventListener('chi-close', function () { if (bridge.closeChiWindow) bridge.closeChiWindow(); });
		orb.addEventListener('chi-frame', function () { setFrame(!frameShown); });

		setMode(minimized); // size the window to the orb's current state on open

		// ── main-window bridge (shared localStorage; storage events fire cross-window) ──
		// IN:  chi-notif-relay — a routed notification card from the app window → show it here.
		// OUT: chi-reply-relay — a reply typed on a card here → the app window posts it (it has
		//      the live SDK session); we ALSO post directly over REST as a belt-and-suspenders
		//      (whichever lands first wins server-side idempotency by message id is not needed —
		//      only REST posts; the relay is the fallback when REST fails).
		window.addEventListener('storage', function (ev) {
			if (ev.key !== 'chi-notif-relay' || !ev.newValue) return;
			try {
				var relay = JSON.parse(ev.newValue);
				if (relay && relay.card && orb.notify) orb.notify(relay.card);
			} catch (e) { /* malformed relay — ignore */ }
		});
		orb.onreply = function (target, text) {
			var rid = target && target.data && target.data.rid;
			if (!rid) return Promise.reject(new Error('missing room'));
			return fetch('/api/v1/chat.postMessage', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ roomId: rid, text: text }) })
				.then(function (res) { return res.json(); })
				.then(function (d) {
					if (!d || d.success === false) {
						// REST refused → relay to the main window's live session as the fallback.
						try { localStorage.setItem('chi-reply-relay', JSON.stringify({ ts: Date.now(), rid: rid, text: text })); } catch (e) { /* noop */ }
						throw new Error('rest failed');
					}
				});
		};
		// Flow dictation finished here → the composer lives in the MAIN window; relay the text
		// (and copy it locally so it's never lost even if the app window is gone).
		orb.addEventListener('chi-flow-insert', function (ev) {
			var text = ev && ev.detail && ev.detail.text;
			if (!text) return;
			try { navigator.clipboard.writeText(text); } catch (e) { /* noop */ }
			try { localStorage.setItem('chi-flow-relay', JSON.stringify({ ts: Date.now(), text: text })); } catch (e) { /* noop */ }
			toast('Dropped into the app composer — and copied, just in case.', 3200);
		});
	}
	mount();
})();
