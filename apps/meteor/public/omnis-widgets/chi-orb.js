/* <chi-orb> — Chi AI assistant orb (Omnis AI) — "Nest" edition
 * A machined stainless dial (Nest-thermostat-style ring: brushed conic steel, knurled texture,
 * tintable finish, slow specular sweep) around a deep black-glass chat window; the ensō is Chi's
 * signature and runs the brand "ingest" ripple loop while Chi thinks or listens. Zero dependencies.
 *
 * TWO VERSIONS on one element:
 *   • CHAT   — bubbles + input (mic dictation + send) + action chips. GREEN halo while thinking.
 *   • LISTEN — realtime-voice takeover: big ensō, "LISTENING…", action chips, tap-anywhere-to-end
 *              (a chip does NOT end the call — only tapping elsewhere does). BLUE focus halo.
 *     Turned on by setting `orb.realtime = true` (the host flips it when the realtime call goes live).
 *
 * Controls on the ring (ALL preserved from the previous build, settings ADDED): theme switch
 * (dark ▸ light ▸ warm ▸ legal, persisted), +/− size, minimize, settings (⚙ → full-face panel:
 * Size / Theme / Frame finish / Route-notifications toggle / Connections), and a top grip.
 * The ring finish itself cycles Steel ▸ Blue ▸ Green ▸ Red ▸ Purple (persisted).
 * Every scrolling list renders on a 3D "drum" — rows tilt away toward the rim and snap to
 * detents like a Nest dial (disabled under prefers-reduced-motion).
 * Minimized = JUST the ensō with its looping animation + the realtime button.
 *
 * API (all optional):
 *   orb.ask = async (text, history[]) => reply · orb.actions = [{label,command}] · orb.realtime = bool
 *   orb.onvoicestart/onvoiceend/onvoice · orb.history = [{who,text}] (call orb._sync() after mutating)
 * Attributes: theme=…  asset-base=…  realtime-available="1"
 * NOTE FOR HOSTS: every event (chi-drag/min/close/frame/popout/resize), attribute, property and
 * localStorage key from the previous build is unchanged — this is a reskin + additions only.
 */
(function () {
	'use strict';

	var ACCENT = '#3b9bff'; // Chi blue — listening / focus
	var GREEN = '#30d158';  // thinking / live / send
	// State halos (ring-shaped radial glows) — GREEN while thinking, BLUE while listening.
	var GHALO = 'radial-gradient(circle, rgba(48,209,88,0) 50%, rgba(48,209,88,.55) 66%, rgba(48,209,88,.95) 74%, rgba(48,209,88,.55) 82%, rgba(48,209,88,0) 94%)';
	var BHALO = 'radial-gradient(circle, rgba(59,155,255,0) 50%, rgba(59,155,255,.5) 66%, rgba(59,155,255,.92) 74%, rgba(59,155,255,.5) 82%, rgba(59,155,255,0) 94%)';
	var THEMES = {
		dark: {
			win: 'radial-gradient(115% 115% at 50% 38%, #14171c 0%, #0a0c0f 55%, #040507 100%)',
			winBorder: 'rgba(255,255,255,.09)', name: '#f2f3f5', dim: 'rgba(255,255,255,.42)',
			me: 'background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.30);color:#e9f7ee;',
			chi: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);color:#dfe3e8;box-shadow:0 6px 16px -8px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);',
			chip: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#e6e9ee;',
			input: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.12), inset 0 -6px 14px rgba(0,0,0,.25);', inputText: '#e8eaed',
			ctrl: 'background:rgba(20,23,28,.72);border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.85);backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.10);',
			glow: 'rgba(255,255,255,.13)', tick: 'rgba(255,255,255,.5)', tickOp: '.14', vignette: 'inset 0 -60px 110px rgba(0,0,0,.55)',
		},
		light: {
			win: 'radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,.99) 0%, rgba(238,241,245,.99) 70%)',
			winBorder: 'rgba(0,0,0,.10)', name: '#1b1e22', dim: 'rgba(0,0,0,.42)',
			me: 'background:rgba(31,157,69,.14);border:1px solid rgba(31,157,69,.30);color:#14532d;',
			chi: 'background:rgba(0,0,0,.045);border:1px solid rgba(0,0,0,.08);color:#2a2e33;box-shadow:0 5px 14px -8px rgba(0,0,0,.18);',
			chip: 'background:rgba(0,0,0,.045);border:1px solid rgba(0,0,0,.10);color:#23272c;',
			input: 'background:rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.10);box-shadow:inset 0 1px 2px rgba(0,0,0,.06);', inputText: '#23272c',
			ctrl: 'background:rgba(255,255,255,.8);border:1px solid rgba(0,0,0,.10);color:rgba(0,0,0,.6);backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(0,0,0,.12);',
			markFilter: 'brightness(0) saturate(100%) invert(20%) sepia(10%) saturate(400%) hue-rotate(180deg) brightness(0.6)',
			glow: 'rgba(0,0,0,.07)', tick: 'rgba(0,0,0,.4)', tickOp: '.10', vignette: 'inset 0 -40px 80px rgba(0,0,0,.06)',
		},
		warm: {
			win: 'radial-gradient(120% 100% at 50% 0%, rgba(253,249,240,.99) 0%, rgba(243,235,219,.99) 70%)',
			winBorder: 'rgba(90,66,34,.16)', name: '#2e2820', dim: 'rgba(90,66,34,.52)',
			me: 'background:rgba(31,157,69,.13);border:1px solid rgba(31,157,69,.28);color:#1d4d2c;',
			chi: 'background:rgba(90,66,34,.06);border:1px solid rgba(90,66,34,.12);color:#3a352c;box-shadow:0 5px 14px -8px rgba(90,66,34,.20);',
			chip: 'background:rgba(90,66,34,.07);border:1px solid rgba(90,66,34,.16);color:#33302a;',
			input: 'background:rgba(90,66,34,.07);border:1px solid rgba(90,66,34,.16);box-shadow:inset 0 1px 2px rgba(90,66,34,.08);', inputText: '#33302a',
			ctrl: 'background:rgba(253,249,240,.85);border:1px solid rgba(90,66,34,.16);color:rgba(90,66,34,.7);backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(90,66,34,.14);',
			markFilter: 'brightness(0) saturate(100%) invert(24%) sepia(30%) saturate(600%) hue-rotate(0deg) brightness(0.7)',
			glow: 'rgba(90,66,34,.09)', tick: 'rgba(90,66,34,.45)', tickOp: '.10', vignette: 'inset 0 -40px 80px rgba(90,66,34,.07)',
		},
		legal: {
			win: 'radial-gradient(120% 100% at 50% 0%, rgba(20,32,56,.97) 0%, rgba(10,17,32,.99) 70%)',
			winBorder: 'rgba(201,168,106,.32)', name: '#e8d9b8', dim: 'rgba(232,217,184,.6)',
			me: 'background:rgba(201,168,106,.14);border:1px solid rgba(201,168,106,.35);color:#f0e6cd;',
			chi: 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#dce3ee;box-shadow:0 6px 16px -8px rgba(0,0,0,.5);',
			chip: 'background:rgba(201,168,106,.10);border:1px solid rgba(201,168,106,.30);color:#efe8d8;',
			input: 'background:rgba(201,168,106,.08);border:1px solid rgba(201,168,106,.30);box-shadow:inset 0 1px 0 rgba(255,255,255,.06), inset 0 -6px 14px rgba(0,0,0,.3);', inputText: '#efe8d8',
			ctrl: 'background:rgba(201,168,106,.14);border:1px solid rgba(201,168,106,.35);color:#e8d9b8;backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(0,0,0,.35);',
			glow: 'rgba(201,168,106,.15)', tick: 'rgba(201,168,106,.6)', tickOp: '.14', vignette: 'inset 0 -60px 110px rgba(0,0,0,.5)',
		},
	};
	var THEME_ORDER = ['dark', 'light', 'warm', 'legal'];
	// Ring finishes (Nest-style metal tints). `tint` layers over the steel with mix-blend color.
	var FRAMES = {
		steel: { tint: 'transparent', swatch: 'linear-gradient(135deg,#e8eaec 0%,#9aa0a6 100%)', name: 'Steel' },
		blue: { tint: '#4a6cf7', swatch: 'linear-gradient(135deg,#b9c6ff 0%,#3b52c4 100%)', name: 'Blue' },
		green: { tint: '#2da04e', swatch: 'linear-gradient(135deg,#a7e8bd 0%,#1c8f43 100%)', name: 'Green' },
		red: { tint: '#e0483d', swatch: 'linear-gradient(135deg,#f2a79e 0%,#b23b30 100%)', name: 'Red' },
		purple: { tint: '#8b5cf6', swatch: 'linear-gradient(135deg,#c3a6f0 0%,#6f45b2 100%)', name: 'Purple' },
	};
	var FRAME_ORDER = ['steel', 'blue', 'green', 'red', 'purple'];
	// The Connections catalog. `ready` groups can be toggled (persisted locally until the backend
	// registry lands); `soon` rows render dimmed with a SOON badge. MatterChat itself is built-in.
	var CONNECTIONS = [
		{ label: 'Omnis products', add: 'Add product', items: [
			{ slug: 'matterchat', name: 'MatterChat', builtin: true },
			{ slug: 'casepro', name: 'CasePro', ready: true },
			{ slug: 'casenotes', name: 'CaseNotes', ready: true },
			{ slug: 'carepro', name: 'CarePro', ready: true },
			{ slug: 'sendkit', name: 'SendKit', ready: true },
			{ slug: 'depolink', name: 'DepoLink' },
			{ slug: 'omnisproof', name: 'OmnisProof' },
			{ slug: 'medchron', name: 'MedChron' },
			{ slug: 'autodoc', name: 'AutoDoc' },
			{ slug: 'litdraft', name: 'LitDraft' },
		] },
		{ label: 'Language models', add: 'Add model', radio: 'chi-model', items: [
			{ slug: 'claude-sonnet', name: 'Claude · Sonnet 4.5', ready: true, def: true },
			{ slug: 'claude-opus', name: 'Claude · Opus 4', ready: true },
			{ slug: 'gpt-4o', name: 'GPT-4o', ready: true },
			{ slug: 'gemini-pro', name: 'Gemini 2.5 Pro', ready: true },
			{ slug: 'llama-local', name: 'Llama 3 · local' },
		] },
		{ label: 'MCP servers', add: 'Add MCP', items: [
			{ slug: 'mcp-filesystem', name: 'Filesystem' },
			{ slug: 'mcp-postgres', name: 'Postgres' },
			{ slug: 'mcp-github', name: 'GitHub' },
			{ slug: 'mcp-playwright', name: 'Playwright' },
		] },
		{ label: 'Email', add: 'Connect mailbox', items: [
			{ slug: 'outlook', name: 'Outlook' },
			{ slug: 'gmail', name: 'Gmail' },
		] },
		{ label: 'Integrations', add: 'Add integration', items: [
			{ slug: 'litbox-drafts', name: 'LitBox Drafts', ready: true },
			{ slug: 'gcal', name: 'Google Calendar' },
			{ slug: 'zapier', name: 'Zapier' },
		] },
	];
	var CANNED = ["Here's what I found — want me to go deeper?", 'Done. Anything else on your mind?', 'Good question. Short answer: yes — and I can show you why.', "I've drafted that for you. Want it posted to the channel?"];
	var RIPPLE = 'radial-gradient(circle at 50% 50%, rgba(120,185,255,0) 15%, rgba(130,195,255,.2) 20%, rgba(125,192,255,.42) 25%, rgba(110,190,255,.95) 27%, #ffffff 29.5%, #ffffff 31.5%, rgba(130,200,255,.9) 34%, rgba(90,170,255,0) 38%)';
	var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	function ripples() {
		return ['0s', '.43s', '.87s'].map(function (delay) {
			return '<div style="position:absolute;left:50%;top:50%;width:150%;height:185%;transform:translate(-50%,-50%);mix-blend-mode:screen;background:' + RIPPLE + ';animation:chiRipple 1.3s ease-out ' + delay + ' infinite;"></div>';
		}).join('');
	}
	function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

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
			this._settingsOpen = false;     // the ⚙ full-face panel
			this._settingsPanel = 'main';   // 'main' | 'connections'
		}
		static get observedAttributes() { return ['theme', 'asset-base', 'realtime-available', 'window-controls', 'popout-control']; }
		attributeChangedCallback() { if (this.shadowRoot && this.shadowRoot.childNodes.length) this._render(); }
		connectedCallback() { this._render(); }

		get realtime() { return this._realtime; }
		set realtime(v) { v = !!v; if (v === this._realtime) return; this._realtime = v; this._render(); }

		get _themeKey() { return localStorage.getItem('chi-orb-theme') || this.getAttribute('theme') || 'dark'; }
		get _theme() { return THEMES[this._themeKey] || THEMES.dark; }
		get _base() { return this.getAttribute('asset-base') || 'enso-assets/'; }
		get _scale() { var s = parseFloat(localStorage.getItem('chi-orb-scale')); return s >= 0.7 && s <= 1.5 ? s : 1; }
		get _frameKey() { var f = localStorage.getItem('chi-orb-frame'); return f === 'custom' || FRAMES[f] ? f : 'steel'; }
		get _frameHue() { var h = parseFloat(localStorage.getItem('chi-orb-frame-hue')); return h >= 0 && h <= 360 ? h : 145; }
		get _frame() {
			if (this._frameKey === 'custom') {
				var h = this._frameHue;
				return { tint: 'hsl(' + h + ', 72%, 52%)', swatch: 'linear-gradient(135deg, hsl(' + h + ', 78%, 74%) 0%, hsl(' + h + ', 70%, 38%) 100%)', name: 'Custom' };
			}
			return FRAMES[this._frameKey];
		}
		_resize(d) { localStorage.setItem('chi-orb-scale', Math.max(0.7, Math.min(1.5, this._scale + d)).toFixed(2)); this.dispatchEvent(new CustomEvent('chi-resize', { detail: { scale: this._scale }, bubbles: true, composed: true })); this._render(); }
		_cycleTheme() { var i = THEME_ORDER.indexOf(this._themeKey); localStorage.setItem('chi-orb-theme', THEME_ORDER[(i + 1) % THEME_ORDER.length]); this._render(); }
		_cycleFrame() { var i = FRAME_ORDER.indexOf(this._frameKey); localStorage.setItem('chi-orb-frame', FRAME_ORDER[(i + 1) % FRAME_ORDER.length]); this._render(); }
		_toggle() { this._min = !this._min; localStorage.setItem('chi-orb-min', this._min ? '1' : '0'); this.dispatchEvent(new CustomEvent('chi-min', { detail: { min: this._min }, bubbles: true, composed: true })); this._render(); }
		_hasRealtime() { return this.getAttribute('realtime-available') === '1'; }
		_hasWinCtrl() { return this.getAttribute('window-controls') === '1'; } // desktop native-window mode: grip drags the window, adds close/frame controls
		_hasPopout() { return this.getAttribute('popout-control') === '1'; }   // in-app web mode: a pop-out ring control (next to theme), grip drags the in-app container

		_bubble(m) {
			var t = this._theme;
			return 'max-width:82%;padding:9px 14px;font-size:13px;line-height:1.5;animation:chiMsgIn .45s cubic-bezier(.2,.75,.25,1) both;transform-origin:50% 50%;backface-visibility:hidden;' +
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
				if (box) box.innerHTML = list.map(function (a, i) { return '<button data-i="' + i + '" class="chip" style="padding:7px 15px;border-radius:15px;cursor:pointer;font:600 12px inherit;' + t.chip + '">' + esc(a.label) + '</button>'; }).join('');
			}
		}
		_haloCss(kind) { // '', 'thinking', 'realtime'
			if (kind === 'thinking') return 'opacity:1;background:' + GHALO + ';box-shadow:0 0 55px 10px rgba(48,209,88,.55);animation:chiHalo 1.4s ease-in-out infinite;';
			if (kind === 'realtime') return 'opacity:1;background:' + BHALO + ';box-shadow:0 0 55px 10px rgba(59,155,255,.5);animation:chiHalo 1.7s ease-in-out infinite;';
			return 'opacity:0;background:transparent;box-shadow:none;animation:none;';
		}

		/* ---- chat mic (Web Speech dictation) — logic unchanged; do not touch ---- */
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
					'<button id="cf-no" class="chip" style="padding:7px 17px;border-radius:14px;cursor:pointer;font:600 12px inherit;' + this._theme.chip + '">Cancel</button>';
				list.appendChild(cr);
				cr.querySelector('#cf-yes').addEventListener('click', function () { self._pendingConfirm = false; self._send('confirm'); });
				cr.querySelector('#cf-no').addEventListener('click', function () { self._pendingConfirm = false; self._send('cancel'); });
			}
			var ch = r.getElementById('chips');
			if (ch) ch.style.display = this.history.some(function (m) { return m.who === 'me'; }) ? 'none' : '';
			list.scrollTop = list.scrollHeight;
			this._drumApply(list);
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

		/* ---- Nest 3D drum scrolling ------------------------------------------------------------
		 * Rows ride a real cylinder: true angular projection (rotateX + cos-recession +
		 * inward pull), a whisper of motion blur and dimming at the rims, a short linear
		 * transform transition for that damped machined-inertia feel, snap detents — and a
		 * mechanical TICK each time a new row crosses the center line while the user scrolls
		 * (Sounds toggle in settings; skipped under prefers-reduced-motion). `strength`
		 * scales the geometry (chat is subtler than settings). */
		_drumify(el, strength, centerPad) {
			if (!el || el._drum) return;
			el._drum = { k: strength == null ? 1 : strength, raf: 0, idx: -1, scrolling: 0 };
			var self = this;
			el.style.perspective = '820px';
			el.style.perspectiveOrigin = '50% 50%';
			el.addEventListener('scroll', function () {
				el._drum.scrolling = Date.now(); // ticks only fire for user-driven motion, not re-renders
				if (el._drum.raf) return;
				el._drum.raf = requestAnimationFrame(function () { el._drum.raf = 0; self._drumApply(el); });
			}, { passive: true });
			if (centerPad) {
				// Runway at both ends so the FIRST and LAST rows can travel all the way to the drum's
				// center line — without this the scroll range ends with them pinned at the dim rim
				// ("can't scroll all the way to the top/bottom stuff").
				requestAnimationFrame(function () {
					var p = Math.round(el.clientHeight * 0.36);
					el.style.paddingTop = p + 'px';
					el.style.paddingBottom = p + 'px';
					self._drumApply(el);
				});
			}
			this._drumApply(el);
		}
		_drumApply(el) {
			if (!el || !el._drum || REDUCED) return;
			var k = el._drum.k;
			var rect = el.getBoundingClientRect();
			var mid = rect.top + rect.height / 2;
			var half = rect.height / 2 || 1;
			var nearest = -1, nearestDist = 1e9;
			for (var i = 0; i < el.children.length; i++) {
				var c = el.children[i];
				var cr = c.getBoundingClientRect();
				var off = (cr.top + cr.height / 2 - mid) / half; // -1 (top rim) … 0 (center) … 1 (bottom rim)
				if (off < -1.3 || off > 1.3) { c.style.visibility = 'hidden'; continue; }
				c.style.visibility = '';
				var t = Math.max(-1, Math.min(1, off));
				var a = Math.abs(t);
				if (a < nearestDist) { nearestDist = a; nearest = i; }
				var th = t * (Math.PI / 2) * 0.82;                    // row's angle on the cylinder
				var rot = (-th * 180 / Math.PI) * k;                  // tilt away toward the rim
				var z = -(1 - Math.cos(th)) * 112 * k;                // true cos-recession into the drum
				var ty = -Math.sin(th) * a * 6 * k;                   // gentle wrap pull (small — rows must never collide)
				var sc = 1 - a * a * 0.06 * k;                        // gentle ease-squared shrink
				if (!c._drumInit) {                                    // damped, machined follow — set once
					c._drumInit = 1;
					c.style.willChange = 'transform, opacity, filter';
					c.style.transition = 'transform .09s linear, opacity .14s linear, filter .14s linear';
				}
				var base = c.getAttribute('data-drum-base') || '';
				c.style.transform = base + ' rotateX(' + rot.toFixed(2) + 'deg) translateZ(' + z.toFixed(1) + 'px) translateY(' + ty.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
				// rim rows dissolve BEFORE they can visually stack — steeper opacity curve than the tilt
				c.style.opacity = String(Math.max(0, 1 - a * a * 0.72 * k).toFixed(3));
				// rim treatment: a whisper of blur + darkening, center row gets a subtle lift
				c.style.filter = a > 0.48 ? 'blur(' + ((a - 0.48) * 2.6 * k).toFixed(2) + 'px) brightness(' + (1 - (a - 0.48) * 0.5 * k).toFixed(3) + ')' : (a < 0.18 ? 'brightness(1.06)' : '');
			}
			// Detent tick: a new row crossed the center while the user was actually scrolling.
			if (nearest !== -1 && nearest !== el._drum.idx) {
				var was = el._drum.idx;
				el._drum.idx = nearest;
				if (was !== -1 && Date.now() - el._drum.scrolling < 140) this._tick();
			}
		}
		/* Mechanical detent click — synthesized (no asset): a tight filtered snap + a low wooden
		 * body, ~45 ms total. Rate-limited so a fast spin sounds like a dial, not a machine gun.
		 * Gated by the Sounds toggle (localStorage chi-orb-sound, default ON). */
		_tick(loud) {
			if (localStorage.getItem('chi-orb-sound') === '0') return;
			var now = Date.now();
			if (!loud && this._lastTick && now - this._lastTick < 38) return;
			this._lastTick = now;
			try {
				var C = this._ac || (this._ac = new (window.AudioContext || window.webkitAudioContext)());
				if (C.state === 'suspended') C.resume();
				var t0 = C.currentTime;
				var o = C.createOscillator(); o.type = 'square'; o.frequency.value = 2150;
				var f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1850; f.Q.value = 1.4;
				var g = C.createGain(); g.gain.setValueAtTime(loud ? 0.10 : 0.05, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.032);
				o.connect(f); f.connect(g); g.connect(C.destination); o.start(t0); o.stop(t0 + 0.04);
				var o2 = C.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(620, t0); o2.frequency.exponentialRampToValueAtTime(360, t0 + 0.045);
				var g2 = C.createGain(); g2.gain.setValueAtTime(loud ? 0.055 : 0.024, t0); g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
				o2.connect(g2); g2.connect(C.destination); o2.start(t0); o2.stop(t0 + 0.06);
			} catch (e) { /* audio unavailable — stay silent */ }
		}

		/* ---- the machined stainless shell (shared by both versions) ----
		 * Control philosophy (founder direction): the metal stays CLEAN. The only on-face controls
		 * are a small arc under the grip — [window-frame] · [settings ⚙] · [×] — everything else
		 * (theme, size, frame finish, pop-out, collapse) lives INSIDE the settings panel. Dictation
		 * and realtime voice stay on the input pill. × = close window (desktop) / collapse (web). */
		_shell(innerHTML) {
			var t = this._theme, f = this._frame, haloBase = 'position:absolute;inset:-14px;border-radius:50%;pointer-events:none;transition:opacity .45s;';
			// Nest-style stainless: long-throw conic brushed steel + fine knurl + tint + specular sweep.
			var steel = 'conic-gradient(from 200deg, #e8eaec, #9aa0a6 8%, #caced3 16%, #6f757c 27%, #b7bcc2 38%, #f2f4f6 50%, #a3a9af 60%, #d5d9dd 72%, #767c83 84%, #cfd3d7 93%, #e8eaec)';
			var ringMask = '-webkit-mask:radial-gradient(circle, transparent 60%, black 61%);mask:radial-gradient(circle, transparent 60%, black 61%);';
			var winCtrl = this._hasWinCtrl();
			// The top arc: buttons follow the glass curvature (outer buttons sit lower). Bare glyphs,
			// no chrome — they read as etched into the glass.
			var arcBtn = function (id, title, ty, svg) {
				return '<div id="' + id + '" class="arcb" title="' + title + '" style="transform:translateY(' + ty + 'px);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:' + t.dim + ';">' + svg + '</div>';
			};
			var gearSvg = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" stroke-linecap="round"/></svg>';
			var frameSvg = '<svg width="14" height="14" viewBox="0 0 16 16"><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.4 2"/></svg>';
			var xSvg = '<svg width="12" height="12" viewBox="0 0 16 16"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
			var arc = '<div id="arc" style="flex-shrink:0;position:relative;z-index:7;display:flex;align-items:flex-start;justify-content:center;gap:15px;padding-top:14px;">' +
				(winCtrl ? arcBtn('framebtn', 'Show the window frame / resize', 7, frameSvg) : '') +
				arcBtn('settingsbtn', 'Chi settings', 0, gearSvg) +
				(winCtrl
					? arcBtn('closebtn', 'Bring Chi back into the app', 7, xSvg)
					: arcBtn('minbtn', 'Collapse to the ensō', 7, xSvg)) +
			'</div>';
			return '' +
				// In desktop window mode the window is sized to hug the orb and scaling is centered (50% 50%);
				// on the web the orb scales up from its base (50% 100%) so it grows without shifting off-anchor.
				'<div style="position:relative;width:520px;height:520px;transform:scale(' + this._scale + ');transform-origin:' + (winCtrl ? '50% 50%' : '50% 100%') + ';">' +
				'<div id="halo" data-base="' + haloBase + '" style="' + haloBase + this._haloCss(this._realtime ? 'realtime' : '') + '"></div>' +
				// 1 · stainless band (full bleed to the rim)
				'<div style="position:absolute;inset:0;border-radius:50%;pointer-events:none;background:' + steel + ';box-shadow:0 70px 130px -34px rgba(0,0,0,.82), 0 26px 60px -18px rgba(0,0,0,.55), 0 6px 16px rgba(0,0,0,.5), inset 0 2px 3px rgba(255,255,255,.9), inset 0 -3px 6px rgba(0,0,0,.45);"></div>' +
				// 2 · machined knurl texture on the band
				'<div style="position:absolute;inset:2px;border-radius:50%;pointer-events:none;background:repeating-conic-gradient(rgba(255,255,255,.28) 0deg .5deg, rgba(0,0,0,.22) .5deg 1.6deg);opacity:.32;-webkit-mask:radial-gradient(circle, transparent 91%, black 92%);mask:radial-gradient(circle, transparent 91%, black 92%);"></div>' +
				// 3 · finish tint (Steel = none; live-updated by the settings hue slider without a re-render)
				//     two layers: `color` blend carries the hue, `multiply` deepens it to dark anodized metal.
				'<div id="tint" style="position:absolute;inset:0;border-radius:50%;pointer-events:none;mix-blend-mode:color;background:' + f.tint + ';"></div>' +
				'<div id="tintshade" style="position:absolute;inset:0;border-radius:50%;pointer-events:none;mix-blend-mode:multiply;opacity:.42;background:' + (f.tint === 'transparent' ? 'transparent' : f.tint) + ';"></div>' +
				// 4 · slow specular sweep — light traveling around the metal
				'<div style="position:absolute;inset:0;border-radius:50%;pointer-events:none;overflow:hidden;' + ringMask + '"><div style="position:absolute;inset:-2%;background:conic-gradient(from 0deg, transparent 0 8%, rgba(255,255,255,.5) 11%, transparent 15%, transparent 55%, rgba(255,255,255,.25) 58%, transparent 62%);mix-blend-mode:screen;animation:chiSweep 14s linear infinite;"></div></div>' +
				// 5 · inner bevel ring (dark machined step down to the glass)
				'<div style="position:absolute;inset:15px;border-radius:50%;pointer-events:none;background:conic-gradient(from 20deg, #43474c, #14161a 25%, #3a3e44 50%, #101216 75%, #43474c);box-shadow:inset 0 1px 2px rgba(255,255,255,.35), 0 2px 6px rgba(0,0,0,.6);"></div>' +
				// 6 · black glass face
				'<div id="win" style="position:absolute;inset:26px;border-radius:50%;overflow:hidden;display:flex;flex-direction:column;background:' + t.win + ';border:1px solid ' + t.winBorder + ';box-shadow:inset 0 3px 10px rgba(255,255,255,.07), inset 0 -6px 14px rgba(0,0,0,.35), ' + t.vignette + ';">' +
					'<div style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 60% 34% at 32% 12%, ' + t.glow + ', transparent 65%);"></div>' +
					// etched tick ring just inside the glass rim
					'<div style="position:absolute;inset:0;pointer-events:none;border-radius:50%;background:repeating-conic-gradient(' + t.tick + ' 0deg .4deg, transparent .4deg 3.6deg);opacity:' + t.tickOp + ';-webkit-mask:radial-gradient(circle, transparent 88.5%, black 89.5%, black 95%, transparent 96%);mask:radial-gradient(circle, transparent 88.5%, black 89.5%, black 95%, transparent 96%);"></div>' +
					arc +
					innerHTML +
				'</div>' +
				// top grip handle (drag) — pointer drag is owned by the host; click-hold to move.
				'<div id="grip" title="Hold to move" style="position:absolute;top:19px;left:50%;transform:translateX(-50%);z-index:7;width:46px;height:15px;border-radius:8px;cursor:grab;display:flex;align-items:center;justify-content:center;gap:3px;background:linear-gradient(#2b2f34,#0e1013);box-shadow:inset 0 1px 1px rgba(255,255,255,.18), 0 1px 2px rgba(0,0,0,.5);">' +
					'<i style="width:14px;height:2px;border-radius:2px;background:rgba(255,255,255,.5);display:block;"></i><i style="width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.55);display:block;"></i></div>' +
				// minimize stays reachable on the OUTSIDE too (founder direction): the classic
				// collapse-to-ensō chrome button on the ring, top-right, in every mode.
				'<div id="ringminbtn" class="ctl" title="Collapse to the ensō" style="position:absolute;top:74px;right:74px;z-index:7;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;' + t.ctrl + '"><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5V6H2.5M8 11.5V8h3.5"/><path d="M6 6 2.75 2.75M8 8l3.25 3.25"/></svg></div>' +
				'</div>';
		}

		/* ---- the ⚙ settings overlay (full glass face, drum-scrolled) ---- */
		_settingsHTML() {
			var t = this._theme, f = this._frame;
			var isConn = this._settingsPanel === 'connections';
			var row = function (inner, extra) {
				return '<div class="srow" data-drum-base="" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 2px;border-bottom:1px solid rgba(128,128,128,.16);scroll-snap-align:center;' + (extra || '') + '">' + inner + '</div>';
			};
			var chev = '<svg width="12" height="12" viewBox="0 0 16 16"><path d="M6 3 L11 8 L6 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
			var sw = function (on, id, disabled) {
				return '<div ' + (id ? 'id="' + id + '" ' : '') + 'class="sw' + (disabled ? ' swoff' : '') + '" style="width:34px;height:20px;border-radius:11px;cursor:' + (disabled ? 'default' : 'pointer') + ';padding:2px;box-sizing:border-box;flex-shrink:0;transition:background .2s;background:' + (on ? GREEN : 'rgba(140,140,150,.45)') + ';' + (disabled ? 'opacity:.35;' : '') + '">' +
					'<div style="width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .2s;transform:translateX(' + (on ? 15 : 1) + 'px);"></div></div>';
			};
			var body;
			if (!isConn) {
				body =
					row('<span style="font-size:12px;opacity:.85;">Size</span>' +
						'<span style="display:flex;align-items:center;gap:8px;">' +
						'<span id="s-shrink" class="sbtn" style="width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(128,128,128,.16);"><svg width="12" height="12" viewBox="0 0 16 16"><path d="M3.5 8 h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>' +
						'<span style="font-size:11.5px;opacity:.7;min-width:34px;text-align:center;font-variant-numeric:tabular-nums;">' + Math.round(this._scale * 100) + '%</span>' +
						'<span id="s-grow" class="sbtn" style="width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(128,128,128,.16);"><svg width="12" height="12" viewBox="0 0 16 16"><path d="M8 3.5 v9 M3.5 8 h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span></span>') +
					row('<span style="font-size:12px;opacity:.85;">Theme</span><span id="s-theme" style="display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.75;text-transform:capitalize;cursor:pointer;">' + this._themeKey + ' ' + chev + '</span>') +
					// Frame finish: preset dots + a fully draggable hue slider (drag anywhere on the bar;
					// the ring tint + swatch update LIVE while dragging, persisted as a custom finish).
					row('<span style="font-size:12px;opacity:.85;">Frame</span><span style="display:flex;align-items:center;gap:6px;">' +
						FRAME_ORDER.map(function (k2) {
							var sel = k2 === (localStorage.getItem('chi-orb-frame') || 'steel');
							return '<span class="fdot" data-frame="' + k2 + '" title="' + FRAMES[k2].name + '" style="width:15px;height:15px;border-radius:50%;cursor:pointer;box-shadow:inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.35)' + (sel ? ', 0 0 0 2px ' + GREEN : '') + ';background:' + FRAMES[k2].swatch + ';"></span>';
						}).join('') +
						'<span id="s-swatch" title="Custom" style="width:15px;height:15px;border-radius:50%;box-shadow:inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.35)' + (this._frameKey === 'custom' ? ', 0 0 0 2px ' + GREEN : '') + ';background:' + (this._frameKey === 'custom' ? f.swatch : 'conic-gradient(red,#ff0,#0f0,#0ff,#00f,#f0f,red)') + ';"></span></span>') +
					row('<span id="s-hue" style="position:relative;flex:1;height:14px;border-radius:7px;cursor:ew-resize;touch-action:none;background:linear-gradient(90deg, hsl(0,72%,52%), hsl(60,72%,52%), hsl(120,72%,52%), hsl(180,72%,52%), hsl(240,72%,52%), hsl(300,72%,52%), hsl(360,72%,52%));box-shadow:inset 0 1px 3px rgba(0,0,0,.45);">' +
						'<span id="s-hueknob" style="position:absolute;top:50%;left:' + (this._frameHue / 360 * 100).toFixed(1) + '%;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;background:hsl(' + this._frameHue + ',72%,52%);border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5);pointer-events:none;"></span></span>', 'border-bottom:1px solid rgba(128,128,128,.16);') +
					row('<span style="font-size:12px;opacity:.85;">Sounds</span>' + sw(localStorage.getItem('chi-orb-sound') !== '0', 's-sound')) +
					row('<span style="font-size:12px;opacity:.85;">Route notifications to Chi</span>' + sw(localStorage.getItem('chi-notif-route') === '1', 's-route')) +
					(this._hasPopout() ? row('<span style="font-size:12px;opacity:.85;">Pop out into its own window</span><span id="s-popout" style="display:inline-flex;opacity:.6;cursor:pointer;">' + chev + '</span>', 'cursor:pointer;" data-act="popout') : '') +
					row('<span style="font-size:12px;opacity:.85;">Collapse to the ensō</span><span id="s-collapse" style="display:inline-flex;opacity:.6;cursor:pointer;">' + chev + '</span>', 'cursor:pointer;" data-act="collapse') +
					row('<span style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;"><svg width="15" height="15" viewBox="0 0 16 16"><circle cx="4.5" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.5" cy="4" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.5" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.4 7 L9.6 4.8 M6.4 9 L9.6 11.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>Connections</span><span id="s-conn" style="display:inline-flex;opacity:.6;cursor:pointer;">' + chev + '</span>', 'cursor:pointer;" data-open-conn="1');
			} else {
				var self = this;
				body = CONNECTIONS.map(function (g) {
					var head = '<div data-drum-base="" style="display:flex;align-items:center;justify-content:space-between;margin:10px 2px 2px;scroll-snap-align:center;">' +
						'<span style="font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">' + g.label + '</span>' +
						'<span style="font-size:10px;opacity:.5;">+ ' + g.add + '</span></div>';
					var rows = g.items.map(function (it) {
						var badge = it.builtin ? '<span style="font-size:8.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:8px;background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.35);color:' + GREEN + ';">BUILT IN</span>'
							: (it.ready ? '' : '<span style="font-size:8.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:8px;background:rgba(128,128,128,.14);border:1px solid rgba(128,128,128,.25);opacity:.65;">SOON</span>');
						var on = it.builtin || (g.radio ? localStorage.getItem(g.radio) === it.slug || (it.def && !localStorage.getItem(g.radio)) : localStorage.getItem('chi-conn-' + it.slug) === '1');
						return '<div class="srow" data-drum-base="" data-conn="' + it.slug + '" data-group="' + (g.radio || '') + '" data-locked="' + (it.builtin || !it.ready ? '1' : '') + '" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);scroll-snap-align:center;">' +
							'<span style="display:flex;align-items:center;gap:7px;min-width:0;"><span style="font-size:12px;opacity:' + (it.ready || it.builtin ? '.9' : '.55') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + it.name + '</span>' + badge + '</span>' +
							sw(on, null, it.builtin || !it.ready) + '</div>';
					}).join('');
					return head + rows;
				}).join('');
			}
			return '<div id="settings" style="position:absolute;inset:0;z-index:9;border-radius:50%;overflow:hidden;display:flex;flex-direction:column;background:' + t.win + ';animation:chiFadeIn .3s ease both;">' +
				'<div style="position:absolute;inset:0;pointer-events:none;border-radius:50%;box-shadow:inset 0 4px 12px rgba(255,255,255,.06), ' + t.vignette + ';"></div>' +
				'<div style="flex-shrink:0;display:flex;align-items:center;gap:8px;padding:64px 96px 8px;color:' + t.name + ';">' +
					(isConn ? '<span id="s-back" style="cursor:pointer;opacity:.8;display:inline-flex;align-items:center;"><svg width="15" height="15" viewBox="0 0 16 16"><path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '') +
					'<span style="font-size:13px;font-weight:800;letter-spacing:.6px;">' + (isConn ? 'Connections' : 'Settings') + '</span>' +
					'<span id="s-close" style="margin-left:auto;cursor:pointer;opacity:.75;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;"><svg width="12" height="12" viewBox="0 0 16 16"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>' +
				'</div>' +
				'<div id="slist" style="flex:1;overflow-y:auto;padding:16px 78px 70px;color:' + t.name + ';scroll-snap-type:y proximity;-webkit-mask-image:linear-gradient(to bottom, transparent 0, #000 15%, #000 82%, transparent 100%);mask-image:linear-gradient(to bottom, transparent 0, #000 15%, #000 82%, transparent 100%);">' + body + '</div>' +
			'</div>';
		}
		_wireSettings() {
			var self = this, r = this.shadowRoot, panel = r.getElementById('settings');
			if (!panel) return;
			var on = function (id, fn) { var el = r.getElementById(id); if (el) el.addEventListener('click', function (e) { e.stopPropagation(); fn(); }); };
			on('s-close', function () { self._settingsOpen = false; self._render(); });
			on('s-back', function () { self._settingsPanel = 'main'; self._render(); });
			on('s-grow', function () { self._resize(0.1); });
			on('s-shrink', function () { self._resize(-0.1); });
			on('s-theme', function () { self._cycleTheme(); });
			// Frame finish: preset dots snap to a named finish; the hue bar is a full drag-anywhere
			// color changer — the ring tint updates LIVE during the drag (no re-render), persists on release.
			panel.querySelectorAll('.fdot').forEach(function (dot) {
				dot.addEventListener('click', function (e) {
					e.stopPropagation();
					localStorage.setItem('chi-orb-frame', dot.getAttribute('data-frame'));
					self._tick(1);
					self._render();
				});
			});
			var hue = r.getElementById('s-hue');
			if (hue) {
				var setHue = function (clientX, commit) {
					var hr = hue.getBoundingClientRect();
					var p = Math.max(0, Math.min(1, (clientX - hr.left) / (hr.width || 1)));
					var h = Math.round(p * 360);
					localStorage.setItem('chi-orb-frame', 'custom');
					localStorage.setItem('chi-orb-frame-hue', String(h));
					// live-mutate the ring tint + knob + swatch — a full render mid-drag would drop the pointer
					var tint = r.getElementById('tint'); if (tint) tint.style.background = 'hsl(' + h + ', 72%, 52%)';
					var shade = r.getElementById('tintshade'); if (shade) shade.style.background = 'hsl(' + h + ', 72%, 46%)';
					var knob = r.getElementById('s-hueknob'); if (knob) { knob.style.left = (p * 100).toFixed(1) + '%'; knob.style.background = 'hsl(' + h + ',72%,52%)'; }
					var swp = r.getElementById('s-swatch'); if (swp) swp.style.background = 'linear-gradient(135deg, hsl(' + h + ', 78%, 74%) 0%, hsl(' + h + ', 70%, 38%) 100%)';
					if (commit) { self._tick(1); self._render(); }
				};
				var dragging = false;
				hue.addEventListener('pointerdown', function (e) { e.stopPropagation(); dragging = true; try { hue.setPointerCapture(e.pointerId); } catch (_) { /* noop */ } setHue(e.clientX, false); });
				hue.addEventListener('pointermove', function (e) { if (dragging) setHue(e.clientX, false); });
				var endHue = function (e) { if (!dragging) return; dragging = false; setHue(e.clientX, true); };
				hue.addEventListener('pointerup', endHue);
				hue.addEventListener('pointercancel', function () { if (dragging) { dragging = false; self._render(); } });
			}
			on('s-route', function () {
				var now = localStorage.getItem('chi-notif-route') === '1';
				localStorage.setItem('chi-notif-route', now ? '0' : '1');
				self.dispatchEvent(new CustomEvent('chi-notif-route', { detail: { on: !now }, bubbles: true, composed: true }));
				self._render();
			});
			on('s-sound', function () {
				var wasOn = localStorage.getItem('chi-orb-sound') !== '0';
				localStorage.setItem('chi-orb-sound', wasOn ? '0' : '1');
				if (!wasOn) self._tick(1); // audible confirmation the moment sound comes back on
				self._render();
			});
			var pr = panel.querySelector('[data-act="popout"]');
			if (pr) pr.addEventListener('click', function () { self._settingsOpen = false; self._render(); self.dispatchEvent(new CustomEvent('chi-popout', { bubbles: true, composed: true })); });
			var cl = panel.querySelector('[data-act="collapse"]');
			if (cl) cl.addEventListener('click', function () { self._settingsOpen = false; self._toggle(); });
			var connRow = panel.querySelector('[data-open-conn]');
			if (connRow) connRow.addEventListener('click', function () { self._settingsPanel = 'connections'; self._render(); });
			var list = r.getElementById('slist');
			if (list) {
				list.addEventListener('click', function (e) {
					var rowEl = e.target.closest('[data-conn]');
					if (!rowEl || rowEl.getAttribute('data-locked') === '1') return;
					var slug = rowEl.getAttribute('data-conn'), radio = rowEl.getAttribute('data-group');
					if (radio) localStorage.setItem(radio, slug);
					else { var key = 'chi-conn-' + slug; localStorage.setItem(key, localStorage.getItem(key) === '1' ? '0' : '1'); }
					self._render();
				});
				this._drumify(list, 1, true);
			}
		}

		_render() {
			var t = this._theme, A = this._base, self = this;
			var mask = '-webkit-mask:url(' + A + 'omnis-enso-bristle.svg) center/contain no-repeat;mask:url(' + A + 'omnis-enso-bristle.svg) center/contain no-repeat;';
			var kf = '@keyframes chiRipple{0%{transform:translate(-50%,-50%) scale(2.05);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(-50%,-50%) scale(.3);opacity:0}}@keyframes chiMsgIn{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes chiDot{0%,80%,100%{opacity:.25}40%{opacity:1}}@keyframes chiHalo{0%,100%{opacity:.65}50%{opacity:1}}@keyframes chiPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}@keyframes chiSweep{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes chiVoicePulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.5}50%{transform:translate(-50%,-50%) scale(1.22);opacity:.95}}@keyframes chiFadeIn{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){*{animation:none !important}}';
			var hover = '.ctl{transition:transform .15s ease, box-shadow .15s ease}.ctl:hover{transform:translateY(-1px) scale(1.06);box-shadow:0 4px 12px rgba(0,0,0,.35)}.arcb{opacity:.72;transition:opacity .15s ease}.arcb:hover{opacity:1}.chip{transition:transform .15s ease, background .18s, border-color .18s}.chip:hover{transform:translateY(-1px)}.sbtn:hover{background:rgba(128,128,128,.28) !important}.srow{transition:opacity .15s}.fdot{transition:transform .12s ease}.fdot:hover{transform:scale(1.2)}#sendbtn{transition:transform .15s ease, box-shadow .18s}#sendbtn:hover{transform:scale(1.08);box-shadow:0 3px 14px rgba(48,209,88,.55) !important}#inputpill:focus-within{border-color:rgba(48,209,88,.55) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 3px rgba(48,209,88,.12) !important}';
			var head = '<style>' + kf + hover + ':host{display:block;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}input{outline:none;border:none;background:transparent}button{font-family:inherit}::-webkit-scrollbar{width:0;height:0}</style>';

			/* ---- minimized launcher: JUST the ensō + looping ripple + realtime button (transparent).
			   MINIMIZED WINS over realtime — a call started here stays small (a blue listening glow +
			   the mic becomes a stop button); it never expands to the big view, and there are no chips
			   in minimized mode. Expanding (a plain click on the ensō) is the only way to the big view. ---- */
			if (this._min) {
				var rt = this._realtime;
				this.shadowRoot.innerHTML = head +
					'<div id="launch" title="Open Chi (hold to move)" style="position:relative;width:80px;height:80px;cursor:grab;transform:scale(' + this._scale + ');transform-origin:' + (this._hasWinCtrl() ? '50% 50%' : '50% 100%') + ';">' +
					'<div style="position:absolute;inset:-14px;border-radius:50%;pointer-events:none;background:radial-gradient(circle, rgba(48,209,88,.22) 30%, rgba(48,209,88,0) 70%);animation:chiHalo 3s ease-in-out infinite;"></div>' +
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
					return '<button data-i="' + i + '" class="chip" style="padding:7px 15px;border-radius:15px;cursor:pointer;font:600 12px inherit;' + t.chip + '">' + esc(a.label) + '</button>';
				}).join('');
				var innerL =
					'<div style="position:absolute;inset:0;pointer-events:none;border-radius:50%;background:radial-gradient(circle at 50% 50%, transparent 52%, rgba(0,0,0,.35) 82%, rgba(0,0,0,.6) 100%);"></div>' +
					'<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px 70px;text-align:center;">' +
						'<div style="position:relative;width:150px;height:126px;">' +
							'<div style="position:absolute;left:50%;top:50%;width:220px;height:220px;border-radius:50%;pointer-events:none;animation:chiVoicePulse 1.9s ease-in-out infinite;background:radial-gradient(circle, rgba(90,160,255,.38) 0%, transparent 62%);"></div>' +
							'<img src="' + A + 'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:' + (t.markFilter || 'drop-shadow(0 0 16px rgba(255,255,255,.25))') + ';">' +
							'<div style="position:absolute;inset:0;' + mask + '">' + ripples() + '</div>' +
						'</div>' +
						'<div style="font-size:13px;font-weight:800;letter-spacing:2.4px;color:' + ACCENT + ';text-shadow:0 0 14px rgba(59,155,255,.6);animation:chiHalo 1.6s ease-in-out infinite;">LISTENING…</div>' +
						'<div id="chips" style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:300px;">' + chipsL + '</div>' +
						'<div style="font-size:11px;letter-spacing:.4px;color:' + t.dim + ';margin-top:2px;">tap anywhere to end</div>' +
					'</div>';
				this.shadowRoot.innerHTML = head + this._shell(innerL + (this._settingsOpen ? this._settingsHTML() : ''));
				// Tap anywhere in the window EXCEPT an action chip (or the settings panel) ends the call.
				var win = this.shadowRoot.getElementById('win');
				if (win) win.addEventListener('click', function (e) { if (e.target.closest('#chips') || e.target.closest('#settings') || e.target.closest('#arc')) return; if (self.onvoiceend) self.onvoiceend(); self.realtime = false; });
				var chipsElL = this.shadowRoot.getElementById('chips');
				// Resolve the command FRESH on click (updateActions may have swapped the list) and route it
				// through the host's onaction hook when present (desktop → speak it into the live voice call),
				// falling back to a plain text turn on the web.
				if (chipsElL) chipsElL.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; e.stopPropagation(); var cmd = (self._actionsList()[+b.dataset.i] || {}).command; if (!cmd) return; if (self.onaction) self.onaction(cmd); else self._send(cmd); });
				this._wireShell();
				this._wireSettings();
				return;
			}

			/* ---- CHAT version ---- */
			var chips = this._actionsList().map(function (a, i) {
				return '<button data-i="' + i + '" class="chip" style="padding:5px 12px;border-radius:13px;cursor:pointer;font:600 11px inherit;' + t.chip + '"></button>';
			}).join('');
			var inner =
				'<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:2px;padding:2px 0 8px;">' +
					'<div style="position:relative;width:56px;height:46px;">' +
						'<div style="position:absolute;left:50%;top:50%;width:110px;height:110px;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);background:radial-gradient(circle, ' + t.glow + ' 0%, transparent 62%);"></div>' +
						'<img src="' + A + 'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:' + (t.markFilter || 'drop-shadow(0 0 10px rgba(255,255,255,.2))') + ';">' +
						'<div id="markloop" style="position:absolute;inset:0;display:none;' + mask + '">' + ripples() + '</div>' +
					'</div>' +
					'<div style="font-size:15px;font-weight:800;letter-spacing:3px;color:' + t.name + ';">CHI</div>' +
					'<div id="status" style="font-size:10px;letter-spacing:1.4px;font-weight:600;color:' + t.dim + ';min-height:12px;"></div>' +
				'</div>' +
				'<div id="msgs" style="flex:1;overflow-y:auto;padding:6px 88px 8px;display:flex;flex-direction:column;gap:8px;min-height:0;-webkit-mask-image:linear-gradient(to bottom, transparent 0, #000 10%, #000 88%, transparent 100%);mask-image:linear-gradient(to bottom, transparent 0, #000 10%, #000 88%, transparent 100%);"></div>' +
				'<div id="chips" style="flex-shrink:0;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:2px 92px 8px;">' + chips + '</div>' +
				'<div style="flex-shrink:0;padding:6px 96px 44px;display:flex;justify-content:center;">' +
					'<div id="inputpill" style="width:100%;height:44px;border-radius:22px;display:flex;align-items:center;gap:6px;padding:0 6px 0 16px;transition:border-color .2s, box-shadow .2s;' + t.input + '">' +
						'<input id="in" placeholder="Ask Chi anything…" style="flex:1;font-size:13px;color:' + t.inputText + ';font-family:inherit;">' +
						(this._hasRealtime() ? '<div id="voicebtn" class="ctl" title="Talk to Chi (realtime)" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:' + t.dim + ';"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8v0M5.5 5.5v5M8 3v10M10.5 5.5v5M13 8v0"/></svg></div>' : '') +
						'<div id="micbtn" class="ctl" title="Dictate" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:' + t.dim + ';"><svg width="14" height="14" viewBox="0 0 16 16"><rect x="6" y="1.5" width="4" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 7.5 c0 2.5 2 4.5 4.5 4.5 s4.5 -2 4.5 -4.5 M8 12 v2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></div>' +
						'<div id="sendbtn" title="Send" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(48,209,88,.9);color:#fff;box-shadow:0 2px 8px rgba(48,209,88,.4);"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 13 V3 M4 7 L8 3 L12 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
					'</div>' +
				'</div>';
			this.shadowRoot.innerHTML = head + this._shell(inner + (this._settingsOpen ? this._settingsHTML() : ''));

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
			this._wireSettings();
			this._drumify(this.shadowRoot.getElementById('msgs'), 0.55); // chat drum: gentler than settings
			this._sync();
		}

		_wireShell() {
			var self = this, r = this.shadowRoot;
			var tb = r.getElementById('themebtn'); if (tb) tb.addEventListener('click', function (e) { e.stopPropagation(); self._cycleTheme(); });
			var mb = r.getElementById('minbtn'); if (mb) mb.addEventListener('click', function (e) { e.stopPropagation(); self._toggle(); });
			var rmb = r.getElementById('ringminbtn'); if (rmb) rmb.addEventListener('click', function (e) { e.stopPropagation(); self._toggle(); });
			var gb = r.getElementById('growbtn'); if (gb) gb.addEventListener('click', function (e) { e.stopPropagation(); self._resize(0.1); });
			var sb = r.getElementById('shrinkbtn'); if (sb) sb.addEventListener('click', function (e) { e.stopPropagation(); self._resize(-0.1); });
			var cb = r.getElementById('closebtn'); if (cb) cb.addEventListener('click', function (e) { e.stopPropagation(); self.dispatchEvent(new CustomEvent('chi-close', { bubbles: true, composed: true })); });
			var fb = r.getElementById('framebtn'); if (fb) fb.addEventListener('click', function (e) { e.stopPropagation(); self.dispatchEvent(new CustomEvent('chi-frame', { bubbles: true, composed: true })); });
			var pob = r.getElementById('popoutbtn'); if (pob) pob.addEventListener('click', function (e) { e.stopPropagation(); self.dispatchEvent(new CustomEvent('chi-popout', { bubbles: true, composed: true })); });
			var stb = r.getElementById('settingsbtn'); if (stb) stb.addEventListener('click', function (e) { e.stopPropagation(); self._settingsOpen = !self._settingsOpen; self._settingsPanel = 'main'; self._render(); });
			this._winDrag(r.getElementById('grip')); // the top grip above the ensō is the ONE drag handle
		}

		// Turn `el` (the grip, or the minimized launcher) into THE drag handle. Tracks the pointer in SCREEN
		// coords (immune to the surface moving under it) and emits chi-drag deltas the host relays — to the
		// Electron window when popped out, or to the in-app container otherwise. A drag sets _justDragged so a
		// trailing click (e.g. the launcher's expand) is skipped. This is the ONLY drag affordance in every mode.
		_winDrag(el) {
			if (!el) return;
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
