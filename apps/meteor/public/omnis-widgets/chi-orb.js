/* <chi-orb> — Chi AI assistant orb (Omnis AI)
 * A brushed-metal ring around a glass chat window; the ensō is Chi's signature and runs the
 * brand "ingest" ripple loop while Chi thinks or listens. Zero dependencies.
 *
 * TWO VERSIONS on one element:
 *   • CHAT   — bubbles + input (mic dictation + send) + action chips. GREEN halo while thinking.
 *   • LISTEN — realtime-voice takeover: big ensō, "LISTENING…", action chips, tap-anywhere-to-end
 *              (a chip does NOT end the call — only tapping elsewhere does). BLUE focus halo.
 *     Turned on by setting `orb.realtime = true` (the host flips it when the realtime call goes live).
 *
 * Controls on the ring: theme switch (dark ▸ light ▸ warm ▸ legal, persisted), +/− size, minimize,
 * and a top grip. Minimized = JUST the ensō with its looping animation + the realtime button
 * (transparent background, so a popped-out desktop window shows only the ensō).
 *
 * API (all optional):
 *   orb.ask = async (text, history[]) => reply · orb.actions = [{label,command}] · orb.realtime = bool
 *   orb.onvoicestart/onvoiceend/onvoice · orb.history = [{who,text}] (call orb._sync() after mutating)
 * Attributes: theme=…  asset-base=…  realtime-available="1"
 */
(function () {
	'use strict';

	var ACCENT = '#3b9bff'; // Chi blue — listening / focus
	var GREEN = '#30d158';  // thinking / live / send
	// State halos (ring-shaped radial glows) — restored: GREEN while thinking, BLUE while listening.
	var GHALO = 'radial-gradient(circle, rgba(48,209,88,0) 50%, rgba(48,209,88,.55) 66%, rgba(48,209,88,.95) 74%, rgba(48,209,88,.55) 82%, rgba(48,209,88,0) 94%)';
	var BHALO = 'radial-gradient(circle, rgba(59,155,255,0) 50%, rgba(59,155,255,.5) 66%, rgba(59,155,255,.92) 74%, rgba(59,155,255,.5) 82%, rgba(59,155,255,0) 94%)';
	var THEMES = {
		dark: {
			win: 'radial-gradient(125% 105% at 50% 0%, rgba(30,36,44,.96) 0%, rgba(11,14,18,.98) 72%)',
			winBorder: 'rgba(255,255,255,.14)', name: '#f2f3f5', dim: 'rgba(255,255,255,.42)',
			me: 'background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.30);color:#e9f7ee;',
			chi: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);color:#dfe3e8;',
			chip: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#e6e9ee;',
			input: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);', inputText: '#e8eaed',
			ctrl: 'background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.20);color:rgba(255,255,255,.85);',
			glow: 'rgba(255,255,255,.16)',
		},
		light: {
			win: 'radial-gradient(125% 105% at 50% 0%, #ffffff 0%, #eef1f5 72%)',
			winBorder: 'rgba(0,0,0,.08)', name: '#1b1e22', dim: 'rgba(0,0,0,.42)',
			me: 'background:rgba(31,157,69,.14);border:1px solid rgba(31,157,69,.30);color:#14532d;',
			chi: 'background:rgba(0,0,0,.045);border:1px solid rgba(0,0,0,.08);color:#2a2e33;',
			chip: 'background:rgba(0,0,0,.045);border:1px solid rgba(0,0,0,.10);color:#23272c;',
			input: 'background:rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.10);', inputText: '#23272c',
			ctrl: 'background:rgba(255,255,255,.75);border:1px solid rgba(0,0,0,.10);color:rgba(0,0,0,.6);',
			markFilter: 'brightness(0) saturate(100%) invert(20%) sepia(10%) saturate(400%) hue-rotate(180deg) brightness(0.6)',
			glow: 'rgba(0,0,0,.08)',
		},
		warm: {
			win: 'radial-gradient(125% 105% at 50% 0%, #fdf9f0 0%, #f0e8d6 72%)',
			winBorder: 'rgba(90,66,34,.14)', name: '#2e2820', dim: 'rgba(90,66,34,.52)',
			me: 'background:rgba(31,157,69,.13);border:1px solid rgba(31,157,69,.28);color:#1d4d2c;',
			chi: 'background:rgba(90,66,34,.06);border:1px solid rgba(90,66,34,.12);color:#3a352c;',
			chip: 'background:rgba(90,66,34,.07);border:1px solid rgba(90,66,34,.16);color:#33302a;',
			input: 'background:rgba(90,66,34,.07);border:1px solid rgba(90,66,34,.16);', inputText: '#33302a',
			ctrl: 'background:rgba(253,249,240,.8);border:1px solid rgba(90,66,34,.16);color:rgba(90,66,34,.7);',
			markFilter: 'brightness(0) saturate(100%) invert(24%) sepia(30%) saturate(600%) hue-rotate(0deg) brightness(0.7)',
			glow: 'rgba(90,66,34,.10)',
		},
		legal: {
			win: 'radial-gradient(125% 105% at 50% 0%, rgba(20,32,56,.96) 0%, rgba(10,17,32,.98) 72%)',
			winBorder: 'rgba(201,168,106,.30)', name: '#e8d9b8', dim: 'rgba(232,217,184,.6)',
			me: 'background:rgba(201,168,106,.14);border:1px solid rgba(201,168,106,.35);color:#f0e6cd;',
			chi: 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#dce3ee;',
			chip: 'background:rgba(201,168,106,.10);border:1px solid rgba(201,168,106,.30);color:#efe8d8;',
			input: 'background:rgba(201,168,106,.08);border:1px solid rgba(201,168,106,.30);', inputText: '#efe8d8',
			ctrl: 'background:rgba(201,168,106,.14);border:1px solid rgba(201,168,106,.35);color:#e8d9b8;',
			glow: 'rgba(201,168,106,.18)',
		},
	};
	var THEME_ORDER = ['dark', 'light', 'warm', 'legal'];
	var CANNED = ["Here's what I found — want me to go deeper?", 'Done. Anything else on your mind?', 'Good question. Short answer: yes — and I can show you why.', "I've drafted that for you. Want it posted to the channel?"];
	var RIPPLE = 'radial-gradient(circle at 50% 50%, rgba(120,185,255,0) 15%, rgba(130,195,255,.2) 20%, rgba(125,192,255,.42) 25%, rgba(110,190,255,.95) 27%, #ffffff 29.5%, #ffffff 31.5%, rgba(130,200,255,.9) 34%, rgba(90,170,255,0) 38%)';
	function ripples() {
		return ['0s', '.43s', '.87s'].map(function (delay) {
			return '<div style="position:absolute;left:50%;top:50%;width:150%;height:185%;transform:translate(-50%,-50%);mix-blend-mode:screen;background:' + RIPPLE + ';animation:chiRipple 1.3s ease-out ' + delay + ' infinite;"></div>';
		}).join('');
	}

	class ChiOrb extends HTMLElement {
		constructor() {
			super();
			this.attachShadow({ mode: 'open' });
			this.ask = null;
			this.actions = null;
			this.onvoice = null;
			this.onvoicestart = null;
			this.onvoiceend = null;
			this.onaction = null;       // host hook: run an action chip (desktop wires this to the live voice turn)
			this._listening = false;   // chat mic (Web Speech dictation)
			this._realtime = false;    // realtime voice takeover
			this.history = [];
			this._thinking = false;
			this._pendingConfirm = false;   // a destructive action is parked server-side awaiting Confirm/Cancel
			this._min = localStorage.getItem('chi-orb-min') === '1';
		}
		static get observedAttributes() { return ['theme', 'asset-base', 'realtime-available', 'window-controls']; }
		attributeChangedCallback() { if (this.shadowRoot && this.shadowRoot.childNodes.length) this._render(); }
		connectedCallback() { this._render(); }

		get realtime() { return this._realtime; }
		set realtime(v) { v = !!v; if (v === this._realtime) return; this._realtime = v; this._render(); }

		get _themeKey() { return localStorage.getItem('chi-orb-theme') || this.getAttribute('theme') || 'dark'; }
		get _theme() { return THEMES[this._themeKey] || THEMES.dark; }
		get _base() { return this.getAttribute('asset-base') || 'enso-assets/'; }
		get _scale() { var s = parseFloat(localStorage.getItem('chi-orb-scale')); return s >= 0.7 && s <= 1.5 ? s : 1; }
		_resize(d) { localStorage.setItem('chi-orb-scale', Math.max(0.7, Math.min(1.5, this._scale + d)).toFixed(2)); this.dispatchEvent(new CustomEvent('chi-resize', { detail: { scale: this._scale }, bubbles: true, composed: true })); this._render(); }
		_cycleTheme() { var i = THEME_ORDER.indexOf(this._themeKey); localStorage.setItem('chi-orb-theme', THEME_ORDER[(i + 1) % THEME_ORDER.length]); this._render(); }
		_toggle() { this._min = !this._min; localStorage.setItem('chi-orb-min', this._min ? '1' : '0'); this.dispatchEvent(new CustomEvent('chi-min', { detail: { min: this._min }, bubbles: true, composed: true })); this._render(); }
		_hasRealtime() { return this.getAttribute('realtime-available') === '1'; }
		_hasWinCtrl() { return this.getAttribute('window-controls') === '1'; } // desktop native-window mode: grip drags the window, adds close/frame controls

		_bubble(m) {
			var t = this._theme;
			return 'max-width:82%;padding:9px 14px;font-size:13px;line-height:1.5;animation:chiMsgIn .4s cubic-bezier(.2,.7,.3,1) both;' +
				(m.who === 'me' ? 'align-self:flex-end;border-radius:18px 4px 18px 18px;' + t.me : 'align-self:flex-start;border-radius:4px 18px 18px 18px;' + t.chi);
		}
		_actionsList() {
			if (Array.isArray(this.actions) && this.actions.length) return this.actions;
			var a = this.getAttribute('actions'); if (a) { try { return JSON.parse(a); } catch (e) { /* noop */ } }
			return [{ label: 'Summarize my day', command: 'Catch me up — what needs my attention?' }, { label: 'Any mentions?', command: 'Do I have any mentions or unread messages?' }, { label: 'Draft a standup update', command: 'Draft a standup update from my recent activity' }];
		}
		// Host-driven: swap the recommended action chips (e.g. the realtime model's suggest_actions). In the
		// LISTENING view we repaint the chips in place (the delegated click handler resolves them fresh).
		updateActions(list) {
			if (!Array.isArray(list) || !list.length) return;
			this.actions = list;
			if (this._realtime && !this._min) {
				var box = this.shadowRoot.getElementById('chips'), t = this._theme;
				if (box) box.innerHTML = list.map(function (a, i) { return '<button data-i="' + i + '" style="padding:7px 15px;border-radius:15px;cursor:pointer;font:600 12px inherit;' + t.chip + '">' + String(a.label).replace(/</g, '&lt;') + '</button>'; }).join('');
			}
		}
		_haloCss(kind) { // '', 'thinking', 'realtime'
			if (kind === 'thinking') return 'opacity:1;background:' + GHALO + ';box-shadow:0 0 55px 10px rgba(48,209,88,.55);animation:chiHalo 1.4s ease-in-out infinite;';
			if (kind === 'realtime') return 'opacity:1;background:' + BHALO + ';box-shadow:0 0 55px 10px rgba(59,155,255,.5);animation:chiHalo 1.7s ease-in-out infinite;';
			return 'opacity:0;background:transparent;box-shadow:none;animation:none;';
		}

		_mic() {
			var SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
			var self = this;
			if (this._listening) { this._voiceStop = true; try { this._rec.stop(); } catch (e) { /* noop */ } return; }
			this._voiceStop = false; this._voiceFinal = '';
			var begin = function () {
				var rec = new SR(); self._rec = rec; rec.lang = self.getAttribute('lang') || 'en-US';
				rec.continuous = true; rec.interimResults = true;
				rec.onresult = function (e) {
					var interim = '';
					for (var i = e.resultIndex; i < e.results.length; i++) { var r = e.results[i]; if (r.isFinal) self._voiceFinal += r[0].transcript; else interim += r[0].transcript; }
					var inp = self.shadowRoot.getElementById('in'); if (inp) inp.value = (self._voiceFinal + interim).trim();
				};
				rec.onerror = function (ev) { if (self._voiceStop || !ev || (ev.error !== 'no-speech' && ev.error !== 'aborted')) self._voiceStop = true; };
				rec.onend = function () {
					if (!self._voiceStop) { try { rec.start(); return; } catch (e) { /* noop */ } }
					self._listening = false; self._sync();
					var inp = self.shadowRoot.getElementById('in'); var t = inp ? (inp.value || '').trim() : '';
					if (t) { if (self.onvoice) self.onvoice(t); self._send(); }
				};
				try { rec.start(); } catch (e) { self._listening = false; self._sync(); }
			};
			this._listening = true; this._sync(); begin();
		}
		_send(preset) {
			var input = this.shadowRoot.getElementById('in');
			var text = preset != null ? String(preset) : (input ? (input.value || '').trim() : '');
			if (!text || this._thinking) return;
			if (input) input.value = '';
			this.history.push({ who: 'me', text: text });
			this._thinking = true; this._sync();
			var self = this;
			// The ask hook may resolve to a plain string OR { reply, needsConfirm } — the latter drives the
			// inline Confirm/Cancel buttons so the member never has to TYPE "confirm".
			function done(r) {
				self._thinking = false;
				var reply = (r && typeof r === 'object') ? r.reply : r;
				self._pendingConfirm = !!(r && typeof r === 'object' && r.needsConfirm);
				self.history.push({ who: 'chi', text: String(reply == null ? '…' : reply) });
				self._sync();
			}
			if (this.ask) { Promise.resolve().then(function () { return self.ask(text, self.history.slice()); }).then(done).catch(function () { done(CANNED[0]); }); }
			else if (window.claude && window.claude.complete) { window.claude.complete('You are Chi, a concise, warm AI assistant. Reply briefly to: ' + text).then(done).catch(function () { done(CANNED[0]); }); }
			else { setTimeout(function () { done(CANNED[Math.floor(Math.random() * CANNED.length)]); }, (parseFloat(self.getAttribute('think-seconds')) || 2.4) * 1000); }
		}

		_sync() {
			if (this._realtime) return; // listening version renders whole; nothing to patch
			var r = this.shadowRoot, list = r.getElementById('msgs'); if (!list) { this._render(); return; }
			var self = this;
			list.innerHTML = this.history.map(function (m) { return '<div style="' + self._bubble(m) + '"></div>'; }).join('');
			Array.prototype.forEach.call(list.children, function (el, i) { el.textContent = self.history[i].text; });
			if (this._thinking) {
				var d = document.createElement('div');
				d.setAttribute('style', 'align-self:flex-start;display:flex;gap:5px;padding:11px 14px;border-radius:4px 18px 18px 18px;' + this._theme.chi);
				d.innerHTML = '<i style="width:5px;height:5px;border-radius:50%;background:' + GREEN + ';animation:chiDot 1.2s infinite;display:block;"></i><i style="width:5px;height:5px;border-radius:50%;background:' + GREEN + ';animation:chiDot 1.2s .2s infinite;display:block;"></i><i style="width:5px;height:5px;border-radius:50%;background:' + GREEN + ';animation:chiDot 1.2s .4s infinite;display:block;"></i>';
				list.appendChild(d);
			}
			// Destructive action parked → offer one-click Confirm / Cancel (no typing "confirm"). Clicking
			// sends the deterministic confirm/cancel token to the SAME turn engine (server park, 5-min window).
			if (this._pendingConfirm && !this._thinking) {
				var cr = document.createElement('div');
				cr.setAttribute('style', 'align-self:flex-start;display:flex;gap:8px;margin:1px 0 3px;animation:chiMsgIn .3s ease both;');
				cr.innerHTML =
					'<button id="cf-yes" style="padding:7px 17px;border-radius:14px;cursor:pointer;font:700 12px inherit;border:none;color:#fff;background:rgba(48,209,88,.92);box-shadow:0 2px 9px rgba(48,209,88,.4);">Confirm</button>' +
					'<button id="cf-no" style="padding:7px 17px;border-radius:14px;cursor:pointer;font:600 12px inherit;' + this._theme.chip + '">Cancel</button>';
				list.appendChild(cr);
				cr.querySelector('#cf-yes').addEventListener('click', function () { self._pendingConfirm = false; self._send('confirm'); });
				cr.querySelector('#cf-no').addEventListener('click', function () { self._pendingConfirm = false; self._send('cancel'); });
			}
			var ch = r.getElementById('chips');
			if (ch) ch.style.display = this.history.some(function (m) { return m.who === 'me'; }) ? 'none' : '';
			list.scrollTop = list.scrollHeight;
			var st = r.getElementById('status');
			if (st) {
				st.textContent = this._thinking ? 'THINKING' : (this._listening ? 'LISTENING' : '');
				st.style.color = this._thinking ? GREEN : (this._listening ? ACCENT : this._theme.dim);
				st.style.textShadow = this._thinking ? '0 0 12px rgba(48,209,88,.7)' : (this._listening ? '0 0 12px rgba(59,155,255,.7)' : 'none');
			}
			var loop = r.getElementById('markloop');
			if (loop) loop.style.display = (this._thinking || this._listening) ? '' : 'none';
			var halo = r.getElementById('halo');
			if (halo) halo.setAttribute('style', halo.getAttribute('data-base') + (this._thinking ? this._haloCss('thinking') : this._haloCss('')));
			var mic = r.getElementById('micbtn');
			if (mic) { mic.style.background = this._listening ? 'rgba(59,155,255,.22)' : 'transparent'; mic.style.color = this._listening ? ACCENT : this._theme.dim; }
		}

		/* ---- the brushed-metal ring shell (shared by both versions) ---- */
		_shell(innerHTML) {
			var t = this._theme, haloBase = 'position:absolute;inset:-14px;border-radius:50%;pointer-events:none;transition:opacity .45s;';
			var metal = 'conic-gradient(from 145deg, #eef0f3 0%, #b6bbc2 11%, #f6f8fa 24%, #c2c7cf 37%, #e4e7ec 50%, #a7adb5 63%, #f2f4f7 76%, #c7ccd3 89%, #eef0f3 100%)';
			var ctrl = function (id, title, top, right, left, svg) {
				return '<div id="' + id + '" title="' + title + '" style="position:absolute;top:' + top + 'px;' + (right != null ? 'right:' + right + 'px;' : 'left:' + left + 'px;') + 'z-index:7;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;' + t.ctrl + '">' + svg + '</div>';
			};
			var winCtrl = this._hasWinCtrl();
			return '' +
				// In desktop window mode the window is sized to hug the orb and scaling is centered (50% 50%);
				// on the web the orb scales up from its base (50% 100%) so it grows without shifting off-anchor.
				'<div style="position:relative;width:520px;height:520px;transform:scale(' + this._scale + ');transform-origin:' + (winCtrl ? '50% 50%' : '50% 100%') + ';">' +
				'<div id="halo" data-base="' + haloBase + '" style="' + haloBase + this._haloCss(this._realtime ? 'realtime' : '') + '"></div>' +
				'<div style="position:absolute;inset:14px;border-radius:50%;pointer-events:none;background:' + metal + ';box-shadow:0 26px 60px rgba(0,0,0,.45), 0 6px 16px rgba(0,0,0,.35), inset 0 2px 3px rgba(255,255,255,.9), inset 0 -3px 6px rgba(0,0,0,.28);"></div>' +
				'<div style="position:absolute;inset:24px;border-radius:50%;pointer-events:none;background:radial-gradient(circle at 50% 30%, #3a3f45, #14171b);box-shadow:inset 0 2px 5px rgba(0,0,0,.7);"></div>' +
				'<div id="win" style="position:absolute;inset:28px;border-radius:50%;overflow:hidden;display:flex;flex-direction:column;background:' + t.win + ';border:1px solid ' + t.winBorder + ';box-shadow:inset 0 2px 1px rgba(255,255,255,.20), inset 0 -46px 90px rgba(0,0,0,.18);">' +
					'<div style="position:absolute;top:0;left:14%;right:14%;height:22%;pointer-events:none;background:radial-gradient(ellipse at 50% 0%, ' + t.glow + ', transparent 70%);"></div>' +
					innerHTML +
				'</div>' +
				// top grip handle (drag) — pointer drag is owned by the host; click-hold to move.
				'<div id="grip" title="Hold to move" style="position:absolute;top:20px;left:50%;transform:translateX(-50%);z-index:7;width:46px;height:15px;border-radius:8px;cursor:grab;display:flex;align-items:center;justify-content:center;gap:3px;background:linear-gradient(#2b2f34,#0e1013);box-shadow:inset 0 1px 1px rgba(255,255,255,.18), 0 1px 2px rgba(0,0,0,.5);">' +
					'<i style="width:14px;height:2px;border-radius:2px;background:rgba(255,255,255,.5);display:block;"></i><i style="width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.55);display:block;"></i></div>' +
				// left cluster: [close ▸ theme ▸ frame] — close + frame only exist in desktop window mode.
				(winCtrl ? ctrl('closebtn', 'Bring Chi back into the app', 74, null, 74, '<svg width="13" height="13" viewBox="0 0 12 12"><path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>') : '') +
				ctrl('themebtn', 'Switch theme', winCtrl ? 108 : 74, null, 74, '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="3.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" stroke-linecap="round"/></svg>') +
				(winCtrl ? ctrl('framebtn', 'Show the window frame / resize', 142, null, 74, '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="10" height="10" rx="2" stroke-dasharray="2.2 1.8"/><path d="M6 8 9 5M9 8V5H6"/></svg>') : '') +
				// right cluster: collapse-to-ensō (distinct inward-arrows glyph), then enlarge (+) / shrink (−) size
				ctrl('minbtn', 'Collapse to the ensō', 74, 74, null, '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5V6H2.5M8 11.5V8h3.5"/><path d="M6 6 2.75 2.75M8 8l3.25 3.25"/></svg>') +
				ctrl('growbtn', 'Enlarge', 108, 74, null, '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2.5v7M2.5 6h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>') +
				ctrl('shrinkbtn', 'Shrink', 142, 74, null, '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>') +
				'</div>';
		}

		_render() {
			var t = this._theme, A = this._base, self = this;
			var mask = '-webkit-mask:url(' + A + 'omnis-enso-bristle.svg) center/contain no-repeat;mask:url(' + A + 'omnis-enso-bristle.svg) center/contain no-repeat;';
			var kf = '@keyframes chiRipple{0%{transform:translate(-50%,-50%) scale(2.05);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(-50%,-50%) scale(.3);opacity:0}}@keyframes chiMsgIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes chiDot{0%,80%,100%{opacity:.25}40%{opacity:1}}@keyframes chiHalo{0%,100%{opacity:.65}50%{opacity:1}}@keyframes chiPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}@media (prefers-reduced-motion:reduce){*{animation:none !important}}';
			var head = '<style>' + kf + ':host{display:block;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}input{outline:none;border:none;background:transparent}button{font-family:inherit}</style>';

			/* ---- minimized launcher: JUST the ensō + looping ripple + realtime button (transparent).
			   MINIMIZED WINS over realtime — a call started here stays small (a blue listening glow +
			   the mic becomes a stop button); it never expands to the big view, and there are no chips
			   in minimized mode. Expanding (a plain click on the ensō) is the only way to the big view. ---- */
			if (this._min) {
				var rt = this._realtime;
				this.shadowRoot.innerHTML = head +
					'<div id="launch" title="Open Chi (hold to move)" style="position:relative;width:80px;height:80px;cursor:grab;transform:scale(' + this._scale + ');transform-origin:' + (this._hasWinCtrl() ? '50% 50%' : '50% 100%') + ';">' +
					(rt ? '<div style="position:absolute;inset:-9px;border-radius:50%;pointer-events:none;box-shadow:0 0 24px 6px rgba(59,155,255,.6);animation:chiHalo 1.5s ease-in-out infinite;"></div>' : '') +
					'<img src="' + A + 'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:80px;height:80px;filter:' + (t.markFilter || 'drop-shadow(0 3px 12px rgba(0,0,0,.55))') + ';">' +
					'<div style="position:absolute;inset:0;' + mask + '">' + ripples() + '</div>' +
					(this._hasRealtime() ? '<div id="micdot" title="' + (rt ? 'End voice call' : 'Talk to Chi') + '" style="position:absolute;right:-2px;bottom:-2px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:' + GREEN + ';box-shadow:0 3px 10px rgba(48,209,88,.55);' + (rt ? 'animation:chiPulse 1.1s ease-in-out infinite;' : '') + '">' + (rt ? '<svg width="10" height="10" viewBox="0 0 12 12"><rect x="3" y="3" width="6" height="6" rx="1.5" fill="#fff"/></svg>' : '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"><path d="M4 8v0M6.5 6v4M9.5 4.5v7M12 6.5v3"/></svg>') + '</div>' : '') +
					'</div>';
				var launchEl = this.shadowRoot.getElementById('launch');
				launchEl.addEventListener('click', function () { if (self._justDragged) { self._justDragged = false; return; } self._toggle(); });
				this._winDrag(launchEl); // hold-and-move repositions the puck (desktop window mode); a plain click expands
				var md = this.shadowRoot.getElementById('micdot');
				if (md) {
					md.addEventListener('pointerdown', function (e) { e.stopPropagation(); }); // press the mic, don't start a window drag
					md.addEventListener('click', function (e) {
						e.stopPropagation();
						// START only calls the host; the host flips orb.realtime=true once the call actually connects
						// (so a failed start no longer flashes LISTENING then snaps back). STOP ends immediately.
						if (self._realtime) { if (self.onvoiceend) self.onvoiceend(); self.realtime = false; }
						else if (self.onvoicestart) self.onvoicestart();
					});
				}
				return;
			}

			/* ---- LISTENING version (realtime voice) ---- */
			if (this._realtime) {
				var chipsL = this._actionsList().map(function (a, i) {
					return '<button data-i="' + i + '" style="padding:7px 15px;border-radius:15px;cursor:pointer;font:600 12px inherit;' + t.chip + '">' + String(a.label).replace(/</g, '&lt;') + '</button>';
				}).join('');
				var innerL =
					'<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px 70px;text-align:center;">' +
						'<div style="position:relative;width:132px;height:112px;">' +
							'<img src="' + A + 'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:' + (t.markFilter || 'drop-shadow(0 0 16px rgba(59,155,255,.4))') + ';">' +
							'<div style="position:absolute;inset:0;' + mask + '">' + ripples() + '</div>' +
						'</div>' +
						'<div style="font-size:13px;font-weight:800;letter-spacing:2.4px;color:' + ACCENT + ';text-shadow:0 0 14px rgba(59,155,255,.6);animation:chiHalo 1.6s ease-in-out infinite;">LISTENING…</div>' +
						'<div id="chips" style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:300px;">' + chipsL + '</div>' +
						'<div style="font-size:11px;letter-spacing:.4px;color:' + t.dim + ';margin-top:2px;">tap anywhere to end</div>' +
					'</div>';
				this.shadowRoot.innerHTML = head + this._shell(innerL);
				// Tap anywhere in the window EXCEPT an action chip ends the call. Chips keep listening.
				var win = this.shadowRoot.getElementById('win');
				if (win) win.addEventListener('click', function (e) { if (e.target.closest('#chips')) return; if (self.onvoiceend) self.onvoiceend(); self.realtime = false; });
				var chipsElL = this.shadowRoot.getElementById('chips');
				// Resolve the command FRESH on click (updateActions may have swapped the list) and route it
				// through the host's onaction hook when present (desktop → speak it into the live voice call),
				// falling back to a plain text turn on the web.
				if (chipsElL) chipsElL.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; e.stopPropagation(); var cmd = (self._actionsList()[+b.dataset.i] || {}).command; if (!cmd) return; if (self.onaction) self.onaction(cmd); else self._send(cmd); });
				this._wireShell();
				return;
			}

			/* ---- CHAT version ---- */
			var chips = this._actionsList().map(function (a, i) {
				return '<button data-i="' + i + '" style="padding:5px 12px;border-radius:13px;cursor:pointer;font:600 11px inherit;' + t.chip + '"></button>';
			}).join('');
			var inner =
				'<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:2px;padding:30px 0 8px;">' +
					'<div style="position:relative;width:56px;height:46px;">' +
						'<img src="' + A + 'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:' + (t.markFilter || 'drop-shadow(0 0 10px rgba(255,255,255,.2))') + ';">' +
						'<div id="markloop" style="position:absolute;inset:0;display:none;' + mask + '">' + ripples() + '</div>' +
					'</div>' +
					'<div style="font-size:15px;font-weight:800;letter-spacing:3px;color:' + t.name + ';">CHI</div>' +
					'<div id="status" style="font-size:10px;letter-spacing:1.4px;font-weight:600;color:' + t.dim + ';min-height:12px;"></div>' +
				'</div>' +
				'<div id="msgs" style="flex:1;overflow-y:auto;padding:6px 88px 8px;display:flex;flex-direction:column;gap:8px;min-height:0;"></div>' +
				'<div id="chips" style="flex-shrink:0;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:2px 92px 8px;">' + chips + '</div>' +
				'<div style="flex-shrink:0;padding:6px 96px 44px;display:flex;justify-content:center;">' +
					'<div style="width:100%;height:44px;border-radius:22px;display:flex;align-items:center;gap:6px;padding:0 6px 0 16px;' + t.input + '">' +
						'<input id="in" placeholder="Ask Chi anything…" style="flex:1;font-size:13px;color:' + t.inputText + ';font-family:inherit;">' +
						(this._hasRealtime() ? '<div id="voicebtn" title="Talk to Chi (realtime)" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:' + t.dim + ';"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8v0M5.5 5.5v5M8 3v10M10.5 5.5v5M13 8v0"/></svg></div>' : '') +
						'<div id="micbtn" title="Dictate" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:' + t.dim + ';"><svg width="14" height="14" viewBox="0 0 16 16"><rect x="6" y="1.5" width="4" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 7.5 c0 2.5 2 4.5 4.5 4.5 s4.5 -2 4.5 -4.5 M8 12 v2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></div>' +
						'<div id="sendbtn" title="Send" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(48,209,88,.9);color:#fff;box-shadow:0 2px 8px rgba(48,209,88,.4);"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 13 V3 M4 7 L8 3 L12 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
					'</div>' +
				'</div>';
			this.shadowRoot.innerHTML = head + this._shell(inner);

			if (!this.history.length) this.history.push({ who: 'chi', text: "Hi, I'm Chi. Ask me anything — I'll draw a circle around it." });
			this.shadowRoot.getElementById('sendbtn').addEventListener('click', function () { self._send(); });
			this.shadowRoot.getElementById('in').addEventListener('keydown', function (e) { if (e.key === 'Enter') self._send(); });
			var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
			var mic = this.shadowRoot.getElementById('micbtn');
			if (SR) mic.addEventListener('click', function () { self._mic(); }); else mic.style.display = 'none';
			var vb = this.shadowRoot.getElementById('voicebtn');
			if (vb) vb.addEventListener('click', function () { if (self.onvoicestart) self.onvoicestart(); }); // host flips realtime=true on connect
			var chipsEl = this.shadowRoot.getElementById('chips'), acts = this._actionsList();
			Array.prototype.forEach.call(chipsEl.children, function (b, i) { b.textContent = acts[i].label; });
			chipsEl.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; self._send(acts[+b.dataset.i].command); });
			this._wireShell();
			this._sync();
		}

		_wireShell() {
			var self = this, r = this.shadowRoot;
			var tb = r.getElementById('themebtn'); if (tb) tb.addEventListener('click', function (e) { e.stopPropagation(); self._cycleTheme(); });
			var mb = r.getElementById('minbtn'); if (mb) mb.addEventListener('click', function (e) { e.stopPropagation(); self._toggle(); });
			var gb = r.getElementById('growbtn'); if (gb) gb.addEventListener('click', function (e) { e.stopPropagation(); self._resize(0.1); });
			var sb = r.getElementById('shrinkbtn'); if (sb) sb.addEventListener('click', function (e) { e.stopPropagation(); self._resize(-0.1); });
			var cb = r.getElementById('closebtn'); if (cb) cb.addEventListener('click', function (e) { e.stopPropagation(); self.dispatchEvent(new CustomEvent('chi-close', { bubbles: true, composed: true })); });
			var fb = r.getElementById('framebtn'); if (fb) fb.addEventListener('click', function (e) { e.stopPropagation(); self.dispatchEvent(new CustomEvent('chi-frame', { bubbles: true, composed: true })); });
			this._winDrag(r.getElementById('grip')); // the top grip is the ONE drag handle (desktop window mode)
		}

		// Desktop window mode only: turn `el` into a native-window drag source. Tracks the pointer in SCREEN
		// coords (immune to the window moving under it) and emits chi-drag deltas the host relays to the
		// Electron window. A drag sets _justDragged so a trailing click (e.g. the launcher's expand) is skipped.
		_winDrag(el) {
			if (!el || !this._hasWinCtrl()) return;
			var self = this, st = null;
			el.style.touchAction = 'none';
			el.addEventListener('pointerdown', function (e) {
				self._justDragged = false;
				st = { x: e.screenX, y: e.screenY, id: e.pointerId, moved: false };
				try { el.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
			});
			el.addEventListener('pointermove', function (e) {
				if (!st) return;
				var dx = e.screenX - st.x, dy = e.screenY - st.y;
				if (!st.moved && dx * dx + dy * dy < 16) return; // ~4px dead-zone → a click still expands
				st.moved = true; st.x = e.screenX; st.y = e.screenY;
				self.dispatchEvent(new CustomEvent('chi-drag', { detail: { dx: dx, dy: dy }, bubbles: true, composed: true }));
			});
			var up = function () { if (st) { if (st.moved) self._justDragged = true; if (st.id != null) { try { el.releasePointerCapture(st.id); } catch (_) { /* noop */ } } } st = null; };
			el.addEventListener('pointerup', up);
			el.addEventListener('pointercancel', up);
		}
	}
	if (!customElements.get('chi-orb')) customElements.define('chi-orb', ChiOrb);
})();
