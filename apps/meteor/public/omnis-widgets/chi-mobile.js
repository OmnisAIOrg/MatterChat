/*
 * chi-mobile.js — the phone-native Chi surface ("C into B").
 *
 * This is the mobile counterpart to chi-window.js (the desktop popout). It is a SEPARATE file on
 * purpose: the desktop realtime path in chi-window.js is proven and must never be disturbed, so the
 * realtime session core here (ask / startVoice / stopVoice / wireDataChannel / rtState / continueTurn /
 * sendUserTurn / runConfirm) is a faithful COPY of that file's logic — same OpenAI Realtime-over-WebRTC
 * flow, same server-minted ephemeral ek_ token from /v1/chi.realtime-session, same data-channel
 * tool-loop (do_it → the member-scoped chi.ask turn, suggest_actions → chips). Only the four UI
 * touch-points differ: captions, chips, listening state, and navigate actions drive a phone layout /
 * the React Native bridge instead of the <chi-orb> dial + the Electron desktop bridge.
 *
 * Two states, per the approved design:
 *   C — a half-sheet docked over the chat list: grab handle, ensō, Chi's last reply, action chips,
 *       and an "Ask Chi anything…" input with a mic. Glanceable, keeps context.
 *   B — full-screen voice-first (Siri/ChatGPT style): a big breathing ensō, LISTENING…, live
 *       captions, chips, one big mic. Swipe up from C (or tap the mic) expands into it; swipe down
 *       collapses back.
 *
 * Auth: same-origin. The host WebView (ChiOrbView) injects Meteor.loginToken / Meteor.userId into
 * localStorage before load, exactly like the desktop window, so every REST call runs as the member.
 * Keys never touch the browser — the realtime token is minted server-side with the server-held key.
 */
(function () {
	'use strict';
	var API = '/api/v1/chi.ask';
	var RT_API = '/api/v1/chi.realtime-session';
	var ENSO = '/omnis-widgets/enso-assets/omnis-enso-bristle.svg';
	var RN = window.ReactNativeWebView || null; // present when hosted in the mobile app's WebView
	var DEFAULT_ACTIONS = [
		{ label: 'Summarize my day', command: 'Catch me up — what needs my attention?' },
		{ label: 'Any mentions?', command: 'Do I have any mentions or unread messages?' },
		{ label: 'Draft a standup update', command: 'Draft a standup update from my recent activity' },
	];
	var bridge = {}; // no desktop bridge on mobile; realtime code below tolerates its absence

	function authHeaders() {
		var token = localStorage.getItem('Meteor.loginToken');
		var uid = localStorage.getItem('Meteor.userId');
		var h = { 'Content-Type': 'application/json' };
		if (token) h['X-Auth-Token'] = token;
		if (uid) h['X-User-Id'] = uid;
		return h;
	}

	// Navigate actions from the brain (open a room/DM) → hand to native navigation via postMessage.
	// ChiOrbView.onMessage routes { type:'chi:navigate', rid, t, name } to RoomView.
	function postNative(obj) { try { if (RN) RN.postMessage(JSON.stringify(obj)); } catch (e) { /* noop */ } }
	function runActions(actions) {
		if (!Array.isArray(actions)) return;
		actions.forEach(function (a) {
			if (a && a.type === 'navigate' && a.rid) postNative({ type: 'chi:navigate', rid: a.rid, t: a.t || 'c', name: a.name });
		});
	}

	// ── Chi text turn (identical contract to the desktop window) ────────────────────────────────
	function ask(text, history) {
		return fetch(API, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text: text, history: history }) })
			.then(function (res) { return res.json().then(function (d) {
				if (!res.ok || d.success === false) return { reply: (d && d.error) || "I couldn't reach Chi just now.", needsConfirm: false };
				runActions(d.actions); return { reply: d.reply || '…', needsConfirm: !!d.needsConfirm };
			}); })
			.catch(function () { return { reply: "I couldn't reach Chi just now — check your connection.", needsConfirm: false }; });
	}

	// ════════════════════════════════════════════════════════════════════════════════════════════
	// Realtime voice — faithful copy of chi-window.js's session core. UI hooks (caption/chips/state)
	// are indirected through the mobile UI object `M` defined further below.
	// ════════════════════════════════════════════════════════════════════════════════════════════
	var rtc = null;
	var starting = false;
	var rtState = { responseActive: false, pendingContinue: false, callNames: null, outstanding: 0 };
	function dcSend(dc, obj) { try { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj)); } catch (e) { /* noop */ } }
	function continueTurn(dc) {
		if (!rtc || rtc.dc !== dc || rtState.outstanding > 0) return;
		if (rtState.responseActive) rtState.pendingContinue = true; else dcSend(dc, { type: 'response.create' });
	}
	function sendUserTurn(text) {
		var t = String(text || '').trim(); if (!t || !rtc || !rtc.dc) return;
		dcSend(rtc.dc, { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: t }] } });
		if (rtState.responseActive) rtState.pendingContinue = true; else dcSend(rtc.dc, { type: 'response.create' });
	}
	function runConfirm(token) {
		ask(token, []).then(function (r) {
			var text = (r && r.reply) || (token === 'confirm' ? 'Done.' : 'Cancelled.');
			M.setChips(DEFAULT_ACTIONS);
			if (rtc && rtc.dc) {
				dcSend(rtc.dc, { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'I tapped ' + (token === 'confirm' ? 'Confirm' : 'Cancel') + '. Result: ' + String(text).slice(0, 500) + '. Tell me briefly what happened.' }] } });
				if (rtState.responseActive) rtState.pendingContinue = true; else dcSend(rtc.dc, { type: 'response.create' });
			}
		});
	}
	function wireDataChannel(dc) {
		dc.addEventListener('message', function (evt) {
			if (!rtc || rtc.dc !== dc) return;
			var e; try { e = JSON.parse(evt.data); } catch (_) { return; }
			switch (e.type) {
				case 'conversation.item.input_audio_transcription.completed':
					if (e.transcript) M.caption('me', e.transcript); break;
				case 'response.output_audio_transcript.done':
					if (e.transcript) M.caption('chi', e.transcript); break;
				case 'response.created': rtState.responseActive = true; M.setStatus('thinking'); break;
				case 'response.done': {
					rtState.responseActive = false;
					var st = (e.response && e.response.status) || 'completed';
					M.setStatus('listening');
					if (st === 'cancelled') { rtState.pendingContinue = false; break; }
					if (rtState.pendingContinue) { rtState.pendingContinue = false; continueTurn(dc); }
					break;
				}
				case 'response.output_item.added':
					if (e.item && e.item.type === 'function_call' && e.item.call_id) { if (e.item.name) rtState.callNames.set(e.item.call_id, e.item.name); rtState.outstanding++; }
					break;
				case 'response.output_item.done':
					if (e.item && e.item.type === 'function_call' && e.item.call_id && e.item.name) rtState.callNames.set(e.item.call_id, e.item.name);
					break;
				case 'response.function_call_arguments.done': {
					var name = e.name || (rtState.callNames && rtState.callNames.get(e.call_id || '')) || 'do_it';
					var args = {}; try { args = JSON.parse(e.arguments || '{}'); } catch (_) { /* noop */ }
					var reply = function (output) {
						if (!rtc || rtc.dc !== dc) return;
						dcSend(dc, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: e.call_id, output: output } });
						if (rtState.outstanding > 0) rtState.outstanding--;
						continueTurn(dc);
						setTimeout(function () { if (rtc && rtc.dc === dc && !rtState.responseActive && rtState.pendingContinue) { rtState.pendingContinue = false; dcSend(dc, { type: 'response.create' }); } }, 6000);
					};
					if (name === 'suggest_actions') {
						var acts = Array.isArray(args.actions) ? args.actions.filter(function (a) { return a && typeof a.label === 'string' && typeof a.command === 'string'; }).slice(0, 3) : [];
						if (acts.length) M.setChips(acts);
						reply('{"ok":true}'); break;
					}
					var request = String(args.request || args.text || '').trim();
					if (!request) { reply('{"ok":false,"error":"empty request"}'); break; }
					void (function () {
						ask(request, []).then(function (r) {
							if (r && r.needsConfirm) M.setChips([{ label: 'Confirm', command: 'confirm' }, { label: 'Cancel', command: 'cancel' }]);
							reply(JSON.stringify({ ok: true, result: String((r && r.reply) || '').slice(0, 1500), needsConfirm: !!(r && r.needsConfirm) }));
						}).catch(function (err) { reply(JSON.stringify({ ok: false, error: (err && err.message) || 'failed' })); });
					})();
					break;
				}
				case 'error':
					if (e.error && e.error.code === 'conversation_already_has_active_response') { rtState.pendingContinue = true; }
					else if (e.error && e.error.message) { M.toast('Voice: ' + e.error.message); }
					break;
				default: break;
			}
		});
	}
	function stopVoice() {
		if (rtc) { try { rtc.pc.close(); } catch (e) { /* noop */ } try { rtc.mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* noop */ } rtc = null; }
		M.setListening(false);
	}
	async function startVoice() {
		if (rtc || starting) return;
		starting = true;
		try {
			M.setStatus('connecting');
			var s = await fetch(RT_API, { method: 'POST', headers: authHeaders(), body: '{}' }).then(function (r) { return r.json(); }).catch(function () { return null; });
			if (!s || !s.token) {
				M.toast((s && s.error) || 'Realtime voice isn’t set up yet — an admin can enable it in Admin → Chi Assistant.');
				stopVoice(); return;
			}
			// Desktop needs an explicit TCC mic grant via the bridge; mobile WKWebView is granted at the
			// native layer (mediaCapturePermissionGrantType='grant'), so bridge.micAsk is simply absent here.
			try {
				if (bridge.micAsk) { var g = await bridge.micAsk(); if (g && g.microphone === false) { M.toast('Microphone is blocked — allow it in Settings, then try again.'); stopVoice(); return; } }
			} catch (e) { /* fall through to getUserMedia */ }
			var pc = new RTCPeerConnection();
			var audio = new Audio(); audio.autoplay = true;
			pc.addEventListener('track', function (e) { audio.srcObject = e.streams[0]; });
			pc.addEventListener('connectionstatechange', function () {
				if (!rtc || rtc.pc !== pc) return;
				if (pc.connectionState === 'failed') { M.toast('Voice connection lost — tap the mic to reconnect.'); stopVoice(); }
			});
			var mic;
			try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
			catch (e) { M.toast('Microphone is blocked — allow it in Settings, then try again.'); try { pc.close(); } catch (_) { /* noop */ } stopVoice(); return; }
			mic.getTracks().forEach(function (t) { pc.addTrack(t, mic); });
			rtState = { responseActive: false, pendingContinue: false, callNames: new Map(), outstanding: 0 };
			var dc = pc.createDataChannel('oai-events');
			wireDataChannel(dc);
			var offer = await pc.createOffer(); await pc.setLocalDescription(offer);
			var ans = await fetch('https://api.openai.com/v1/realtime/calls?model=' + encodeURIComponent(s.model || 'gpt-realtime'), {
				method: 'POST', body: offer.sdp, headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/sdp' },
			});
			if (!ans.ok) { M.toast('Voice connection was refused — try again in a moment.'); try { pc.close(); } catch (e) { /* noop */ } mic.getTracks().forEach(function (t) { t.stop(); }); stopVoice(); return; }
			await pc.setRemoteDescription({ type: 'answer', sdp: await ans.text() });
			rtc = { pc: pc, mic: mic, dc: dc };
			M.setListening(true);
		} catch (e) { M.toast('Voice couldn’t start. ' + (e && e.message ? e.message : '')); stopVoice(); }
		finally { starting = false; }
	}

	// ════════════════════════════════════════════════════════════════════════════════════════════
	// Mobile UI (the B/C shell). `M` is the object the realtime core calls into.
	// ════════════════════════════════════════════════════════════════════════════════════════════
	var M = (function () {
		var els = {};
		var mode = 'sheet';   // 'sheet' (C) | 'voice' (B)
		var listening = false;

		function css(el, s) { el.style.cssText = s; return el; }
		function make(tag, s, parent) { var el = document.createElement(tag); if (s) el.style.cssText = s; if (parent) parent.appendChild(el); return el; }

		function build() {
			var root = document.body;
			css(root, "margin:0;height:100vh;overflow:hidden;background:#0d1014;color:#eef2f7;" +
				"font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;-webkit-user-select:none;user-select:none;");

			// ── faint chat context behind the sheet (C keeps you oriented) ───────────────────────
			var ctx = make('div', 'position:fixed;top:0;left:0;right:0;padding:calc(env(safe-area-inset-top) + 14px) 16px 0;opacity:.4;font-size:12.5px;line-height:2.3;transition:opacity .4s;pointer-events:none;', root);
			ctx.innerHTML = '<div style="font-weight:800;letter-spacing:.5px;opacity:.8;margin-bottom:4px">Chats</div>';
			els.ctx = ctx;

			// tap the dimmed area above the sheet → dismiss Chi (native pops the screen)
			var scrim = make('div', 'position:fixed;inset:0;background:transparent;', root);
			scrim.addEventListener('click', function () { if (mode === 'sheet') postNative({ type: 'chi:close' }); });
			els.scrim = scrim;

			// ── the morphing surface: sheet (C) ⇄ voice (B) ──────────────────────────────────────
			var surf = make('div', 'position:fixed;left:0;right:0;bottom:0;top:38%;border-radius:26px 26px 0 0;' +
				'background:radial-gradient(140% 100% at 50% 0%,#171c23,#0a0c10 72%);border-top:1px solid rgba(255,255,255,.12);' +
				'box-shadow:0 -18px 60px rgba(0,0,0,.55);transition:top .42s cubic-bezier(.4,0,.2,1),border-radius .42s,background .5s;' +
				'display:flex;flex-direction:column;align-items:center;overflow:hidden;touch-action:none;', root);
			els.surf = surf;

			// grab handle
			var grip = make('div', 'width:100%;display:flex;justify-content:center;padding:11px 0 4px;cursor:grab;flex:none;', surf);
			make('div', 'width:38px;height:5px;border-radius:3px;background:rgba(255,255,255,.28);', grip);
			els.grip = grip;

			// ── ensō + halo (grows in voice mode) ────────────────────────────────────────────────
			var stage = make('div', 'position:relative;flex:none;display:flex;align-items:center;justify-content:center;transition:height .42s,margin .42s;height:96px;margin-top:6px;', surf);
			var halo = make('div', 'position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(90,160,255,.30),transparent 66%);opacity:0;transition:opacity .5s,width .42s,height .42s;width:150px;height:150px;', stage);
			var enso = make('img', 'position:relative;width:58px;height:50px;object-fit:contain;transition:width .42s,height .42s;', stage);
			enso.src = ENSO; enso.alt = 'Chi';
			els.stage = stage; els.halo = halo; els.enso = enso;

			// label / status
			var label = make('div', 'flex:none;font-size:10px;font-weight:800;letter-spacing:2.4px;color:#8fb6e6;margin-top:4px;height:14px;', surf);
			label.textContent = 'CHI';
			els.label = label;

			// ── captions / reply body ────────────────────────────────────────────────────────────
			var body = make('div', 'flex:1 1 auto;width:100%;max-width:520px;padding:14px 26px 0;overflow-y:auto;text-align:center;-webkit-overflow-scrolling:touch;', surf);
			var capMe = make('div', 'font-size:13px;line-height:1.6;opacity:.55;margin-bottom:8px;min-height:0;', body);
			var capChi = make('div', 'font-size:15px;line-height:1.62;color:#eef2f7;', body);
			capChi.textContent = 'Hi — I’m Chi. Ask me anything, or tap the mic to talk.';
			els.body = body; els.capMe = capMe; els.capChi = capChi;

			// ── chips ─────────────────────────────────────────────────────────────────────────────
			var chips = make('div', 'flex:none;display:flex;flex-wrap:wrap;gap:7px;justify-content:center;padding:12px 20px 4px;transition:margin-bottom .42s;', surf);
			els.chips = chips;

			// ── input row (C) — collapses away in voice mode (height + opacity) ─────────────────────
			var inputRow = make('div', 'flex:none;width:100%;box-sizing:border-box;display:flex;align-items:center;gap:9px;overflow:hidden;max-height:120px;' +
				'padding:10px 16px calc(env(safe-area-inset-bottom) + 14px);transition:opacity .3s,transform .3s,max-height .42s,padding .42s;', surf);
			var field = make('div', 'flex:1;display:flex;align-items:center;height:44px;border-radius:22px;background:rgba(255,255,255,.07);' +
				'border:1px solid rgba(255,255,255,.14);padding:0 14px;', inputRow);
			var input = make('input', 'flex:1;background:transparent;border:0;outline:none;color:#eef2f7;font-size:15px;', field);
			input.placeholder = 'Ask Chi anything…'; input.type = 'text';
			input.setAttribute('enterkeyhint', 'send'); input.autocapitalize = 'sentences';
			var micSm = make('button', 'flex:none;width:44px;height:44px;border-radius:50%;border:0;background:rgba(48,209,88,.92);' +
				'color:#fff;font-size:19px;display:flex;align-items:center;justify-content:center;', inputRow);
			micSm.innerHTML = micSvg('#fff');
			els.inputRow = inputRow; els.input = input; els.micSm = micSm;

			// ── big mic (B) — the one voice control ─────────────────────────────────────────────────
			var micBig = make('button', 'position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom) + 26px);transform:translateX(-50%) scale(.6);' +
				'width:70px;height:70px;border-radius:50%;border:0;background:rgba(48,209,88,.94);color:#fff;' +
				'box-shadow:0 10px 30px rgba(48,209,88,.4);display:flex;align-items:center;justify-content:center;' +
				'opacity:0;pointer-events:none;transition:opacity .35s,transform .42s,background .3s;z-index:4;', surf);
			micBig.innerHTML = micSvg('#fff', 26);
			els.micBig = micBig;

			// down-chevron to collapse voice → sheet
			var down = make('button', 'position:absolute;top:calc(env(safe-area-inset-top) + 10px);left:50%;transform:translateX(-50%);' +
				'width:40px;height:26px;border:0;background:transparent;color:rgba(255,255,255,.5);opacity:0;pointer-events:none;transition:opacity .35s;z-index:4;', surf);
			down.innerHTML = '<svg width="22" height="12" viewBox="0 0 22 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 3l9 7 9-7"/></svg>';
			els.down = down;

			// ── toast ────────────────────────────────────────────────────────────────────────────
			var toastEl = make('div', 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 90px);transform:translateX(-50%);' +
				'max-width:84%;padding:10px 16px;border-radius:14px;font-size:13px;line-height:1.45;text-align:center;' +
				'background:rgba(18,22,27,.95);border:1px solid rgba(255,255,255,.16);opacity:0;transition:opacity .3s;pointer-events:none;z-index:20;', root);
			els.toast = toastEl;

			wireGestures();
			wireInput();
			setChips(DEFAULT_ACTIONS);
		}

		function micSvg(color, size) {
			var s = size || 18;
			return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
				'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
		}

		// ── mode transition ──────────────────────────────────────────────────────────────────────
		function setMode(next) {
			if (next === mode) return;
			mode = next;
			var voice = mode === 'voice';
			els.surf.style.top = voice ? '0' : '38%';
			els.surf.style.borderRadius = voice ? '0' : '26px 26px 0 0';
			els.surf.style.background = voice ? 'radial-gradient(90% 60% at 50% 26%,#10151c,#05070a)' : 'radial-gradient(140% 100% at 50% 0%,#171c23,#0a0c10 72%)';
			els.ctx.style.opacity = voice ? '0' : '.4';
			els.stage.style.height = voice ? '170px' : '96px';
			els.stage.style.marginTop = voice ? 'calc(env(safe-area-inset-top) + 70px)' : '6px';
			els.enso.style.width = voice ? '128px' : '58px';
			els.enso.style.height = voice ? '112px' : '50px';
			els.halo.style.opacity = voice ? '1' : '0';
			els.halo.style.width = els.halo.style.height = voice ? '200px' : '150px';
			els.grip.style.opacity = voice ? '0' : '1';
			els.inputRow.style.opacity = voice ? '0' : '1';
			els.inputRow.style.transform = voice ? 'translateY(30px)' : 'none';
			els.inputRow.style.pointerEvents = voice ? 'none' : 'auto';
			els.inputRow.style.maxHeight = voice ? '0' : '120px';
			els.inputRow.style.paddingTop = voice ? '0' : '10px';
			els.inputRow.style.paddingBottom = voice ? '0' : 'calc(env(safe-area-inset-bottom) + 14px)';
			els.chips.style.marginBottom = voice ? 'calc(env(safe-area-inset-bottom) + 104px)' : '0';
			els.micBig.style.opacity = voice ? '1' : '0';
			els.micBig.style.transform = 'translateX(-50%) ' + (voice ? 'scale(1)' : 'scale(.6)');
			els.micBig.style.pointerEvents = voice ? 'auto' : 'none';
			els.down.style.opacity = voice ? '1' : '0';
			els.down.style.pointerEvents = voice ? 'auto' : 'none';
			setStatus(voice ? (listening ? 'listening' : 'idle') : 'chi');
			if (!voice && rtc) stopVoice(); // collapsing ends the voice session
		}

		// ── gestures: drag the sheet up → voice, down → collapse/dismiss ───────────────────────────
		function wireGestures() {
			var start = null;
			function onDown(e) { start = { y: (e.touches ? e.touches[0].clientY : e.clientY), mode: mode }; }
			function onMove(e) {
				if (!start) return;
				var y = e.touches ? e.touches[0].clientY : e.clientY;
				var dy = y - start.y;
				if (start.mode === 'sheet' && dy < -60) { setMode('voice'); start = null; }
				else if (start.mode === 'voice' && dy > 70) { setMode('sheet'); start = null; }
			}
			function onUp() { start = null; }
			[els.grip, els.stage].forEach(function (h) {
				h.addEventListener('touchstart', onDown, { passive: true });
				h.addEventListener('touchmove', onMove, { passive: true });
				h.addEventListener('touchend', onUp);
				h.addEventListener('mousedown', onDown); h.addEventListener('mousemove', onMove); h.addEventListener('mouseup', onUp);
			});
			els.down.addEventListener('click', function () { setMode('sheet'); });
			// big mic toggles the live session
			els.micBig.addEventListener('click', function () { if (rtc) stopVoice(); else startVoice(); });
			// small mic (C) → expand to voice and start talking
			els.micSm.addEventListener('click', function () { setMode('voice'); startVoice(); });
		}

		function wireInput() {
			function submit() {
				var t = String(els.input.value || '').trim(); if (!t) return;
				els.input.value = '';
				caption('me', t);
				if (rtc) { sendUserTurn(t); return; } // live voice → speak it into the same session
				setStatus('thinking'); els.capChi.textContent = '…';
				ask(t, []).then(function (r) { setStatus('chi'); caption('chi', (r && r.reply) || '…'); if (r && r.needsConfirm) setChips([{ label: 'Confirm', command: 'confirm' }, { label: 'Cancel', command: 'cancel' }]); });
			}
			els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
		}

		function onChip(cmd) {
			if (cmd === 'confirm' || cmd === 'cancel') { runConfirm(cmd); return; }
			if (rtc) { sendUserTurn(cmd); return; }
			caption('me', cmd); setStatus('thinking'); els.capChi.textContent = '…';
			ask(cmd, []).then(function (r) { setStatus('chi'); caption('chi', (r && r.reply) || '…'); if (r && r.needsConfirm) setChips([{ label: 'Confirm', command: 'confirm' }, { label: 'Cancel', command: 'cancel' }]); });
		}

		// ── the interface the realtime core drives ─────────────────────────────────────────────────
		function caption(who, text) {
			if (!text) return;
			if (who === 'me') { els.capMe.textContent = '“' + text + '”'; }
			else { els.capChi.textContent = text; }
			els.body.scrollTop = els.body.scrollHeight;
		}
		function setChips(actions) {
			els.chips.innerHTML = '';
			(actions || []).slice(0, 4).forEach(function (a) {
				if (!a || !a.label) return;
				var chip = make('button', 'padding:8px 14px;border-radius:15px;font-size:12.5px;font-weight:600;border:1px solid rgba(255,255,255,.16);' +
					'background:' + (a.command === 'confirm' ? 'rgba(48,209,88,.9)' : 'rgba(255,255,255,.08)') + ';color:#eef2f7;', els.chips);
				chip.textContent = a.label;
				chip.addEventListener('click', function () { onChip(a.command || a.label); });
			});
		}
		function setListening(on) {
			listening = on;
			els.micBig.style.background = on ? 'rgba(255,69,58,.94)' : 'rgba(48,209,88,.94)';
			els.micBig.style.boxShadow = on ? '0 0 0 0 rgba(255,69,58,.5)' : '0 10px 30px rgba(48,209,88,.4)';
			els.micBig.classList.toggle('chi-live', on);
			els.enso.classList.toggle('chi-breathe', on);
			setStatus(on ? 'listening' : (mode === 'voice' ? 'idle' : 'chi'));
		}
		function setStatus(kind) {
			var map = { chi: 'CHI', idle: 'TAP TO SPEAK', connecting: 'CONNECTING…', listening: 'LISTENING…', thinking: 'THINKING…' };
			els.label.textContent = map[kind] || 'CHI';
			els.label.style.color = kind === 'listening' ? '#3b9bff' : (kind === 'thinking' ? '#8fb6e6' : '#8fb6e6');
			els.label.classList.toggle('chi-pulse', kind === 'listening' || kind === 'connecting');
		}
		function toast(msg) { els.toast.textContent = msg; els.toast.style.opacity = '1'; clearTimeout(toast._t); toast._t = setTimeout(function () { els.toast.style.opacity = '0'; }, 4200); }

		return { build: build, caption: caption, setChips: setChips, setListening: setListening, setStatus: setStatus, toast: toast, get mode() { return mode; } };
	})();

	// keyframes (CSP allows a stylesheet element; no inline handlers)
	var style = document.createElement('style');
	style.textContent =
		'@keyframes chiBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}' +
		'.chi-breathe{animation:chiBreathe 2.4s ease-in-out infinite}' +
		'@keyframes chiPulse{0%,100%{opacity:1}50%{opacity:.45}}' +
		'.chi-pulse{animation:chiPulse 1.6s ease-in-out infinite}' +
		'@keyframes chiLive{0%{box-shadow:0 0 0 0 rgba(255,69,58,.5)}70%{box-shadow:0 0 0 18px rgba(255,69,58,0)}100%{box-shadow:0 0 0 0 rgba(255,69,58,0)}}' +
		'.chi-live{animation:chiLive 1.8s ease-out infinite}' +
		'*{-webkit-tap-highlight-color:transparent}';
	document.head.appendChild(style);

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', M.build); else M.build();
})();
