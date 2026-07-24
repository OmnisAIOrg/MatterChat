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
			me: 'background:linear-gradient(180deg, rgba(48,209,88,.22), rgba(48,209,88,.13));border:1px solid rgba(48,209,88,.32);color:#e9f7ee;box-shadow:inset 0 1px 0 rgba(255,255,255,.10), 0 4px 12px -6px rgba(0,0,0,.4);',
			chi: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);color:#dfe3e8;box-shadow:0 6px 16px -8px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);',
			chip: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#e6e9ee;',
			input: 'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.12), inset 0 -6px 14px rgba(0,0,0,.25);', inputText: '#e8eaed',
			ctrl: 'background:rgba(20,23,28,.72);border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.85);backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.10);',
			card: 'background:rgba(26,30,37,.97);border:1px solid rgba(255,255,255,.15);color:#e6e9ee;', glow: 'rgba(255,255,255,.13)', tick: 'rgba(255,255,255,.5)', tickOp: '.14', vignette: 'inset 0 -60px 110px rgba(0,0,0,.55)',
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
			card: 'background:rgba(252,253,255,.98);border:1px solid rgba(0,0,0,.12);color:#23272c;', glow: 'rgba(0,0,0,.07)', tick: 'rgba(0,0,0,.4)', tickOp: '.10', vignette: 'inset 0 -40px 80px rgba(0,0,0,.06)',
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
			card: 'background:rgba(250,245,234,.98);border:1px solid rgba(90,66,34,.20);color:#33302a;', glow: 'rgba(90,66,34,.09)', tick: 'rgba(90,66,34,.45)', tickOp: '.10', vignette: 'inset 0 -40px 80px rgba(90,66,34,.07)',
		},
		legal: {
			win: 'radial-gradient(120% 100% at 50% 0%, rgba(20,32,56,.97) 0%, rgba(10,17,32,.99) 70%)',
			winBorder: 'rgba(201,168,106,.32)', name: '#e8d9b8', dim: 'rgba(232,217,184,.6)',
			me: 'background:linear-gradient(180deg, rgba(201,168,106,.20), rgba(201,168,106,.11));border:1px solid rgba(201,168,106,.38);color:#f0e6cd;box-shadow:inset 0 1px 0 rgba(255,255,255,.08), 0 4px 12px -6px rgba(0,0,0,.4);',
			chi: 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#dce3ee;box-shadow:0 6px 16px -8px rgba(0,0,0,.5);',
			chip: 'background:rgba(201,168,106,.10);border:1px solid rgba(201,168,106,.30);color:#efe8d8;',
			input: 'background:rgba(201,168,106,.08);border:1px solid rgba(201,168,106,.30);box-shadow:inset 0 1px 0 rgba(255,255,255,.06), inset 0 -6px 14px rgba(0,0,0,.3);', inputText: '#efe8d8',
			ctrl: 'background:rgba(201,168,106,.14);border:1px solid rgba(201,168,106,.35);color:#e8d9b8;backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(0,0,0,.35);',
			card: 'background:rgba(19,30,52,.97);border:1px solid rgba(201,168,106,.35);color:#e9ecf2;', glow: 'rgba(201,168,106,.15)', tick: 'rgba(201,168,106,.6)', tickOp: '.14', vignette: 'inset 0 -60px 110px rgba(0,0,0,.5)',
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
	// Language-model roster — mirrors EvidenceHunt's provider-agnostic layer: cloud presets +
	// OpenAI-compatible locals (Ollama / LM Studio / llama.cpp / custom). Config persists locally
	// (chi-llm-<slug>-url/key/model) until the workspace BE roster lands.
	var MODELS = [
		{ slug: 'anthropic', name: 'Claude · Anthropic', hint: 'claude-sonnet-4-5' },
		{ slug: 'openai', name: 'OpenAI', hint: 'gpt-4o' },
		{ slug: 'gemini', name: 'Gemini · Google', hint: 'gemini-2.5-pro' },
		{ slug: 'xai', name: 'Grok · xAI', hint: 'grok-4' },
		{ slug: 'groq', name: 'Groq', hint: 'llama-3.3-70b' },
		{ slug: 'cerebras', name: 'Cerebras', hint: 'llama-3.3-70b' },
		{ slug: 'openrouter', name: 'OpenRouter', hint: 'openai/gpt-oss-120b' },
		{ slug: 'deepseek', name: 'DeepSeek', hint: 'deepseek-chat' },
		{ slug: 'ollama', name: 'Ollama · runs on this computer', local: true, url: 'http://localhost:11434', hint: 'llama3.1:8b' },
		{ slug: 'lmstudio', name: 'LM Studio · local', local: true, url: 'http://localhost:1234/v1', hint: 'loaded model' },
		{ slug: 'llamacpp', name: 'llama.cpp · local', local: true, url: 'http://localhost:8080/v1', hint: 'gguf model' },
		{ slug: 'customllm', name: 'Custom · OpenAI-compatible', local: true, url: '', hint: 'any base URL' },
	];
	// Everything an AI assistant can be — LIVE = wired today; SOON = FE reminder of what to build.
	var CAPS = [
		{ label: 'Workspace', items: [
			{ slug: 'voice-cmd', name: 'Voice commands', live: true },
			{ slug: 'realtime', name: 'Realtime voice conversations', live: true },
			{ slug: 'navigate', name: 'Navigate the app for me', live: true },
			{ slug: 'summarize', name: 'Summarize & catch me up', live: true },
			{ slug: 'draftpost', name: 'Draft & post messages (confirmed)', live: true },
			{ slug: 'notifs', name: 'Notifications in Chi', live: true },
			{ slug: 'boards', name: 'Boards, tasks & deadlines', live: true },
		] },
		{ label: 'Computer control', items: [
			{ slug: 'open-apps', name: 'Open apps & files' },
			{ slug: 'click-type', name: 'Click & type on screen' },
			{ slug: 'read-screen', name: 'Read what’s on my screen' },
			{ slug: 'screenshot', name: 'Take screenshots' },
			{ slug: 'clipboard', name: 'Use the clipboard' },
			{ slug: 'browser', name: 'Drive the browser' },
		] },
		{ label: 'Files & documents', items: [
			{ slug: 'read-docs', name: 'Read PDFs & documents' },
			{ slug: 'ocr', name: 'OCR images & scans' },
			{ slug: 'draft-docs', name: 'Draft documents' },
			{ slug: 'sheets', name: 'Analyze spreadsheets' },
			{ slug: 'litbox', name: 'LitBox file access' },
		] },
		{ label: 'Communications', items: [
			{ slug: 'email-draft', name: 'Draft & send email' },
			{ slug: 'inbox', name: 'Inbox digest' },
			{ slug: 'calendar', name: 'Calendar & scheduling' },
			{ slug: 'calls', name: 'Make phone calls (voice agent)' },
			{ slug: 'sms', name: 'Send texts (SMS)' },
		] },
		{ label: 'Intelligence', items: [
			{ slug: 'memory', name: 'Long-term memory' },
			{ slug: 'prefs', name: 'Learn my preferences' },
			{ slug: 'briefing', name: 'Daily briefing' },
			{ slug: 'proactive', name: 'Proactive suggestions' },
			{ slug: 'wakeword', name: 'Wake word — “Hey Chi”' },
			{ slug: 'vision', name: 'See through my camera' },
			{ slug: 'watch-screen', name: 'Watch my screen & help' },
		] },
		{ label: 'Automations', items: [
			{ slug: 'routines', name: 'Scheduled routines' },
			{ slug: 'watchers', name: 'Watchers & triggers' },
			{ slug: 'workflows', name: 'Multi-step workflows' },
			{ slug: 'agents', name: 'Agent teams (sub-agents)' },
		] },
	];
	// Speech-to-text roster for Flow (VoiceInk parity). `wired` = works END-TO-END today from
	// the browser (key/URL from settings); the rest render fully so the roster is the roadmap.
	// Keys reuse the LLM store where the provider is the same company (one key, both uses).
	var STT_PROVIDERS = [
		{ slug: 'webspeech', name: 'Built-in · browser speech', builtin: true, wired: true, live: true },
		{ slug: 'workspace', name: 'Workspace · server-managed key', workspace: true, wired: true },
		{ slug: 'stt-openai', name: 'OpenAI · Whisper / 4o-transcribe', wired: true, keyStore: 'chi-llm-openai-key', url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-4o-mini-transcribe' },
		{ slug: 'stt-groq', name: 'Groq · Whisper large-v3-turbo', wired: true, keyStore: 'chi-llm-groq-key', url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
		{ slug: 'stt-local', name: 'Local Whisper server', wired: true, local: true, urlStore: 'chi-stt-local-url', urlHint: 'http://localhost:9000 (OpenAI-compatible)', model: 'whisper-1' },
		{ slug: 'stt-gemini', name: 'Gemini', keyStore: 'chi-llm-gemini-key' },
		{ slug: 'stt-mistral', name: 'Mistral · Voxtral', keyStore: 'chi-stt-mistral-key' },
		{ slug: 'stt-deepgram', name: 'Deepgram', keyStore: 'chi-stt-deepgram-key' },
		{ slug: 'stt-elevenlabs', name: 'ElevenLabs', keyStore: 'chi-stt-elevenlabs-key' },
		{ slug: 'stt-soniox', name: 'Soniox', keyStore: 'chi-stt-soniox-key' },
		{ slug: 'stt-speechmatics', name: 'Speechmatics', keyStore: 'chi-stt-speechmatics-key' },
		{ slug: 'stt-assemblyai', name: 'AssemblyAI', keyStore: 'chi-stt-assemblyai-key' },
		{ slug: 'stt-xai', name: 'xAI', keyStore: 'chi-llm-xai-key' },
		{ slug: 'stt-cartesia', name: 'Cartesia', keyStore: 'chi-stt-cartesia-key' },
	];
	// Downloadable on-device catalog (sizes/speed/accuracy from the VoiceInk-class model zoo).
	// Downloads need the desktop host — rows render with meters now, Download lands with the BE.
	// REAL downloadable on-device models — Whisper via the vendored transformers.js (WASM). The
	// Download button fetches the ONNX weights (browser-cached; huggingface.co CDN) and from then
	// on transcription runs ENTIRELY on this machine: private, offline, $0. Works web + desktop.
	var OD_MODELS = [
		{ slug: 'tiny-en', name: 'Whisper Tiny (English)', hf: 'onnx-community/whisper-tiny.en', dl: '~50 MB', speed: 9.5, acc: 6.5, note: 'Fastest — quick notes' },
		{ slug: 'base-en', name: 'Whisper Base (English)', hf: 'onnx-community/whisper-base.en', dl: '~80 MB', speed: 8.5, acc: 7.5, note: 'Best speed/accuracy balance' },
		{ slug: 'base', name: 'Whisper Base (Multilingual)', hf: 'onnx-community/whisper-base', dl: '~80 MB', speed: 8.5, acc: 7.2, note: '25+ languages' },
		{ slug: 'small-en', name: 'Whisper Small (English)', hf: 'onnx-community/whisper-small.en', dl: '~250 MB', speed: 7.0, acc: 8.8, note: 'High-accuracy dictation' },
	];
	var STT_LOCAL_MODELS = [
		{ name: 'Apple Speech', size: 'built-in', speed: 9, acc: 8.5, note: 'Native on-device (macOS 26+)' },
		{ name: 'Parakeet V3', size: '494 MB', speed: 9.9, acc: 9.4, note: 'Lightning fast · 25 languages' },
		{ name: 'Nemotron Multilingual', size: '672 MB', speed: 9.9, acc: 9.0, note: 'NVIDIA streaming model' },
		{ name: 'Whisper Large v3 Turbo', size: '1.5 GB', speed: 7.5, acc: 9.4, note: 'Near-max accuracy (needs the desktop runtime)' },
	];
	// The in-product feature ledger (Settings → What's new). Mirrors docs/CHI-ASSISTANT.md.
	var WHATSNEW = [
		{ label: 'This build — live', items: [
			'On-device Whisper — download once, transcribe offline',
			'Configurable dictation shortcut + push-and-hold mode',
			'Live REC feedback — level meter, timer, red halo',
			'Desktop popout: true transparency',
			'Nest dial redesign · full color editor · 4 themes',
			'3D drum scrolling with detent ticks + sounds',
			'Notifications in Chi — cards, reply, banner mode',
			'Focus timer + catch-up digest',
			'Hover peek · presence glow · unseen badge',
			'Flow dictation (⌘⇧F) — dictate anywhere, AI polish',
			'Workspace transcription — server-held keys, secure',
			'Dictionary replacements + vocabulary',
			'Transcription History + words counter',
			'Live captions during realtime voice',
			'Language models — cloud + local (Ollama, LM Studio)',
			'Product connectors (MCP) with signed identity',
			'Per-user prefs synced to the server',
			'⌘⇧C summon · drop-anything-on-Chi',
		] },
		{ label: 'Coming next', items: [
			'On-device speech models (Parakeet, Whisper) — downloads',
			'More speech providers (Deepgram, ElevenLabs, …)',
			'Connectors: DepoLink, OmnisProof, MedChron, AutoDoc, LitDraft',
			'Omnis OAuth — one identity across every product',
			'Email: Outlook + Gmail',
			'Computer control · files & documents · automations',
			'Memory, daily briefing, wake word “Hey Chi”',
			'Per-app dictation modes + custom shortcuts',
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
			this.onreply = null;        // host hook: route a notification reply back to its room (Phase 2)
			this.ondrop = null;         // host hook: something was dropped on the orb (file / text)
			this._replyTo = null;       // the notification currently being replied to
			this._pending = [];         // notifications queued while minimized or in focus mode
			this._unseen = 0;           // queued count → launcher badge + amber presence glow
			this._lastNotif = null;     // most recent notification → hover peek on the launcher
			this._caps = [];            // live voice caption lines (realtime view)
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
		connectedCallback() {
			this._render();
			var self = this;
			// Global summon hotkey (⌘⇧C / Ctrl⇧C): expand + focus the input from anywhere on the page.
			if (!this._hotkeyFn) {
				this._hotkeyFn = function (e) {
					if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyC') { e.preventDefault(); self._summon(); }
					// Flow quick command (user-configurable). Toggle mode: press = start, press again =
					// deliver. Hold mode: keydown starts, RELEASING the combo's key delivers.
					var hk = self._flowHotkey();
					if (self._hotkeyMatches(e, hk)) {
						e.preventDefault();
						if (e.repeat) return;
						if (self._flowActivation() === 'hold') { if (!self._flow) { self._holdKey = hk.code; self.flowToggle(); } }
						else self.flowToggle();
					}
				};
				window.addEventListener('keydown', this._hotkeyFn, true);
				this._hotkeyUpFn = function (e) {
					if (self._holdKey && e.code === self._holdKey && self._flow) { e.preventDefault(); self._holdKey = null; self._flowFinish(); }
				};
				window.addEventListener('keyup', this._hotkeyUpFn, true);
			}
			// Drop-anything-on-Chi: drag a file or text onto the orb → blue ingest glow, then hand it
			// to the host (ondrop) or fold it into a normal Chi turn.
			if (!this._dropWired) {
				this._dropWired = 1;
				this.addEventListener('dragover', function (e) { e.preventDefault(); self._dropGlow(true); });
				this.addEventListener('dragleave', function () { self._dropGlow(false); });
				this.addEventListener('drop', function (e) { e.preventDefault(); self._dropGlow(false); self._handleDrop(e); });
			}
		}
		disconnectedCallback() {
			if (this._hotkeyFn) { window.removeEventListener('keydown', this._hotkeyFn, true); this._hotkeyFn = null; }
			if (this._hotkeyUpFn) { window.removeEventListener('keyup', this._hotkeyUpFn, true); this._hotkeyUpFn = null; }
			clearInterval(this._focusInt); clearTimeout(this._bannerT);
		}
		_summon() { if (this._min) this._toggle(); var inp = this.shadowRoot.getElementById('in'); if (inp) inp.focus(); }
		/* The Flow hotkey is USER-CONFIGURABLE (Settings → Modes → click the shortcut chip and press
		 * any combo). Stored as {ctrl,meta,alt,shift,code,label}; default ⌘⇧F / Ctrl⇧F. */
		_flowHotkey() {
			try {
				var h = JSON.parse(localStorage.getItem('chi-flow-hotkey') || 'null');
				if (h && h.code) return h;
			} catch (e) { /* fall through */ }
			return { ctrl: true, meta: true, alt: false, shift: true, code: 'KeyF', label: null };
		}
		_hotkeyLabel(h) {
			if (h.label) return h.label;
			var mac = /Mac|iP/.test(navigator.platform || '');
			var parts = [];
			if (h.ctrl && h.meta) parts.push(mac ? '⌘' : 'Ctrl');
			else { if (h.ctrl) parts.push(mac ? '⌃' : 'Ctrl'); if (h.meta) parts.push('⌘'); }
			if (h.alt) parts.push(mac ? '⌥' : 'Alt');
			if (h.shift) parts.push(mac ? '⇧' : 'Shift');
			parts.push(String(h.code).replace(/^Key|^Digit/, '').replace('Space', '␣'));
			return parts.join(mac ? '' : '+');
		}
		_hotkeyMatches(e, h) {
			if (e.code !== h.code) return false;
			var wantPrimary = h.ctrl || h.meta;
			var hasPrimary = e.ctrlKey || e.metaKey;
			if (h.ctrl && h.meta) { if (!hasPrimary) return false; }
			else { if (Boolean(e.ctrlKey) !== Boolean(h.ctrl) || Boolean(e.metaKey) !== Boolean(h.meta)) return false; }
			if (!wantPrimary && hasPrimary) return false;
			return Boolean(e.shiftKey) === Boolean(h.shift) && Boolean(e.altKey) === Boolean(h.alt);
		}
		/* Convert the stored combo to an Electron accelerator for the SYSTEM-WIDE shortcut. */
		_hotkeyAccel(h) {
			var parts = [];
			if (h.ctrl || h.meta) parts.push('CommandOrControl');
			if (h.alt) parts.push('Alt');
			if (h.shift) parts.push('Shift');
			var k = String(h.code).replace(/^Key/, '').replace(/^Digit/, '');
			if (/^F\d{1,2}$/.test(h.code)) k = h.code;
			if (h.code === 'Space') k = 'Space';
			if (!/^[A-Za-z0-9]{1,5}$|^F\d{1,2}$|^Space$/.test(k)) return null;
			parts.push(k.toUpperCase());
			return parts.join('+');
		}
		_flowActivation() { return localStorage.getItem('chi-flow-activation') === 'hold' ? 'hold' : 'toggle'; }
		/** Quick command: one call starts Flow dictation (expanding first if minimized); the next
		 * finishes + delivers. Wired to ⌘⇧F here and to the desktop app's global shortcut. */
		flowToggle() {
			if (this._realtime) return; // never fight a live voice call
			if (this._min) this._toggle();
			if (this._flow) this._flowFinish(); else this._flowStart();
		}
		_dropGlow(on) {
			var h = this.shadowRoot.getElementById('halo');
			if (h) h.setAttribute('style', h.getAttribute('data-base') + (on ? this._haloCss('realtime') : (this._thinking ? this._haloCss('thinking') : this._haloCss(this._realtime ? 'realtime' : ''))));
		}
		_handleDrop(e) {
			var desc = '';
			try {
				var dt = e.dataTransfer;
				if (dt.files && dt.files.length) desc = Array.prototype.map.call(dt.files, function (f) { return f.name; }).slice(0, 3).join(', ');
				else desc = String(dt.getData('text') || '').replace(/\s+/g, ' ').trim().slice(0, 140);
			} catch (_) { /* noop */ }
			if (!desc) return;
			if (this.ondrop) { this.ondrop({ text: desc, dataTransfer: e.dataTransfer }); return; }
			if (this._min) this._toggle();
			if (!this._realtime) this._send('I just dropped this on you: ' + desc + ' — take a look.');
		}

		get realtime() { return this._realtime; }
		set realtime(v) { v = !!v; if (v === this._realtime) return; this._realtime = v; this._render(); }

		get _themeKey() { return localStorage.getItem('chi-orb-theme') || this.getAttribute('theme') || 'dark'; }
		get _theme() { return THEMES[this._themeKey] || THEMES.dark; }
		get _base() { return this.getAttribute('asset-base') || 'enso-assets/'; }
		get _scale() { var s = parseFloat(localStorage.getItem('chi-orb-scale')); return s >= 0.7 && s <= 1.5 ? s : 1; }
		get _frameKey() { var f = localStorage.getItem('chi-orb-frame'); return f === 'custom' || FRAMES[f] ? f : 'steel'; }
		get _frameHue() { var h = parseFloat(localStorage.getItem('chi-orb-frame-hue')); return h >= 0 && h <= 360 ? h : 145; }
		get _frameSat() { var s = parseFloat(localStorage.getItem('chi-orb-frame-sat')); return s >= 0 && s <= 100 ? s : 72; }
		get _frameLum() { var l = parseFloat(localStorage.getItem('chi-orb-frame-lum')); return l >= 0 && l <= 100 ? l : 52; }
		get _frame() {
			if (this._frameKey === 'custom') {
				var h = this._frameHue, s = this._frameSat, l = this._frameLum;
				return {
					tint: 'hsl(' + h + ', ' + s + '%, ' + l + '%)',
					swatch: 'linear-gradient(135deg, hsl(' + h + ', ' + s + '%, ' + Math.min(88, l + 22) + '%) 0%, hsl(' + h + ', ' + s + '%, ' + Math.max(12, l - 16) + '%) 100%)',
					name: 'Custom',
				};
			}
			return FRAMES[this._frameKey];
		}
		_resize(d) { localStorage.setItem('chi-orb-scale', Math.max(0.7, Math.min(1.5, this._scale + d)).toFixed(2)); this.dispatchEvent(new CustomEvent('chi-resize', { detail: { scale: this._scale }, bubbles: true, composed: true })); this._render(); }
		_cycleTheme() { var i = THEME_ORDER.indexOf(this._themeKey); localStorage.setItem('chi-orb-theme', THEME_ORDER[(i + 1) % THEME_ORDER.length]); this._render(); }
		_cycleFrame() { var i = FRAME_ORDER.indexOf(this._frameKey); localStorage.setItem('chi-orb-frame', FRAME_ORDER[(i + 1) % FRAME_ORDER.length]); this._render(); }
		_toggle() { if (this._flow) this._flowCancel(); this._min = !this._min; localStorage.setItem('chi-orb-min', this._min ? '1' : '0'); if (!this._min) this._flushPending(); this.dispatchEvent(new CustomEvent('chi-min', { detail: { min: this._min }, bubbles: true, composed: true })); this._render(); }
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
				if (box) box.innerHTML = list.map(function (a, i) { return '<button data-i="' + i + '" class="chip" style="padding:7px 15px;border-radius:15px;cursor:pointer;font:600 12px inherit;box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 2px 8px -3px rgba(0,0,0,.3);' + t.chip + '">' + esc(a.label) + '</button>'; }).join('');
			}
		}
		_haloCss(kind) { // '', 'thinking', 'realtime'
			if (kind === 'thinking') return 'opacity:1;background:' + GHALO + ';box-shadow:0 0 55px 10px rgba(48,209,88,.55);animation:chiHalo 1.4s ease-in-out infinite;';
			if (kind === 'realtime') return 'opacity:1;background:' + BHALO + ';box-shadow:0 0 55px 10px rgba(59,155,255,.5);animation:chiHalo 1.7s ease-in-out infinite;';
			return 'opacity:0;background:transparent;box-shadow:none;animation:none;';
		}

		/* ---- Flow support: dictionary, history, capture + cloud/local transcription ---- */
		_dict() { try { var d = JSON.parse(localStorage.getItem('chi-dict') || '[]'); return Array.isArray(d) ? d : []; } catch (e) { return []; } }
		_applyDictionary(text) {
			// VoiceInk-style word replacements ("Qi"→"Chi", "wynn"→"Nguyen"), whole-word, case-insensitive.
			var out = String(text || '');
			this._dict().forEach(function (e2) {
				if (!e2 || !e2.o) return;
				try { out = out.replace(new RegExp('\\b' + String(e2.o).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), e2.r || ''); } catch (e3) { /* bad pattern */ }
			});
			return out;
		}
		_pushHistory(text) {
			try {
				var h = JSON.parse(localStorage.getItem('chi-flow-history') || '[]');
				if (!Array.isArray(h)) h = [];
				h.unshift({ ts: Date.now(), text: String(text).slice(0, 2000) });
				localStorage.setItem('chi-flow-history', JSON.stringify(h.slice(0, 60)));
				var words = parseInt(localStorage.getItem('chi-flow-words') || '0', 10) + String(text).trim().split(/\s+/).length;
				localStorage.setItem('chi-flow-words', String(words));
			} catch (e) { /* quota — fine */ }
		}
		_recSound(startNot) {
			if (localStorage.getItem('chi-orb-sound') === '0' || localStorage.getItem('chi-rec-sounds') === '0') return;
			try {
				var C = this._ac || (this._ac = new (window.AudioContext || window.webkitAudioContext)());
				if (C.state === 'suspended') C.resume();
				var t0 = C.currentTime;
				var o = C.createOscillator(); o.type = 'sine';
				o.frequency.setValueAtTime(startNot ? 520 : 780, t0);
				o.frequency.exponentialRampToValueAtTime(startNot ? 780 : 520, t0 + 0.09);
				var g = C.createGain(); g.gain.setValueAtTime(0.05, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
				o.connect(g); g.connect(C.destination); o.start(t0); o.stop(t0 + 0.13);
			} catch (e) { /* silent */ }
		}
		_sttConfig() {
			var slug = localStorage.getItem('chi-stt-model') || 'webspeech';
			if (slug.indexOf('ondevice:') === 0) {
				var od = slug.slice(9);
				for (var j = 0; j < OD_MODELS.length; j++) {
					if (OD_MODELS[j].slug === od && localStorage.getItem('chi-ondevice-' + od) === '1') {
						return { slug: slug, name: OD_MODELS[j].name + ' · on-device', ondevice: OD_MODELS[j] };
					}
				}
			}
			for (var i = 0; i < STT_PROVIDERS.length; i++) if (STT_PROVIDERS[i].slug === slug) return STT_PROVIDERS[i];
			return STT_PROVIDERS[0];
		}
		/* transformers.js loader — vendored SAME-ORIGIN (script-src safe); ONNX wasm + model weights
		 * stream from CDN and cache in the browser. One import for the app's lifetime. */
		_odLib() {
			if (!window.__chiTf) {
				window.__chiTf = import('/omnis-widgets/vendor/transformers.min.js').then(function (m) {
					m.env.allowLocalModels = false;
					try { m.env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0/dist/'; } catch (e) { /* default paths */ }
					return m;
				});
			}
			return window.__chiTf;
		}
		_odPipe(model, onProgress) {
			window.__chiOdPipes = window.__chiOdPipes || {};
			if (!window.__chiOdPipes[model.slug]) {
				window.__chiOdPipes[model.slug] = this._odLib().then(function (m) {
					return m.pipeline('automatic-speech-recognition', model.hf, { dtype: 'q8', progress_callback: onProgress || undefined });
				});
				window.__chiOdPipes[model.slug].catch(function () { delete window.__chiOdPipes[model.slug]; });
			}
			return window.__chiOdPipes[model.slug];
		}
		_odDecode(blob) { // webm/opus clip → 16 kHz mono Float32 (what Whisper wants)
			return blob.arrayBuffer().then(function (ab) {
				var AC = window.AudioContext || window.webkitAudioContext;
				var ac = new AC({ sampleRate: 16000 });
				return ac.decodeAudioData(ab).then(function (buf) {
					var ch = buf.getChannelData(0);
					var out = new Float32Array(ch.length);
					out.set(ch);
					try { ac.close(); } catch (e) { /* noop */ }
					return out;
				});
			});
		}
		/* Transcribe a recorded clip through the chosen provider (OpenAI-compatible
		 * audio/transcriptions — OpenAI, Groq, or a local Whisper server). Returns the text. */
		_transcribe(blob) {
			var p2 = this._sttConfig();
			var self = this;
			if (p2.ondevice) {
				var liveEl = this.shadowRoot.getElementById('flowlive');
				return this._odPipe(p2.ondevice, function (ev2) {
					if (ev2 && ev2.status === 'progress' && liveEl) liveEl.textContent = 'Loading ' + p2.ondevice.name + '… ' + Math.round(ev2.progress || 0) + '%';
				}).then(function (asr) {
					if (liveEl) liveEl.textContent = 'Transcribing on this device…';
					return self._odDecode(blob).then(function (audio) { return asr(audio); }).then(function (out2) {
						return String((out2 && out2.text) || '').trim();
					});
				});
			}
			if (p2.workspace) {
				// Secure lane: the clip goes to OUR server; the server relays it with the WORKSPACE
				// key (admin-held). No provider keys exist in this browser.
				var fdw = new FormData();
				fdw.append('file', blob, 'flow.webm');
				var vocw = (localStorage.getItem('chi-vocab') || '').trim();
				if (vocw) fdw.append('prompt', 'Vocabulary: ' + vocw.slice(0, 600));
				var hw = {};
				try {
					var tk = localStorage.getItem('Meteor.loginToken'), du = localStorage.getItem('Meteor.userId');
					if (tk) hw['X-Auth-Token'] = tk;
					if (du) hw['X-User-Id'] = du;
				} catch (e9) { /* noop */ }
				return fetch('/api/v1/chi.transcribe', { method: 'POST', headers: hw, body: fdw })
					.then(function (res) { return res.json().then(function (d) { if (!res.ok || d.success === false) throw new Error((d && d.error) || ('HTTP ' + res.status)); return String(d.text || '').trim(); }); });
			}
			var url = p2.local ? ((localStorage.getItem(p2.urlStore) || '').replace(/\/+$/, '') + '/v1/audio/transcriptions') : p2.url;
			var key = p2.keyStore ? (localStorage.getItem(p2.keyStore) || '') : '';
			var model = localStorage.getItem('chi-stt-' + p2.slug + '-model') || p2.model || 'whisper-1';
			var fd = new FormData();
			fd.append('file', blob, 'flow.webm');
			fd.append('model', model);
			var vocab = (localStorage.getItem('chi-vocab') || '').trim();
			if (vocab) fd.append('prompt', 'Vocabulary: ' + vocab.slice(0, 600));
			return fetch(url, { method: 'POST', headers: key ? { Authorization: 'Bearer ' + key } : {}, body: fd })
				.then(function (res) { return res.json().then(function (d) { if (!res.ok) throw new Error((d && d.error && d.error.message) || ('HTTP ' + res.status)); return String(d.text || '').trim(); }); });
		}

		/* ---- Flow — dictation that speeds up writing (clean-room; inspired by VoiceInk's UX,
		 * none of its code): tap ⚡ → speak → live transcript → optional AI polish (the same
		 * ask() brain) → lands in the room composer (host event), a Chi turn, or the clipboard. */
		_flowStart() {
			if (this._flow) return;
			var self = this;
			var panel = this.shadowRoot.getElementById('flowpanel'); if (panel) panel.style.display = 'flex';
			var liveEl = this.shadowRoot.getElementById('flowlive');
			var stt = this._sttConfig();
			this._recSound(true);
			// Non-built-in model → capture audio and send the clip to the provider on Done.
			if (stt.slug !== 'webspeech') {
				this._flow = { recorder: null, chunks: [], stop: false, mode: 'clip' };
				var dev = localStorage.getItem('chi-mic-device') || '';
				navigator.mediaDevices.getUserMedia({ audio: dev ? { deviceId: { exact: dev } } : true }).then(function (stream) {
					if (!self._flow) { stream.getTracks().forEach(function (tk) { tk.stop(); }); return; }
					var mr = new MediaRecorder(stream);
					self._flow.recorder = mr; self._flow.stream = stream;
					mr.ondataavailable = function (ev2) { if (ev2.data && ev2.data.size) self._flow && self._flow.chunks.push(ev2.data); };
					mr.start(250);
					self._flow.capT = setTimeout(function () { if (self._flow) self._flowFinish(); }, 5 * 60 * 1000);
					self._flowUiStart(stream);
					if (liveEl) liveEl.textContent = '● Recording with ' + stt.name + ' — ' + (self._flowActivation() === 'hold' ? 'release the key to transcribe.' : 'tap Done to transcribe.');
				}).catch(function () { if (liveEl) liveEl.textContent = 'Microphone unavailable — check permissions.'; });
				this._tick(1);
				return;
			}
			var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
			if (!SR) { if (liveEl) liveEl.textContent = 'Built-in speech is unavailable here — pick a cloud/local model in Settings → Transcription.'; return; }
			this._flow = { rec: null, final: '', stop: false, mode: 'live' };
			var begin = function () {
				var rec = new SR(); self._flow.rec = rec; rec.lang = self.getAttribute('lang') || 'en-US';
				rec.continuous = true; rec.interimResults = true;
				rec.onresult = function (e) {
					var interim = '';
					for (var i = e.resultIndex; i < e.results.length; i++) { var r0 = e.results[i]; if (r0.isFinal) self._flow.final += r0[0].transcript; else interim += r0[0].transcript; }
					if (liveEl) { liveEl.textContent = (self._flow.final + interim).trim() || 'Listening…'; liveEl.scrollTop = liveEl.scrollHeight; }
					self._flowUiBump();
				};
				rec.onerror = function (ev) { if (self._flow && (self._flow.stop || !ev || (ev.error !== 'no-speech' && ev.error !== 'aborted'))) self._flow.stop = true; };
				rec.onend = function () { if (self._flow && !self._flow.stop) { try { rec.start(); return; } catch (e2) { /* noop */ } } };
				try { rec.start(); } catch (e3) { /* mic denied — leave panel showing the hint */ }
			};
			begin();
			this._flowUiStart(null);
			this._tick(1);
		}
		/* Recording feedback: crimson pulsing halo + RECORDING status + elapsed timer + a LIVE level
		 * meter (AnalyserNode on the actual mic stream in clip mode; speech-activity pulses in
		 * built-in mode). Everything restores cleanly on cancel/finish. */
		_flowUiStart(stream) {
			var r = this.shadowRoot, self = this;
			var halo = r.getElementById('halo');
			if (halo) halo.setAttribute('style', halo.getAttribute('data-base') + 'opacity:1;background:radial-gradient(circle, rgba(255,69,58,0) 50%, rgba(255,69,58,.5) 66%, rgba(255,69,58,.92) 74%, rgba(255,69,58,.5) 82%, rgba(255,69,58,0) 94%);box-shadow:0 0 55px 10px rgba(255,69,58,.5);animation:chiHalo 1.1s ease-in-out infinite;');
			var st = r.getElementById('status');
			if (st) { st.textContent = 'RECORDING'; st.style.color = '#ff453a'; st.style.textShadow = '0 0 12px rgba(255,69,58,.7)'; }
			var t0 = Date.now();
			this._flowUi = { t0: t0, int: 0, raf: 0, ac: null };
			this._flowUi.int = setInterval(function () {
				var el = r.getElementById('flowtime'); if (!el) return;
				var sec = Math.floor((Date.now() - t0) / 1000);
				el.textContent = Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
			}, 500);
			var meter = r.getElementById('flowmeter');
			if (meter && stream) {
				try {
					var AC = window.AudioContext || window.webkitAudioContext;
					var ac = new AC(); this._flowUi.ac = ac;
					var an = ac.createAnalyser(); an.fftSize = 64;
					ac.createMediaStreamSource(stream).connect(an);
					var data = new Uint8Array(an.frequencyBinCount);
					var bars = meter.children;
					var draw = function () {
						if (!self._flowUi) return;
						an.getByteFrequencyData(data);
						for (var i = 0; i < bars.length; i++) {
							var v = data[Math.floor((i / bars.length) * data.length)] / 255;
							bars[i].style.height = Math.max(3, Math.round(v * 22)) + 'px';
							bars[i].style.opacity = String(0.35 + v * 0.65);
						}
						self._flowUi.raf = requestAnimationFrame(draw);
					};
					draw();
				} catch (e) { /* no meter — recording still works */ }
			}
		}
		_flowUiBump() { // built-in speech has no stream: pulse the meter on each recognized chunk
			var meter = this.shadowRoot.getElementById('flowmeter'); if (!meter) return;
			Array.prototype.forEach.call(meter.children, function (b) {
				b.style.height = Math.max(4, Math.round(Math.random() * 20)) + 'px';
				b.style.opacity = '0.9';
			});
		}
		_flowUiStop() {
			if (this._flowUi) {
				clearInterval(this._flowUi.int);
				cancelAnimationFrame(this._flowUi.raf);
				if (this._flowUi.ac) { try { this._flowUi.ac.close(); } catch (e) { /* noop */ } }
				this._flowUi = null;
			}
			var halo = this.shadowRoot.getElementById('halo');
			if (halo) halo.setAttribute('style', halo.getAttribute('data-base') + this._haloCss(this._thinking ? 'thinking' : (this._realtime ? 'realtime' : '')));
			if (!this._realtime && !this._min) this._sync();
		}
		_flowCancel() {
			this._flowUiStop();
			if (this._flow) { this._flow.stop = true; try { this._flow.rec && this._flow.rec.stop(); } catch (e) { /* noop */ } try { if (this._flow.recorder && this._flow.recorder.state !== 'inactive') this._flow.recorder.stop(); } catch (e2) { /* noop */ } try { if (this._flow.stream) this._flow.stream.getTracks().forEach(function (t2) { t2.stop(); }); } catch (e3) { /* noop */ } this._flow = null; }
			var panel = this.shadowRoot.getElementById('flowpanel'); if (panel) panel.style.display = 'none';
			var liveEl = this.shadowRoot.getElementById('flowlive'); if (liveEl) liveEl.textContent = 'Listening…';
		}
		_flowFinish() {
			var self = this;
			if (!this._flow) return;
			this._recSound(false);
			this._flowUiStop();
			var liveEl = this.shadowRoot.getElementById('flowlive');
			// Clip mode: stop the recorder, ship the audio to the provider, then run the pipeline.
			if (this._flow.mode === 'clip') {
				var fl = this._flow; this._flow = null;
				clearTimeout(fl.capT);
				try { fl.recorder && fl.recorder.stop(); } catch (e0) { /* noop */ }
				var finish = function () {
					try { fl.stream && fl.stream.getTracks().forEach(function (tk) { tk.stop(); }); } catch (e1) { /* noop */ }
					var blob = new Blob(fl.chunks, { type: 'audio/webm' });
					if (!blob.size) { self._flowCancel(); return; }
					if (liveEl) liveEl.textContent = 'Transcribing…';
					self._transcribe(blob).then(function (text) {
						if (!text) { if (liveEl) liveEl.textContent = 'Nothing heard — try again.'; return; }
						self._flowDeliver(text);
					}).catch(function (err) {
						if (liveEl) liveEl.textContent = 'Transcription failed: ' + (err && err.message ? err.message : 'check the model key/URL in Settings → Transcription.');
						self._flow = null;
					});
				};
				if (fl.recorder && fl.recorder.state !== 'inactive') { fl.recorder.onstop = finish; } else { finish(); }
				return;
			}
			this._flow.stop = true; try { this._flow.rec.stop(); } catch (e) { /* noop */ }
			var raw = ((this._flow.final || '') + '').trim() || (liveEl && liveEl.textContent !== 'Listening…' ? String(liveEl.textContent || '').trim() : '');
			this._flow = null;
			if (!raw) { this._flowCancel(); return; }
			this._flowDeliver(raw);
			return;
		}
		/* Shared post-transcription pipeline: dictionary → optional AI polish → route + history. */
		_flowDeliver(raw) {
			var self = this;
			raw = this._applyDictionary(raw);
			var liveEl = this.shadowRoot.getElementById('flowlive');
			var target = localStorage.getItem('chi-flow-target') || 'composer';
			var polish = localStorage.getItem('chi-flow-polish') !== '0';
			var deliver = function (text) {
				self._pushHistory(text);
				self._flowCancel();
				if (target === 'chi') { self._send(text); return; }
				if (target === 'copy') {
					try { navigator.clipboard.writeText(text); } catch (e) { /* noop */ }
					var st = self.shadowRoot.getElementById('status'); if (st) { st.textContent = 'COPIED'; setTimeout(function () { self._sync(); }, 1200); }
					self._pluck();
					return;
				}
				// composer (default): the host inserts into the message box (or relays/copies).
				self.dispatchEvent(new CustomEvent('chi-flow-insert', { detail: { text: text }, bubbles: true, composed: true }));
				var st2 = self.shadowRoot.getElementById('status'); if (st2) { st2.textContent = 'SENT TO COMPOSER'; setTimeout(function () { self._sync(); }, 1400); }
				self._pluck();
			};
			if (polish && this.ask) {
				if (liveEl) liveEl.textContent = 'Polishing…';
				var vocabHint = (localStorage.getItem('chi-vocab') || '').trim();
				var prompt = 'Clean up this dictation into well-punctuated, natural text. Keep the meaning and tone, remove filler words and false starts.' + (vocabHint ? ' Preserve these terms exactly: ' + vocabHint.slice(0, 400) + '.' : '') + ' Reply with ONLY the cleaned text, nothing else:\n\n' + raw;
				Promise.resolve().then(function () { return self.ask(prompt, []); })
					.then(function (r2) { var out = (r2 && typeof r2 === 'object') ? r2.reply : r2; deliver(String(out || raw).trim() || raw); })
					.catch(function () { deliver(raw); });
			} else {
				deliver(raw);
			}
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
			var self = this;
			// Reply-to-notification lane: routes back to the SENDER (host onreply → the real room in
			// Phase 2; demo ack otherwise). Never enters the Chi ask/think path.
			if (this._replyTo) {
				var target = this._replyTo;
				this._replyTo = null;
				this.history.push({ who: 'me', text: text });
				this._sync(); this._syncReplyBar();
				var ack = function () {
					self.history.push({ kind: 'notif', sender: target.sender, app: 'Reply', color: target.color, avatar: target.avatar, text: 'Got it — thanks! 👍' });
					self._sync();
				};
				if (this.onreply) {
					Promise.resolve().then(function () { return self.onreply(target, text); }).then(function () {
						self.history.push({ kind: 'notif', sender: target.sender, app: 'Sent', color: target.color, avatar: target.avatar, text: 'Reply sent ✓' });
						self._sync();
					}).catch(function () {
						self.history.push({ kind: 'notif', sender: target.sender, app: 'Failed', color: '#e0483d', avatar: '!', text: 'Reply failed — try again.' });
						self._sync();
					});
				} else { setTimeout(ack, 1400); }
				return;
			}
			this.history.push({ who: 'me', text: text });
			this._pluck();
			this._thinking = true; this._sync();
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
			list.innerHTML = '';
			this.history.forEach(function (m) {
				if (m.kind === 'notif') { list.appendChild(self._notifCard(m)); return; }
				if (m.kind === 'digest') { list.appendChild(self._digestCard(m)); return; }
				var d0 = document.createElement('div');
				d0.setAttribute('style', self._bubble(m));
				d0.textContent = m.text;
				list.appendChild(d0);
			});
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

		/* ---- MatterChat notifications inside Chi -------------------------------------------------
		 * Host API: orb.notify({ sender, text, app, color, avatar, data }). Behavior follows the
		 * settings toggle: ROUTED (chi-notif-route=1) → a rich card lands in the conversation with
		 * a Reply chip; not routed → a transient banner slides across the top of the glass. Both
		 * chime (Sounds toggle). Reply opens a "Replying to X" bar over the input; sending routes
		 * through orb.onreply(target, text) when the host provides it (Phase 2 wires this to the
		 * real room), else a demo ack card answers. */
		notify(n) {
			n = n || {};
			var m = {
				kind: 'notif',
				sender: String(n.sender || 'Someone'),
				text: String(n.text || ''),
				app: String(n.app || 'MatterChat'),
				color: String(n.color || '#4a6cf7'),
				avatar: String(n.avatar || String(n.sender || '?').charAt(0).toUpperCase()),
				data: n.data,
			};
			this._lastNotif = m; // hover-peek on the minimized launcher shows the latest
			// Focus mode or minimized → QUEUE quietly (focus = fully silent; minimized still chimes
			// once) and light the amber presence glow. The queue flushes on expand / focus end —
			// as individual cards, or as one digest when a lot piled up.
			if (this._focusActive() || this._min) {
				this._pending.push(m);
				this._unseen++;
				if (!this._focusActive()) { this._chime(); }
				if (this._min) this._render(); // repaint launcher: amber glow + unseen badge
				return m;
			}
			var routed = localStorage.getItem('chi-notif-route') === '1';
			if (routed) {
				this.history.push(m);
				if (!this._realtime) this._sync();
			} else if (!this._realtime) {
				this._banner(m);
			}
			this._chime();
			return m;
		}
		_focusActive() { return (parseFloat(localStorage.getItem('chi-focus-until')) || 0) > Date.now(); }
		/* Live voice captions — the host streams what's being heard/said during realtime:
		 * orb.caption('me'|'chi', text). Shows the last two lines under LISTENING…, latest brightest. */
		caption(who, text) {
			this._caps.push({ who: who === 'chi' ? 'chi' : 'me', text: String(text || '').slice(0, 160) });
			this._caps = this._caps.slice(-2);
			if (!this._realtime || this._min) return;
			var box = this.shadowRoot.getElementById('caps');
			if (!box) return;
			box.innerHTML = '';
			var self = this;
			this._caps.forEach(function (c, i) {
				var d = document.createElement('div');
				d.setAttribute('style', 'font-size:11.5px;line-height:1.35;text-align:center;animation:chiMsgIn .3s ease both;color:' + (c.who === 'chi' ? GREEN : '#9fc6ff') + ';opacity:' + (i === self._caps.length - 1 ? '.95' : '.5') + ';');
				d.textContent = c.text;
				box.appendChild(d);
			});
		}
		/* ---- Focus dial: drag along the METAL RING to wind up a focus timer (like turning a
		 * Nest). 5-minute detents with ticks; a blue arc shows the wound time, then counts down.
		 * While focused: notifications queue silently. On the bell: digest + chime. Tap the
		 * countdown chip to end early. ---- */
		_startFocus(mins) {
			var until = Date.now() + mins * 60000;
			localStorage.setItem('chi-focus-until', String(until));
			localStorage.setItem('chi-focus-total', String(mins * 60000));
			this._chime();
			this._focusEnsure();
		}
		_focusEnsure() {
			var self = this;
			clearInterval(this._focusInt);
			if (!this._focusActive()) { this._focusPaint(0, 0); return; }
			this._focusInt = setInterval(function () { self._focusTickUi(); }, 1000);
			this._focusTickUi();
		}
		_focusTickUi() {
			var until = parseFloat(localStorage.getItem('chi-focus-until')) || 0;
			var total = parseFloat(localStorage.getItem('chi-focus-total')) || 1;
			var rem = until - Date.now();
			if (rem <= 0) { this._endFocus(false); return; }
			this._focusPaint(rem / total, rem);
		}
		_focusPaint(frac, remMs) {
			var r = this.shadowRoot;
			var arc = r.getElementById('focusarc'), chip = r.getElementById('focuschip');
			if (!arc || !chip) return;
			if (frac <= 0) { arc.style.opacity = '0'; chip.style.display = 'none'; return; }
			var deg = Math.max(4, frac * 360);
			arc.style.opacity = '1';
			arc.style.background = 'conic-gradient(from -90deg, rgba(59,155,255,.95) 0deg ' + deg + 'deg, transparent ' + deg + 'deg)';
			var mm = Math.floor(remMs / 60000), ss = Math.floor((remMs % 60000) / 1000);
			chip.style.display = 'flex';
			chip.textContent = '🌙 Focus ' + mm + ':' + (ss < 10 ? '0' : '') + ss + ' — tap to end';
		}
		_endFocus(early) {
			clearInterval(this._focusInt);
			localStorage.removeItem('chi-focus-until');
			localStorage.removeItem('chi-focus-total');
			this._focusPaint(0, 0);
			if (!early) this._chime();
			if (!this._min) { this._flushPending(); if (!this._realtime) this._sync(); }
			else if (this._pending.length) this._render(); // launcher badge reflects the queue
		}
		/* Flush queued notifications into the conversation: ≥4 collapse into a catch-up digest. */
		_flushPending() {
			var p = this._pending;
			this._pending = [];
			this._unseen = 0;
			if (!p.length) return;
			if (p.length >= 4) {
				var seen = {}, senders = [];
				p.forEach(function (m) { if (!seen[m.sender]) { seen[m.sender] = 1; senders.push(m.sender); } });
				this.history.push({ kind: 'digest', count: p.length, senders: senders, items: p });
			} else {
				var h = this.history;
				p.forEach(function (m) { h.push(m); });
			}
		}
		_digestCard(m) {
			var self = this, t = this._theme;
			var card = document.createElement('div');
			card.setAttribute('style', 'align-self:stretch;display:flex;gap:10px;padding:11px 13px;border-radius:16px;animation:chiMsgIn .45s cubic-bezier(.2,.75,.25,1) both;box-shadow:0 10px 26px -12px rgba(0,0,0,.55);' + (t.card || t.chi));
			var moon = document.createElement('div');
			moon.setAttribute('style', 'width:30px;height:30px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(59,155,255,.16);border:1px solid rgba(59,155,255,.35);');
			moon.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M13.5 9.5 A6 6 0 1 1 6.5 2.5 A4.8 4.8 0 0 0 13.5 9.5 Z" fill="none" stroke="' + ACCENT + '" stroke-width="1.4" stroke-linejoin="round"/></svg>';
			var body = document.createElement('div');
			body.setAttribute('style', 'flex:1;min-width:0;');
			var title = document.createElement('div');
			title.setAttribute('style', 'font-size:12px;font-weight:800;');
			title.textContent = 'While you were away';
			var line = document.createElement('div');
			line.setAttribute('style', 'margin-top:2px;font-size:12px;line-height:1.4;opacity:.8;');
			line.textContent = m.count + ' message' + (m.count === 1 ? '' : 's') + ' from ' + m.senders.slice(0, 3).join(', ') + (m.senders.length > 3 ? ' +' + (m.senders.length - 3) + ' more' : '');
			var btns = document.createElement('div');
			btns.setAttribute('style', 'margin-top:8px;display:flex;gap:7px;');
			var run = document.createElement('div');
			run.setAttribute('style', 'display:inline-flex;align-items:center;padding:4px 13px;border-radius:12px;cursor:pointer;font-size:10.5px;font-weight:700;background:rgba(48,209,88,.9);color:#fff;box-shadow:0 2px 8px rgba(48,209,88,.4);');
			run.textContent = 'Give me the rundown';
			run.addEventListener('click', function () { self._send('Catch me up — what did I miss while I was away?'); });
			var show = document.createElement('div');
			show.setAttribute('style', 'display:inline-flex;align-items:center;padding:4px 13px;border-radius:12px;cursor:pointer;font-size:10.5px;font-weight:600;' + t.chip);
			show.textContent = 'Show them';
			show.addEventListener('click', function () {
				var i = self.history.indexOf(m);
				if (i !== -1) { var args = [i, 1].concat(m.items); Array.prototype.splice.apply(self.history, args); self._sync(); }
			});
			btns.appendChild(run); btns.appendChild(show);
			body.appendChild(title); body.appendChild(line); body.appendChild(btns);
			card.appendChild(moon); card.appendChild(body);
			return card;
		}
		_notifCard(m) {
			var self = this, t = this._theme;
			var card = document.createElement('div');
			card.setAttribute('style', 'align-self:flex-start;max-width:92%;display:flex;gap:9px;padding:9px 11px;border-radius:4px 16px 16px 16px;animation:chiMsgIn .45s cubic-bezier(.2,.75,.25,1) both;box-shadow:0 10px 26px -12px rgba(0,0,0,.55);border-left:3px solid ' + m.color + ';' + (t.card || t.chi));
			var av = document.createElement('div');
			av.setAttribute('style', 'width:30px;height:30px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.35), 0 3px 8px rgba(0,0,0,.35);background:linear-gradient(160deg, ' + m.color + ', ' + m.color + 'cc);');
			av.textContent = m.avatar;
			var body = document.createElement('div');
			body.setAttribute('style', 'flex:1;min-width:0;');
			var head = document.createElement('div');
			head.setAttribute('style', 'display:flex;align-items:center;gap:6px;');
			var sender = document.createElement('div');
			sender.setAttribute('style', 'font-size:11.5px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
			sender.textContent = m.sender;
			var app = document.createElement('div');
			app.setAttribute('style', 'margin-left:auto;font-size:8px;font-weight:800;letter-spacing:.5px;opacity:.5;text-transform:uppercase;');
			app.textContent = m.app;
			head.appendChild(sender); head.appendChild(app);
			var txt = document.createElement('div');
			txt.setAttribute('style', 'margin-top:2px;font-size:12.5px;line-height:1.4;');
			txt.textContent = m.text;
			var reply = document.createElement('div');
			reply.setAttribute('style', 'margin-top:7px;display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:12px;cursor:pointer;font-size:10.5px;font-weight:700;background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.34);color:' + GREEN + ';');
			reply.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M5 2 L2 5 L5 8 M2.5 5 H8 a2 2 0 0 1 2 2 v2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>Reply';
			reply.addEventListener('click', function () { self._replyTo = m; self._syncReplyBar(); });
			body.appendChild(head); body.appendChild(txt); body.appendChild(reply);
			card.appendChild(av); card.appendChild(body);
			return card;
		}
		_syncReplyBar() {
			var r = this.shadowRoot, bar = r.getElementById('replybar');
			if (!bar) return;
			if (this._replyTo) {
				bar.style.display = 'flex';
				var nm = r.getElementById('replyname'); if (nm) nm.textContent = 'Replying to ' + this._replyTo.sender;
				var inp = r.getElementById('in'); if (inp) inp.focus();
			} else {
				bar.style.display = 'none';
			}
		}
		_banner(m) {
			var r = this.shadowRoot, win = r.getElementById('win');
			if (!win) return;
			var self = this, t = this._theme;
			var old = r.getElementById('notifbanner'); if (old) old.remove();
			var wrap = document.createElement('div');
			wrap.id = 'notifbanner';
			wrap.setAttribute('style', 'position:absolute;top:29%;left:50%;transform:translate(-50%,-16px);z-index:8;width:64%;opacity:0;transition:opacity .4s ease, transform .5s cubic-bezier(.2,.85,.3,1);');
			var card = this._notifCard(m);
			card.style.animation = 'none';
			card.style.alignSelf = '';
			card.style.borderRadius = '15px';
			card.style.boxShadow = '0 18px 38px -14px rgba(0,0,0,.6)';
			// banner Reply also opens the reply bar (and dismisses the banner)
			wrap.appendChild(card);
			win.appendChild(wrap);
			requestAnimationFrame(function () { wrap.style.opacity = '1'; wrap.style.transform = 'translate(-50%,0)'; });
			clearTimeout(this._bannerT);
			this._bannerT = setTimeout(function () {
				wrap.style.opacity = '0'; wrap.style.transform = 'translate(-50%,-16px)';
				setTimeout(function () { wrap.remove(); }, 450);
			}, 4600);
		}
		/* Soft send "pluck" — low, quick, quieter than the detent tick. */
		_pluck() {
			if (localStorage.getItem('chi-orb-sound') === '0') return;
			try {
				var C = this._ac || (this._ac = new (window.AudioContext || window.webkitAudioContext)());
				if (C.state === 'suspended') C.resume();
				var t0 = C.currentTime;
				var o = C.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(340, t0); o.frequency.exponentialRampToValueAtTime(210, t0 + 0.07);
				var g = C.createGain(); g.gain.setValueAtTime(0.045, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
				o.connect(g); g.connect(C.destination); o.start(t0); o.stop(t0 + 0.1);
			} catch (e) { /* silent */ }
		}
		/* Soft two-note arrival chime (distinct from the drum tick). Sounds toggle gated. */
		_chime() {
			if (localStorage.getItem('chi-orb-sound') === '0') return;
			try {
				var C = this._ac || (this._ac = new (window.AudioContext || window.webkitAudioContext)());
				if (C.state === 'suspended') C.resume();
				var t0 = C.currentTime;
				[[660, 0, 0.10], [990, 0.09, 0.14]].forEach(function (nte) {
					var o = C.createOscillator(); o.type = 'sine'; o.frequency.value = nte[0];
					var g = C.createGain();
					g.gain.setValueAtTime(0.0001, t0 + nte[1]);
					g.gain.exponentialRampToValueAtTime(0.05, t0 + nte[1] + 0.02);
					g.gain.exponentialRampToValueAtTime(0.0001, t0 + nte[1] + nte[2]);
					o.connect(g); g.connect(C.destination); o.start(t0 + nte[1]); o.stop(t0 + nte[1] + nte[2] + 0.02);
				});
			} catch (e) { /* audio unavailable — stay silent */ }
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
					el._drum.cache = null; // offsets shifted — stale cache caused wild tilts at rest
					self._drumApply(el);
				});
			}
			this._drumApply(el);
		}
		_drumApply(el) {
			if (!el || !el._drum || REDUCED) return;
			var d = el._drum, k = d.k;
			// Geometry cache — offsetTop/height read ONCE per content change, never per frame.
			// (getBoundingClientRect per row per frame forced a full layout pass each scroll tick —
			// that was the lag.) el is position:relative so offsetTop is list-local.
			if (!d.cache || d.count !== el.children.length) {
				el.style.position = 'relative';
				d.count = el.children.length;
				d.cache = [];
				for (var j = 0; j < el.children.length; j++) {
					var ch = el.children[j];
					if (!ch._drumInit) { ch._drumInit = 1; ch.style.willChange = 'transform, opacity'; }
					d.cache.push({ el: ch, mid: ch.offsetTop + ch.offsetHeight / 2, f: '' });
				}
			}
			var viewMid = el.scrollTop + el.clientHeight / 2;
			var half = el.clientHeight / 2 || 1;
			var nearest = -1, nearestDist = 1e9;
			for (var i = 0; i < d.cache.length; i++) {
				var e = d.cache[i], c = e.el;
				var off = (e.mid - viewMid) / half; // -1 (top rim) … 0 (center) … 1 (bottom rim)
				if (off < -1.3 || off > 1.3) { if (e.hid !== 1) { e.hid = 1; c.style.visibility = 'hidden'; } continue; }
				if (e.hid !== 0) { e.hid = 0; c.style.visibility = ''; }
				var t = Math.max(-1, Math.min(1, off));
				var a = Math.abs(t);
				if (a < nearestDist) { nearestDist = a; nearest = i; }
				var th = t * (Math.PI / 2) * 0.58;                    // row's angle on the cylinder (max ~52°)
				var rot = (-th * 180 / Math.PI) * k;                  // tilt away toward the rim
				var z = -(1 - Math.cos(th)) * 88 * k;                 // true cos-recession into the drum
				var ty = -Math.sin(th) * a * 6 * k;                   // gentle wrap pull (small — rows must never collide)
				var sc = 1 - a * a * 0.06 * k;                        // gentle ease-squared shrink
				var base = c.getAttribute('data-drum-base') || '';
				// direct, frame-locked writes (no CSS transition fighting the scroll) + translateZ keeps
				// each row on its own GPU layer → silk
				c.style.transform = base + ' rotateX(' + rot.toFixed(2) + 'deg) translateZ(' + z.toFixed(1) + 'px) translateY(' + ty.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
				// rim rows dissolve BEFORE they can visually stack — steeper opacity curve than the tilt
				c.style.opacity = String(Math.max(0, 1 - a * a * 0.72 * k).toFixed(3));
				// rim dim: brightness only (blur per-row per-frame is a GPU stall), quantized so the
				// style string only changes when the value meaningfully moves
				var fil = a > 0.5 ? 'brightness(' + (Math.round((1 - (a - 0.5) * 0.55 * k) * 20) / 20) + ')' : '';
				if (fil !== e.f) { e.f = fil; c.style.filter = fil; }
			}
			// Detent tick: a new row crossed the center while the user was actually scrolling.
			if (nearest !== -1 && nearest !== d.idx) {
				var was = d.idx;
				d.idx = nearest;
				if (was !== -1 && Date.now() - d.scrolling < 140) this._tick();
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
				'<div id="shell" style="position:relative;width:520px;height:520px;transform:scale(' + this._scale + ');transform-origin:' + (winCtrl ? '50% 50%' : '50% 100%') + ';">' +
				'<div id="halo" data-base="' + haloBase + '" style="' + haloBase + this._haloCss(this._realtime ? 'realtime' : '') + '"></div>' +
				// 1 · stainless band (full bleed to the rim)
				'<div style="position:absolute;inset:0;border-radius:50%;pointer-events:none;background:' + steel + ';box-shadow:' + (winCtrl ? '' : '0 70px 130px -34px rgba(0,0,0,.82), 0 26px 60px -18px rgba(0,0,0,.55), 0 6px 16px rgba(0,0,0,.5), ') + 'inset 0 2px 3px rgba(255,255,255,.9), inset 0 -3px 6px rgba(0,0,0,.45);"></div>' +
				// 1.5 · radial brush texture (fine spokes, like spun metal)
				'<div style="position:absolute;inset:0;border-radius:50%;pointer-events:none;background:repeating-conic-gradient(rgba(255,255,255,.10) 0deg .18deg, transparent .18deg 1.9deg);opacity:.5;-webkit-mask:radial-gradient(circle, transparent 87%, black 88%);mask:radial-gradient(circle, transparent 87%, black 88%);"></div>' +
				// 2 · machined knurl texture on the band
				'<div style="position:absolute;inset:2px;border-radius:50%;pointer-events:none;background:repeating-conic-gradient(rgba(255,255,255,.28) 0deg .5deg, rgba(0,0,0,.22) .5deg 1.6deg);opacity:.32;-webkit-mask:radial-gradient(circle, transparent 91%, black 92%);mask:radial-gradient(circle, transparent 91%, black 92%);"></div>' +
				// 3 · finish tint (Steel = none; live-updated by the settings hue slider without a re-render)
				//     two layers: `color` blend carries the hue, `multiply` deepens it to dark anodized metal.
				'<div id="tint" style="position:absolute;inset:0;border-radius:50%;pointer-events:none;mix-blend-mode:color;background:' + f.tint + ';"></div>' +
				'<div id="tintshade" style="position:absolute;inset:0;border-radius:50%;pointer-events:none;mix-blend-mode:multiply;opacity:.42;background:' + (f.tint === 'transparent' ? 'transparent' : f.tint) + ';"></div>' +
				// 4 · slow specular sweep — light traveling around the metal
				'<div style="position:absolute;inset:0;border-radius:50%;pointer-events:none;overflow:hidden;' + ringMask + '"><div style="position:absolute;inset:-2%;background:conic-gradient(from 0deg, transparent 0 8%, rgba(255,255,255,.5) 11%, transparent 15%, transparent 55%, rgba(255,255,255,.25) 58%, transparent 62%);mix-blend-mode:screen;animation:chiSweep 14s linear infinite;"></div></div>' +
				// 4.2 · faint counter-rotating under-sweep (depth in the metal)
				'<div style="position:absolute;inset:0;border-radius:50%;pointer-events:none;overflow:hidden;' + ringMask + '"><div style="position:absolute;inset:-2%;background:conic-gradient(from 180deg, transparent 0 30%, rgba(255,255,255,.12) 33%, transparent 37%);mix-blend-mode:screen;animation:chiSweep 23s linear infinite reverse;"></div></div>' +
				// 4.5 · focus-dial arc — the wound/remaining time drawn on the metal band
				'<div id="focusarc" style="position:absolute;inset:3px;border-radius:50%;pointer-events:none;opacity:0;transition:opacity .3s;-webkit-mask:radial-gradient(circle, transparent 89.5%, black 90.5%);mask:radial-gradient(circle, transparent 89.5%, black 90.5%);filter:drop-shadow(0 0 7px rgba(59,155,255,.9));"></div>' +
				// 5 · inner bevel ring (dark machined step down to the glass)
				'<div style="position:absolute;inset:15px;border-radius:50%;pointer-events:none;background:conic-gradient(from 20deg, #43474c, #14161a 25%, #3a3e44 50%, #101216 75%, #43474c);box-shadow:inset 0 1px 2px rgba(255,255,255,.35)' + (winCtrl ? '' : ', 0 2px 6px rgba(0,0,0,.6)') + ';"></div>' +
				// 6 · black glass face
				'<div id="win" style="position:absolute;inset:26px;border-radius:50%;overflow:hidden;display:flex;flex-direction:column;background:' + t.win + ';border:1px solid ' + t.winBorder + ';box-shadow:inset 0 3px 10px rgba(255,255,255,.07), inset 0 -6px 14px rgba(0,0,0,.35), ' + t.vignette + ';">' +
					'<div style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 60% 34% at 32% 12%, ' + t.glow + ', transparent 65%);"></div>' +
					// etched tick ring just inside the glass rim
					'<div style="position:absolute;inset:0;pointer-events:none;border-radius:50%;background:repeating-conic-gradient(' + t.tick + ' 0deg .4deg, transparent .4deg 3.6deg);opacity:' + t.tickOp + ';-webkit-mask:radial-gradient(circle, transparent 88.5%, black 89.5%, black 95%, transparent 96%);mask:radial-gradient(circle, transparent 88.5%, black 89.5%, black 95%, transparent 96%);"></div>' +
					arc +
					innerHTML +
				'</div>' +
				// top grip handle (drag) — the mockup's hanging tab: a frosted 6-dot grip flush with the
				// top edge, rounded only at the bottom. Pointer drag is owned by the host.
				'<div id="grip" title="Drag to move" style="position:absolute;top:-1px;left:50%;transform:translateX(-50%);z-index:7;padding:3px 11px 4px;border-radius:0 0 11px 11px;display:flex;align-items:center;gap:3px;cursor:grab;touch-action:none;background:rgba(14,16,20,.7);border:1px solid rgba(255,255,255,.14);border-top:none;box-shadow:0 3px 9px rgba(0,0,0,.45);backdrop-filter:blur(8px);color:rgba(255,255,255,.7);transition:background .18s, color .18s;">' +
					'<svg width="17" height="8" viewBox="0 0 18 8"><circle cx="4" cy="2.5" r="1.15" fill="currentColor"/><circle cx="9" cy="2.5" r="1.15" fill="currentColor"/><circle cx="14" cy="2.5" r="1.15" fill="currentColor"/><circle cx="4" cy="5.5" r="1.15" fill="currentColor"/><circle cx="9" cy="5.5" r="1.15" fill="currentColor"/><circle cx="14" cy="5.5" r="1.15" fill="currentColor"/></svg></div>' +
				'<div id="focuschip" style="position:absolute;left:50%;bottom:34px;transform:translateX(-50%);z-index:8;display:none;align-items:center;padding:4px 13px;border-radius:12px;font-size:10.5px;font-weight:700;cursor:pointer;background:rgba(14,18,24,.92);border:1px solid rgba(59,155,255,.5);color:#8fc2ff;box-shadow:0 4px 14px rgba(0,0,0,.5);white-space:nowrap;"></div>' +
				// minimize stays reachable on the OUTSIDE too (founder direction): the classic
				// collapse-to-ensō chrome button on the ring, top-right, in every mode.
				'<div id="ringminbtn" class="ctl" title="Collapse to the ensō" style="position:absolute;top:74px;right:74px;z-index:7;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;' + t.ctrl + '"><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5V6H2.5M8 11.5V8h3.5"/><path d="M6 6 2.75 2.75M8 8l3.25 3.25"/></svg></div>' +
				'</div>';
		}

		/* ---- the ⚙ settings overlay (full glass face, drum-scrolled) ----
		 * Panels: main ▸ models (cloud + LOCAL LLMs, EvidenceHunt-style) ▸ caps (every assistant
		 * capability — LIVE today or SOON as the build reminder) ▸ connections (Omnis products,
		 * MCPs, email, integrations). All interactions mutate in place — no re-render glitches. */
		_settingsHTML() {
			var t = this._theme, f = this._frame, self = this;
			var panel = this._settingsPanel;
			var row = function (inner, extra) {
				return '<div class="srow" data-drum-base="" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 2px;border-bottom:1px solid rgba(128,128,128,.16);' + (extra || '') + '">' + inner + '</div>';
			};
			var chev = '<svg width="12" height="12" viewBox="0 0 16 16"><path d="M6 3 L11 8 L6 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
			var sw = function (on, id, disabled) {
				return '<div ' + (id ? 'id="' + id + '" ' : '') + 'class="sw' + (disabled ? ' swoff' : '') + '" style="width:34px;height:20px;border-radius:11px;cursor:' + (disabled ? 'default' : 'pointer') + ';padding:2px;box-sizing:border-box;flex-shrink:0;transition:background .2s;background:' + (on ? GREEN : 'rgba(140,140,150,.45)') + ';' + (disabled ? 'opacity:.35;' : '') + '">' +
					'<div style="width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .2s;transform:translateX(' + (on ? 15 : 1) + 'px)"></div></div>';
			};
			var badge = function (txt, live) {
				return live
					? '<span style="font-size:8.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:8px;background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.35);color:' + GREEN + ';">LIVE</span>'
					: '<span style="font-size:8.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:8px;background:rgba(128,128,128,.14);border:1px solid rgba(128,128,128,.25);opacity:.65;">' + (txt || 'SOON') + '</span>';
			};
			var nav = function (label, dest, icon) {
				return '<div class="srow" data-drum-base="" data-nav="' + dest + '" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 2px;border-bottom:1px solid rgba(128,128,128,.16);cursor:pointer;">' +
					'<span style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;">' + icon + label + '</span><span style="display:inline-flex;opacity:.6;">' + chev + '</span></div>';
			};
			var body = '';
			var titles = { main: 'Settings', models: 'Language models', caps: 'Capabilities', connections: 'Connections', stt: 'Transcription', dict: 'Dictionary', modes: 'Modes', history: 'History', audio: 'Audio', whatsnew: 'What’s new' };
			if (panel === 'main') {
				body =
					row('<span style="font-size:12px;opacity:.85;">Size</span>' +
						'<span style="display:flex;align-items:center;gap:8px;">' +
						'<span id="s-shrink" class="sbtn" style="width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(128,128,128,.16);"><svg width="12" height="12" viewBox="0 0 16 16"><path d="M3.5 8 h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>' +
						'<span id="s-pct" style="font-size:11.5px;opacity:.7;min-width:34px;text-align:center;font-variant-numeric:tabular-nums;">' + Math.round(this._scale * 100) + '%</span>' +
						'<span id="s-grow" class="sbtn" style="width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(128,128,128,.16);"><svg width="12" height="12" viewBox="0 0 16 16"><path d="M8 3.5 v9 M3.5 8 h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span></span>') +
					row('<span style="font-size:12px;opacity:.85;">Theme</span><span id="s-theme" style="display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.75;text-transform:capitalize;cursor:pointer;">' + this._themeKey + ' ' + chev + '</span>') +
					row('<span style="font-size:12px;opacity:.85;">Frame</span><span style="display:flex;align-items:center;gap:6px;">' +
						FRAME_ORDER.map(function (k2) {
							var sel = k2 === (localStorage.getItem('chi-orb-frame') || 'steel');
							return '<span class="fdot" data-frame="' + k2 + '" title="' + FRAMES[k2].name + '" style="width:15px;height:15px;border-radius:50%;cursor:pointer;box-shadow:inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.35)' + (sel ? ', 0 0 0 2px ' + GREEN : '') + ';background:' + FRAMES[k2].swatch + ';"></span>';
						}).join('') +
						'<span id="s-swatch" title="Custom" style="width:15px;height:15px;border-radius:50%;box-shadow:inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.35)' + (this._frameKey === 'custom' ? ', 0 0 0 2px ' + GREEN : '') + ';background:' + (this._frameKey === 'custom' ? f.swatch : 'conic-gradient(red,#ff0,#0f0,#0ff,#00f,#f0f,red)') + ';"></span></span>') +
					row('<span id="s-pad" style="position:relative;flex:1;height:58px;border-radius:10px;cursor:crosshair;touch-action:none;background:linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(' + this._frameHue + ',100%,50%));box-shadow:inset 0 1px 4px rgba(0,0,0,.5);">' +
						'<span id="s-padknob" style="position:absolute;left:' + this._frameSat.toFixed(0) + '%;top:' + Math.min(100, Math.max(0, (1 - (this._frameLum - 6) / 88) * 100)).toFixed(0) + '%;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:hsl(' + this._frameHue + ',' + this._frameSat + '%,' + this._frameLum + '%);border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.55);pointer-events:none;"></span></span>', 'border-bottom:none;padding-bottom:4px;') +
					row('<span id="s-hue" style="position:relative;flex:1;height:14px;border-radius:7px;cursor:ew-resize;touch-action:none;background:linear-gradient(90deg, hsl(0,72%,52%), hsl(60,72%,52%), hsl(120,72%,52%), hsl(180,72%,52%), hsl(240,72%,52%), hsl(300,72%,52%), hsl(360,72%,52%));box-shadow:inset 0 1px 3px rgba(0,0,0,.45);">' +
						'<span id="s-hueknob" style="position:absolute;top:50%;left:' + (this._frameHue / 360 * 100).toFixed(1) + '%;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;background:hsl(' + this._frameHue + ',72%,52%);border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5);pointer-events:none;"></span></span>') +
					row('<span style="font-size:12px;opacity:.85;">Focus timer</span><span style="display:flex;gap:6px;">' + [15, 25, 45].map(function (mn) { return '<span class="fmin" data-min="' + mn + '" style="padding:3px 10px;border-radius:10px;cursor:pointer;font-size:10.5px;font-weight:700;background:rgba(59,155,255,.14);border:1px solid rgba(59,155,255,.35);color:#8fc2ff;">' + mn + 'm</span>'; }).join('') + '</span>') +
					row('<span style="font-size:12px;opacity:.85;">Sounds</span>' + sw(localStorage.getItem('chi-orb-sound') !== '0', 's-sound')) +
					row('<span style="font-size:12px;opacity:.85;">Route notifications to Chi</span>' + sw(localStorage.getItem('chi-notif-route') === '1', 's-route')) +
					nav('Language models', 'models', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="4" width="12" height="8" rx="2"/><path d="M5.5 8 h.01 M8 8 h.01 M10.5 8 h.01" stroke-linecap="round" stroke-width="2"/></svg>') +
					nav('Transcription', 'stt', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 8.5 c.8 0 .8 -2 1.6 -2 s.8 3 1.6 3 .9 -4 1.8 -4 .9 5 1.8 5 .9 -3.5 1.7 -3.5 .8 1.5 1.6 1.5 .9 -2 1.9 -2"/></svg>') +
					nav('Dictionary', 'dict', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 2.5 h8 a1.5 1.5 0 0 1 1.5 1.5 v9.5 H4.5 A1.5 1.5 0 0 1 3 12 Z" stroke-linejoin="round"/><path d="M3 12 a1.5 1.5 0 0 1 1.5 -1.5 H12.5" stroke-linecap="round"/></svg>') +
					nav('Modes', 'modes', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="5" height="5" rx="1.4"/><rect x="9" y="2" width="5" height="5" rx="1.4"/><rect x="2" y="9" width="5" height="5" rx="1.4"/><rect x="9" y="9" width="5" height="5" rx="1.4"/></svg>') +
					nav('History', 'history', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.5 V8 l2.4 1.6"/></svg>') +
					nav('Audio', 'audio', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="6" y="1.8" width="4" height="7.6" rx="2"/><path d="M3.8 7.6 c0 2.4 1.9 4.3 4.2 4.3 s4.2 -1.9 4.2 -4.3 M8 11.9 v2.3"/></svg>') +
					nav('What’s new', 'whatsnew', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.8 l1.5 3.6 3.9 .3 -3 2.6 .9 3.8 L8 10.2 4.7 12.1 5.6 8.3 2.6 5.7 6.5 5.4 Z"/></svg>') +
					nav('Capabilities', 'caps', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 1.8 L9.8 5.6 14 6.2 11 9.1 11.7 13.3 8 11.3 4.3 13.3 5 9.1 2 6.2 6.2 5.6 Z" stroke-linejoin="round"/></svg>') +
					nav('Connections', 'connections', '<svg width="15" height="15" viewBox="0 0 16 16"><circle cx="4.5" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.5" cy="4" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.5" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.4 7 L9.6 4.8 M6.4 9 L9.6 11.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>') +
					(this._hasPopout() ? row('<span style="font-size:12px;opacity:.85;">Pop out into its own window</span><span style="display:inline-flex;opacity:.6;">' + chev + '</span>', 'cursor:pointer;" data-act="popout') : '') +
					row('<span style="font-size:12px;opacity:.85;">Collapse to the ensō</span><span style="display:inline-flex;opacity:.6;">' + chev + '</span>', 'cursor:pointer;" data-act="collapse');
			} else if (panel === 'models') {
				var cur = localStorage.getItem('chi-model') || 'anthropic';
				var cloud = MODELS.filter(function (m) { return !m.local; });
				var local = MODELS.filter(function (m) { return m.local; });
				var mrow = function (m) {
					var key = localStorage.getItem('chi-llm-' + m.slug + '-key') || '';
					var url = localStorage.getItem('chi-llm-' + m.slug + '-url') || m.url || '';
					var mdl = localStorage.getItem('chi-llm-' + m.slug + '-model') || '';
					var configured = m.local ? !!url : !!key;
					var sel = cur === m.slug;
					return '<div data-drum-base="" style="border-bottom:1px solid rgba(128,128,128,.13);">' +
						'<div class="mrow" data-model="' + m.slug + '" style="display:flex;align-items:center;gap:8px;padding:9px 2px;cursor:pointer;">' +
							'<span class="mradio" data-mradio="' + m.slug + '" style="width:15px;height:15px;border-radius:50%;flex-shrink:0;border:2px solid ' + (sel ? GREEN : 'rgba(128,128,128,.5)') + ';background:' + (sel ? GREEN : 'transparent') + ';box-shadow:' + (sel ? '0 0 8px rgba(48,209,88,.5)' : 'none') + ';"></span>' +
							'<span style="flex:1;min-width:0;font-size:12px;opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + m.name + '</span>' +
							'<span class="mled" style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' + (configured ? GREEN : 'rgba(128,128,128,.4)') + ';box-shadow:' + (configured ? '0 0 6px rgba(48,209,88,.6)' : 'none') + ';"></span>' +
							'<span style="display:inline-flex;opacity:.5;transform:rotate(90deg);">' + chev + '</span>' +
						'</div>' +
						'<div class="med" data-med="' + m.slug + '" style="display:none;padding:2px 2px 10px 25px;">' +
							(m.local
								? '<input class="min" data-store="chi-llm-' + m.slug + '-url" placeholder="Base URL — e.g. ' + (m.url || 'http://localhost:11434') + '" value="' + esc(url) + '" style="width:100%;box-sizing:border-box;margin:3px 0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">'
								: '<input class="min" data-store="chi-llm-' + m.slug + '-key" type="password" placeholder="API key" value="' + esc(key) + '" style="width:100%;box-sizing:border-box;margin:3px 0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">') +
							'<input class="min" data-store="chi-llm-' + m.slug + '-model" placeholder="Model — e.g. ' + m.hint + '" value="' + esc(mdl) + '" style="width:100%;box-sizing:border-box;margin:3px 0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">' +
						'</div>' +
					'</div>';
				};
				body =
					'<div data-drum-base="" style="margin:2px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">Cloud</div>' + cloud.map(mrow).join('') +
					'<div data-drum-base="" style="margin:12px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">On this computer — private, $0</div>' + local.map(mrow).join('') +
					'<div data-drum-base="" style="margin:10px 2px 2px;font-size:11px;line-height:1.5;opacity:.55;">Local models run through Ollama / LM Studio — your messages never leave the machine. ' + badge('SOON') + ' one-click install &amp; hardware-matched model picks.</div>';
			} else if (panel === 'caps') {
				body = CAPS.map(function (g) {
					var head = '<div data-drum-base="" style="display:flex;align-items:center;justify-content:space-between;margin:10px 2px 2px;"><span style="font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">' + g.label + '</span></div>';
					return head + g.items.map(function (it) {
						var on = it.live ? localStorage.getItem('chi-cap-' + it.slug) !== '0' : localStorage.getItem('chi-cap-' + it.slug) === '1';
						return '<div class="srow" data-drum-base="" data-tkey="chi-cap-' + it.slug + '" data-tdef="' + (it.live ? '1' : '0') + '" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);">' +
							'<span style="display:flex;align-items:center;gap:7px;min-width:0;"><span style="font-size:12px;opacity:' + (it.live ? '.92' : '.6') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + it.name + '</span>' + badge('SOON', it.live) + '</span>' + sw(on) + '</div>';
					}).join('');
				}).join('');
			} else if (panel === 'stt') {
				var curStt = localStorage.getItem('chi-stt-model') || 'webspeech';
				var meter = function (v, warm) {
					var dots = '';
					for (var di = 1; di <= 5; di++) dots += '<span style="width:5px;height:5px;border-radius:50%;display:inline-block;margin-right:2px;background:' + (v / 2 >= di ? (warm ? '#f6b93b' : GREEN) : 'rgba(128,128,128,.3)') + ';"></span>';
					return dots;
				};
				var strow = function (m) {
					var keyv = m.keyStore ? (localStorage.getItem(m.keyStore) || '') : '';
					var urlv = m.urlStore ? (localStorage.getItem(m.urlStore) || '') : '';
					var conf = m.builtin || (m.local ? !!urlv : !!keyv);
					var selS = curStt === m.slug;
					return '<div data-drum-base="" style="border-bottom:1px solid rgba(128,128,128,.13);">' +
						'<div class="strow" data-stt="' + m.slug + '" style="display:flex;align-items:center;gap:8px;padding:9px 2px;cursor:pointer;">' +
							'<span class="stradio" data-stradio="' + m.slug + '" style="width:15px;height:15px;border-radius:50%;flex-shrink:0;border:2px solid ' + (selS ? GREEN : 'rgba(128,128,128,.5)') + ';background:' + (selS ? GREEN : 'transparent') + ';"></span>' +
							'<span style="flex:1;min-width:0;font-size:12px;opacity:' + (m.wired ? '.92' : '.6') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + m.name + '</span>' +
							(m.wired ? (m.builtin ? badge('', true) : '') : badge('SOON')) +
							'<span class="stled" style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' + (conf ? GREEN : 'rgba(128,128,128,.4)') + ';"></span>' +
							(m.builtin ? '' : '<span style="display:inline-flex;opacity:.5;transform:rotate(90deg);">' + chev + '</span>') +
						'</div>' +
						(m.builtin ? '' : '<div data-sted="' + m.slug + '" style="display:none;padding:2px 2px 10px 25px;">' +
							(m.urlStore ? '<input class="min" data-store="' + m.urlStore + '" placeholder="' + (m.urlHint || 'Server URL') + '" value="' + esc(urlv) + '" style="width:100%;box-sizing:border-box;margin:3px 0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">' : '') +
							(m.keyStore ? '<input class="min" data-store="' + m.keyStore + '" type="password" placeholder="API key' + (m.keyStore.indexOf('chi-llm-') === 0 ? ' (shared with Language models)' : '') + '" value="' + esc(keyv) + '" style="width:100%;box-sizing:border-box;margin:3px 0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">' : '') +
							'<input class="min" data-store="chi-stt-' + m.slug + '-model" placeholder="Model — e.g. ' + (m.model || 'whisper-1') + '" value="' + esc(localStorage.getItem('chi-stt-' + m.slug + '-model') || '') + '" style="width:100%;box-sizing:border-box;margin:3px 0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">' +
						'</div>') +
					'</div>';
				};
				var odrow = function (m3) {
					var ready = localStorage.getItem('chi-ondevice-' + m3.slug) === '1';
					var selOd = curStt === 'ondevice:' + m3.slug;
					return '<div class="strow" data-drum-base="" ' + (ready ? 'data-stt="ondevice:' + m3.slug + '"' : '') + ' style="display:flex;align-items:center;gap:8px;padding:9px 2px;border-bottom:1px solid rgba(128,128,128,.13);' + (ready ? 'cursor:pointer;' : '') + '">' +
						(ready ? '<span class="stradio" data-stradio="ondevice:' + m3.slug + '" style="width:15px;height:15px;border-radius:50%;flex-shrink:0;border:2px solid ' + (selOd ? GREEN : 'rgba(128,128,128,.5)') + ';background:' + (selOd ? GREEN : 'transparent') + ';"></span>' : '<span style="width:15px;flex-shrink:0;"></span>') +
						'<span style="flex:1;min-width:0;"><span style="font-size:12px;opacity:.9;">' + m3.name + '</span><span style="margin-left:7px;font-size:10px;opacity:.5;">' + m3.dl + '</span><br><span style="font-size:9.5px;opacity:.55;">' + m3.note + '</span></span>' +
						'<span style="font-size:9px;opacity:.6;text-align:right;">speed<br>' + meter(m3.speed) + '</span>' +
						'<span style="font-size:9px;opacity:.6;text-align:right;">accuracy<br>' + meter(m3.acc, true) + '</span>' +
						(ready
							? '<span style="font-size:8.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:8px;background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.35);color:' + GREEN + ';">READY</span>'
							: '<span class="odl" data-od="' + m3.slug + '" style="padding:4px 12px;border-radius:10px;cursor:pointer;font-size:10px;font-weight:800;background:rgba(59,155,255,.9);color:#fff;box-shadow:0 2px 8px rgba(59,155,255,.4);min-width:64px;text-align:center;">Download</span>') +
					'</div>';
				};
				body =
					'<div data-drum-base="" style="margin:2px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">Speech-to-text — Flow uses the selected model</div>' +
					STT_PROVIDERS.map(strow).join('') +
					'<div data-drum-base="" style="margin:14px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">On this device — download once, then private &amp; offline</div>' +
					OD_MODELS.map(odrow).join('') +
					'<div data-drum-base="" style="margin:14px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">More on-device engines ' + badge('SOON') + '</div>' +
					STT_LOCAL_MODELS.map(function (m2) {
						return '<div data-drum-base="" style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);">' +
							'<span style="flex:1;min-width:0;"><span style="font-size:12px;opacity:.85;">' + m2.name + '</span><span style="margin-left:7px;font-size:10px;opacity:.5;">' + m2.size + '</span><br><span style="font-size:9.5px;opacity:.55;">' + m2.note + '</span></span>' +
							'<span style="font-size:9px;opacity:.6;text-align:right;">speed<br>' + meter(m2.speed) + '</span>' +
							'<span style="font-size:9px;opacity:.6;text-align:right;">accuracy<br>' + meter(m2.acc, true) + '</span>' +
							'<span style="padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;opacity:.45;border:1px solid rgba(128,128,128,.3);">Download</span>' +
						'</div>';
					}).join('') +
					'<div data-drum-base="" style="margin:8px 2px;font-size:10.5px;opacity:.5;">+ Import local model ' + badge('SOON') + '</div>';
			} else if (panel === 'dict') {
				var entries = this._dict();
				body =
					'<div data-drum-base="" style="display:flex;gap:6px;padding:4px 0 10px;">' +
						'<input id="dict-o" placeholder="Original (e.g. Qi)" style="flex:1;min-width:0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">' +
						'<input id="dict-r" placeholder="Replacement (e.g. Chi)" style="flex:1;min-width:0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">' +
						'<span id="dict-add" style="padding:7px 13px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:800;background:rgba(48,209,88,.9);color:#fff;">Add</span>' +
					'</div>' +
					(entries.length ? entries.map(function (e4, i4) {
						return '<div data-drum-base="" style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);">' +
							'<span style="flex:1;font-size:12px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(e4.o) + '</span><span style="opacity:.4;">→</span>' +
							'<span style="flex:1;font-size:12px;opacity:.95;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(e4.r) + '</span>' +
							'<span class="dict-del" data-di="' + i4 + '" style="width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;opacity:.55;background:rgba(128,128,128,.15);">×</span>' +
						'</div>';
					}).join('') : '<div data-drum-base="" style="padding:10px 2px;font-size:11.5px;opacity:.5;">Replacements fix words the transcriber keeps getting wrong — "Qi" → "Chi", "wynn" → "Nguyen".</div>') +
					'<div data-drum-base="" style="margin:14px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">Vocabulary — names & terms to preserve</div>' +
					'<div data-drum-base=""><textarea id="dict-vocab" placeholder="Comma-separated: Nguyen, CasePro, DepoLink, ensō…" style="width:100%;box-sizing:border-box;min-height:54px;padding:8px 10px;border-radius:10px;font-size:11.5px;font-family:inherit;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);resize:none;">' + esc(localStorage.getItem('chi-vocab') || '') + '</textarea></div>';
			} else if (panel === 'modes') {
				var sttNow = this._sttConfig();
				body =
					'<div data-drum-base="" style="display:flex;align-items:center;gap:8px;padding:9px 2px;"><span style="font-size:12.5px;font-weight:800;">Dictation</span>' + badge('', true) + '<span style="margin-left:auto;font-size:10px;opacity:.5;">default mode</span></div>' +
					row('<span style="font-size:12px;opacity:.85;">Keyboard shortcut</span><span id="hkchip" title="Click, then press any key combo" style="font-size:11px;font-weight:700;padding:3px 11px;border-radius:8px;cursor:pointer;background:rgba(128,128,128,.16);border:1px solid rgba(128,128,128,.25);">' + this._hotkeyLabel(this._flowHotkey()) + '</span>') +
					row('<span style="font-size:12px;opacity:.85;">Activation</span><span id="modes-activation" style="display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.75;cursor:pointer;">' + (this._flowActivation() === 'hold' ? 'Push && hold' : 'Press to toggle') + ' ' + chev + '</span>') +
					'<div data-drum-base="" style="padding:2px 2px 8px;font-size:9.5px;line-height:1.5;opacity:.45;">Hold: press starts, release delivers. The system-wide desktop shortcut always toggles.</div>' +
					row('<span style="font-size:12px;opacity:.85;">Model</span><span data-nav="stt" style="display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.75;cursor:pointer;">' + sttNow.name + ' ' + chev + '</span>') +
					row('<span style="font-size:12px;opacity:.85;">Real-time transcript</span><span style="font-size:10.5px;opacity:.55;">' + (sttNow.slug === 'webspeech' ? 'On (built-in)' : 'Clip mode — transcribes on Done') + '</span>') +
					'<div class="srow" data-drum-base="" data-tkey="chi-flow-polish" data-tdef="1" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 2px;border-bottom:1px solid rgba(128,128,128,.16);"><span style="font-size:12px;opacity:.85;">AI enhancement (polish)</span>' + sw(localStorage.getItem('chi-flow-polish') !== '0') + '</div>' +
					row('<span style="font-size:12px;opacity:.85;">Output</span><span id="modes-target" style="display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.75;text-transform:capitalize;cursor:pointer;">' + (localStorage.getItem('chi-flow-target') || 'composer') + ' ' + chev + '</span>') +
					'<div class="srow" data-drum-base="" data-tkey="chi-flow-autosend" data-tdef="0" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 2px;border-bottom:1px solid rgba(128,128,128,.16);"><span style="display:flex;align-items:center;gap:7px;font-size:12px;opacity:.85;">Auto send ' + badge('SOON') + '</span>' + sw(localStorage.getItem('chi-flow-autosend') === '1') + '</div>' +
					'<div data-drum-base="" style="margin:10px 2px;font-size:10.5px;opacity:.5;">+ Add mode (per-app profiles) ' + badge('SOON') + '</div>';
			} else if (panel === 'history') {
				var hist = [];
				try { hist = JSON.parse(localStorage.getItem('chi-flow-history') || '[]') || []; } catch (e5) { /* noop */ }
				var words = localStorage.getItem('chi-flow-words') || '0';
				body =
					'<div data-drum-base="" style="display:flex;align-items:center;gap:8px;padding:2px 0 8px;">' +
						'<input id="hist-q" placeholder="Search transcriptions…" style="flex:1;min-width:0;padding:7px 10px;border-radius:9px;font-size:11.5px;color:inherit;background:rgba(128,128,128,.13);border:1px solid rgba(128,128,128,.2);">' +
						'<span style="font-size:10px;opacity:.55;white-space:nowrap;">' + words + ' words dictated</span>' +
					'</div>' +
					(hist.length ? hist.map(function (h2, i5) {
						var d5 = new Date(h2.ts);
						return '<div class="histrow" data-drum-base="" data-hi="' + i5 + '" title="Tap to copy · lands in the composer too" style="padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);cursor:pointer;">' +
							'<div style="font-size:9.5px;opacity:.45;">' + d5.toLocaleString() + '</div>' +
							'<div style="font-size:12px;line-height:1.4;opacity:.88;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + esc(h2.text) + '</div>' +
						'</div>';
					}).join('') : '<div data-drum-base="" style="padding:10px 2px;font-size:11.5px;opacity:.5;">Every Flow dictation lands here.</div>');
			} else if (panel === 'audio') {
				body =
					'<div data-drum-base="" style="margin:2px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">Microphone — clip recording</div>' +
					'<div id="miclist" data-drum-base="" style="padding:2px 0;font-size:11.5px;opacity:.6;">Looking for microphones…</div>' +
					'<div data-drum-base="" style="margin:4px 2px 8px;font-size:10px;opacity:.45;">Built-in browser speech always uses the system default mic.</div>' +
					'<div data-drum-base="" style="margin:10px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">Recording sounds</div>' +
					'<div class="srow" data-drum-base="" data-tkey="chi-rec-sounds" data-tdef="1" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 2px;border-bottom:1px solid rgba(128,128,128,.16);"><span style="font-size:12px;opacity:.85;">Start / stop chirps</span>' + sw(localStorage.getItem('chi-rec-sounds') !== '0') + '</div>';
			} else if (panel === 'whatsnew') {
				body = WHATSNEW.map(function (g) {
					var live = g.label.indexOf('live') !== -1;
					return '<div data-drum-base="" style="display:flex;align-items:center;gap:8px;margin:10px 2px 2px;"><span style="font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">' + g.label + '</span>' + badge('SOON', live) + '</div>' +
						g.items.map(function (it2) {
							return '<div data-drum-base="" style="display:flex;align-items:flex-start;gap:8px;padding:6px 2px;border-bottom:1px solid rgba(128,128,128,.10);">' +
								'<span style="margin-top:5px;width:5px;height:5px;border-radius:50%;flex-shrink:0;background:' + (live ? GREEN : 'rgba(128,128,128,.5)') + ';"></span>' +
								'<span style="font-size:12px;line-height:1.45;opacity:' + (live ? '.9' : '.6') + ';">' + it2 + '</span></div>';
						}).join('');
				}).join('') +
					'<div data-drum-base="" style="margin:12px 2px;font-size:10px;opacity:.45;">Full inventory &amp; roadmap: docs/CHI-ASSISTANT.md in the MatterChat repo.</div>';
			} else {
				body = CONNECTIONS.map(function (g) {
					var head = '<div data-drum-base="" style="display:flex;align-items:center;justify-content:space-between;margin:10px 2px 2px;">' +
						'<span style="font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">' + g.label + '</span>' +
						'<span style="font-size:10px;opacity:.5;">+ ' + g.add + '</span></div>';
					var rows = g.items.map(function (it) {
						var b = it.builtin ? '<span style="font-size:8.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:8px;background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.35);color:' + GREEN + ';">BUILT IN</span>' : (it.ready ? '' : badge('SOON'));
						var on = it.builtin || localStorage.getItem('chi-conn-' + it.slug) === '1';
						return '<div class="srow" data-drum-base="" data-conn="' + it.slug + '" data-locked="' + (it.builtin || !it.ready ? '1' : '') + '" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);">' +
							'<span style="display:flex;align-items:center;gap:7px;min-width:0;"><span style="font-size:12px;opacity:' + (it.ready || it.builtin ? '.9' : '.55') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + it.name + '</span>' + b + '</span>' +
							sw(on, null, it.builtin || !it.ready) + '</div>';
					}).join('');
					return head + rows;
				}).join('');
			}
			return '<div id="settings" style="position:absolute;inset:0;z-index:9;border-radius:50%;overflow:hidden;display:flex;flex-direction:column;backdrop-filter:blur(14px);background:' + t.win + ';animation:chiFadeIn .3s ease both;">' +
				'<div style="position:absolute;inset:0;pointer-events:none;border-radius:50%;box-shadow:inset 0 4px 12px rgba(255,255,255,.06), ' + t.vignette + ';"></div>' +
				'<div style="flex-shrink:0;display:flex;align-items:center;gap:8px;padding:64px 96px 8px;color:' + t.name + ';">' +
					(panel !== 'main' ? '<span id="s-back" style="cursor:pointer;opacity:.8;display:inline-flex;align-items:center;"><svg width="15" height="15" viewBox="0 0 16 16"><path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '') +
					'<span style="font-size:13px;font-weight:800;letter-spacing:.6px;">' + titles[panel] + '</span>' +
					'<span id="s-close" style="margin-left:auto;cursor:pointer;opacity:.75;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;"><svg width="12" height="12" viewBox="0 0 16 16"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>' +
				'</div>' +
				'<div id="slist" style="flex:1;overflow-y:auto;padding:16px 78px 70px;color:' + t.name + ';-webkit-mask-image:linear-gradient(to bottom, transparent 0, #000 15%, #000 82%, transparent 100%);mask-image:linear-gradient(to bottom, transparent 0, #000 15%, #000 82%, transparent 100%);">' + body + '</div>' +
			'</div>';
		}
		/* Desktop only: ask the app what AI is ALREADY on this computer and render it into the
		 * Transcription / Language-model panels — running Ollama/LM Studio (with every model you've
		 * pulled), any local Whisper server, and speech-model files found on disk. One tap wires
		 * the configuration. Also renders NATIVE model downloads (real files, to disk). */
		_injectLocalAi(panel, list) {
			var br = window.matterchatDesktop;
			if (!br || !br.detectLocalAI || !list) return;
			var self = this;
			var host = document.createElement('div');
			host.setAttribute('data-drum-base', '');
			list.appendChild(host);
			Promise.resolve(br.detectLocalAI()).then(function (d) {
				if (!d || !host.isConnected) return;
				var head = function (t2) { return '<div style="margin:12px 2px 4px;font-size:9.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.5;">' + t2 + '</div>'; };
				var html = '';
				if (panel === 'models') {
					if (d.ollama.running || d.lmstudio.running) {
						html += head('Detected on this computer — tap to use');
						d.ollama.models.forEach(function (m4) {
							html += '<div class="lai" data-kind="ollama" data-name="' + esc(m4.name) + '" style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);cursor:pointer;"><span style="width:7px;height:7px;border-radius:50%;background:' + GREEN + ';box-shadow:0 0 6px rgba(48,209,88,.6);flex-shrink:0;"></span><span style="flex:1;font-size:12px;opacity:.9;">' + esc(m4.name) + '</span><span style="font-size:10px;opacity:.5;">Ollama · ' + (m4.sizeGb || '?') + ' GB</span></div>';
						});
						d.lmstudio.models.forEach(function (m5) {
							html += '<div class="lai" data-kind="lmstudio" data-name="' + esc(m5.name) + '" style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);cursor:pointer;"><span style="width:7px;height:7px;border-radius:50%;background:' + GREEN + ';flex-shrink:0;"></span><span style="flex:1;font-size:12px;opacity:.9;">' + esc(m5.name) + '</span><span style="font-size:10px;opacity:.5;">LM Studio</span></div>';
						});
						if (!d.ollama.models.length && d.ollama.running) html += '<div style="padding:6px 2px;font-size:11px;opacity:.5;">Ollama is running but has no models — `ollama pull llama3.1:8b`.</div>';
					} else {
						html += head('On this computer') + '<div style="padding:4px 2px;font-size:11px;opacity:.5;">No Ollama / LM Studio detected right now. Start one and reopen this panel.</div>';
					}
				}
				if (panel === 'stt') {
					html += head('Native models — download to disk (fastest, for the native runtime)');
					var have = {};
					(d.sttFiles || []).forEach(function (f2) { have[f2.name.replace(/\.bin$/i, '')] = f2; });
					[['ggml-tiny.en', 'Whisper Tiny (English) · 78 MB'], ['ggml-base.en', 'Whisper Base (English) · 148 MB'], ['ggml-small.en', 'Whisper Small (English) · 488 MB'], ['ggml-large-v3-turbo-q5_0', 'Whisper Large v3 Turbo (quantized) · 574 MB']].forEach(function (pair) {
						var got = have[pair[0]];
						html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);"><span style="flex:1;font-size:12px;opacity:.85;">' + pair[1] + '</span>' +
							(got ? '<span style="font-size:8.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:8px;background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.35);color:' + GREEN + ';">ON DISK</span>'
								: '<span class="natdl" data-nat="' + pair[0] + '" style="padding:4px 12px;border-radius:10px;cursor:pointer;font-size:10px;font-weight:800;background:rgba(59,155,255,.9);color:#fff;min-width:64px;text-align:center;">Download</span>') + '</div>';
					});
					if ((d.sttFiles || []).length) {
						html += head('Speech models found on this computer');
						d.sttFiles.forEach(function (f3) {
							html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid rgba(128,128,128,.10);"><span style="flex:1;font-size:11.5px;opacity:.8;">' + esc(f3.name) + '</span><span style="font-size:10px;opacity:.5;">' + f3.sizeMb + ' MB</span></div>';
						});
					}
					if (d.whisperServer && d.whisperServer.running) {
						html += '<div class="lai" data-kind="whisper" data-url="' + esc(d.whisperServer.url) + '" style="display:flex;align-items:center;gap:8px;padding:8px 2px;cursor:pointer;"><span style="width:7px;height:7px;border-radius:50%;background:' + GREEN + ';"></span><span style="flex:1;font-size:12px;opacity:.9;">Local Whisper server detected at ' + esc(d.whisperServer.url) + '</span><span style="font-size:10.5px;font-weight:700;color:' + GREEN + ';">Use it →</span></div>';
					}
					html += '<div style="margin:6px 2px;font-size:9.5px;line-height:1.5;opacity:.45;">Native on-disk models run through the bundled runtime (next desktop release) or any local Whisper server; the in-browser models above work everywhere today.</div>';
				}
				host.innerHTML = html;
				self._drumApply(list);
				host.addEventListener('click', function (e11) {
					var nat = e11.target.closest('.natdl');
					if (nat && br.downloadSttModel) {
						var nm = nat.getAttribute('data-nat');
						if (nat.getAttribute('data-busy')) return;
						nat.setAttribute('data-busy', '1');
						nat.textContent = '0%';
						if (!self._natProg && br.onSttModelProgress) {
							self._natProg = br.onSttModelProgress(function (pr2) {
								var b2 = host.querySelector('.natdl[data-nat="' + pr2.name + '"]');
								if (b2) b2.textContent = pr2.pct + '%';
							});
						}
						Promise.resolve(br.downloadSttModel(nm)).then(function () {
							nat.outerHTML = '<span style="font-size:8.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:8px;background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.35);color:' + GREEN + ';">ON DISK</span>';
							self._tick(1);
						}).catch(function (e12) { nat.removeAttribute('data-busy'); nat.textContent = 'Retry'; nat.title = String((e12 && e12.message) || e12); });
						return;
					}
					var lai = e11.target.closest('.lai');
					if (!lai) return;
					var kind = lai.getAttribute('data-kind');
					if (kind === 'ollama') {
						localStorage.setItem('chi-llm-ollama-url', localStorage.getItem('chi-llm-ollama-url') || 'http://localhost:11434');
						localStorage.setItem('chi-llm-ollama-model', lai.getAttribute('data-name'));
						localStorage.setItem('chi-model', 'ollama');
						self.dispatchEvent(new CustomEvent('chi-pref', { detail: { model: 'ollama' }, bubbles: true, composed: true }));
					} else if (kind === 'lmstudio') {
						localStorage.setItem('chi-llm-lmstudio-url', localStorage.getItem('chi-llm-lmstudio-url') || 'http://localhost:1234/v1');
						localStorage.setItem('chi-llm-lmstudio-model', lai.getAttribute('data-name'));
						localStorage.setItem('chi-model', 'lmstudio');
						self.dispatchEvent(new CustomEvent('chi-pref', { detail: { model: 'lmstudio' }, bubbles: true, composed: true }));
					} else if (kind === 'whisper') {
						localStorage.setItem('chi-stt-local-url', lai.getAttribute('data-url'));
						localStorage.setItem('chi-stt-model', 'stt-local');
					}
					self._tick(1);
					var sl4 = self.shadowRoot.getElementById('slist');
					if (sl4) self._slistScrollKeep = sl4.scrollTop;
					self._render();
				});
			}).catch(function () { /* detection is best-effort */ });
		}
		_wireSettings() {
			var self = this, r = this.shadowRoot, panel = r.getElementById('settings');
			if (!panel) return;
			var on = function (id, fn) { var el = r.getElementById(id); if (el) el.addEventListener('click', function (e) { e.stopPropagation(); fn(); }); };
			on('s-close', function () { self._settingsOpen = false; self._render(); });
			on('s-back', function () { self._settingsPanel = 'main'; self._render(); });
			var setSw = function (el, onv) {
				if (!el) return;
				el.style.background = onv ? GREEN : 'rgba(140,140,150,.45)';
				if (el.firstElementChild) el.firstElementChild.style.transform = 'translateX(' + (onv ? 15 : 1) + 'px)';
			};
			var sizeNudge = function (d2) {
				localStorage.setItem('chi-orb-scale', Math.max(0.7, Math.min(1.5, self._scale + d2)).toFixed(2));
				self.dispatchEvent(new CustomEvent('chi-resize', { detail: { scale: self._scale }, bubbles: true, composed: true }));
				var sh = r.getElementById('shell'); if (sh) sh.style.transform = 'scale(' + self._scale + ')';
				var pct = r.getElementById('s-pct'); if (pct) pct.textContent = Math.round(self._scale * 100) + '%';
				self._tick();
			};
			on('s-grow', function () { sizeNudge(0.1); });
			on('s-shrink', function () { sizeNudge(-0.1); });
			on('s-theme', function () { var sl0 = r.getElementById('slist'); if (sl0) self._slistScrollKeep = sl0.scrollTop; self._cycleTheme(); });
			panel.querySelectorAll('.fmin').forEach(function (fm) {
				fm.addEventListener('click', function (e) {
					e.stopPropagation();
					self._settingsOpen = false;
					self._render();
					self._startFocus(parseInt(fm.getAttribute('data-min'), 10));
				});
			});
			on('s-route', function () {
				var now = localStorage.getItem('chi-notif-route') === '1';
				localStorage.setItem('chi-notif-route', now ? '0' : '1');
				self.dispatchEvent(new CustomEvent('chi-notif-route', { detail: { on: !now }, bubbles: true, composed: true }));
				setSw(r.getElementById('s-route'), !now);
			});
			on('s-sound', function () {
				var wasOn = localStorage.getItem('chi-orb-sound') !== '0';
				localStorage.setItem('chi-orb-sound', wasOn ? '0' : '1');
				if (!wasOn) self._tick(1);
				setSw(r.getElementById('s-sound'), !wasOn);
			});
			// color editor (main panel only — elements absent elsewhere, all guards null-safe)
			var dotRings = function () {
				var selKey = localStorage.getItem('chi-orb-frame') || 'steel';
				var base = 'inset 0 1px 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.35)';
				panel.querySelectorAll('.fdot').forEach(function (d2) {
					d2.style.boxShadow = base + (d2.getAttribute('data-frame') === selKey ? ', 0 0 0 2px ' + GREEN : '');
				});
				var swp2 = r.getElementById('s-swatch');
				if (swp2) swp2.style.boxShadow = base + (selKey === 'custom' ? ', 0 0 0 2px ' + GREEN : '');
			};
			panel.querySelectorAll('.fdot').forEach(function (dot) {
				dot.addEventListener('click', function (e) {
					e.stopPropagation();
					var key2 = dot.getAttribute('data-frame');
					localStorage.setItem('chi-orb-frame', key2);
					var fr = FRAMES[key2];
					var tint = r.getElementById('tint'); if (tint) tint.style.background = fr.tint;
					var shade = r.getElementById('tintshade'); if (shade) shade.style.background = fr.tint === 'transparent' ? 'transparent' : fr.tint;
					dotRings();
					self._tick(1);
				});
			});
			var applyColor = function (h, s2, l, commit) {
				localStorage.setItem('chi-orb-frame', 'custom');
				localStorage.setItem('chi-orb-frame-hue', String(h));
				localStorage.setItem('chi-orb-frame-sat', String(s2));
				localStorage.setItem('chi-orb-frame-lum', String(l));
				var css = 'hsl(' + h + ', ' + s2 + '%, ' + l + '%)';
				var tint = r.getElementById('tint'); if (tint) tint.style.background = css;
				var shade = r.getElementById('tintshade'); if (shade) shade.style.background = 'hsl(' + h + ', ' + s2 + '%, ' + Math.max(8, l - 8) + '%)';
				var hk = r.getElementById('s-hueknob'); if (hk) { hk.style.left = (h / 360 * 100).toFixed(1) + '%'; hk.style.background = 'hsl(' + h + ',72%,52%)'; }
				var pad2 = r.getElementById('s-pad'); if (pad2) pad2.style.background = 'linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(' + h + ',100%,50%))';
				var pk = r.getElementById('s-padknob'); if (pk) { pk.style.left = s2.toFixed(0) + '%'; pk.style.top = Math.min(100, Math.max(0, (1 - (l - 6) / 88) * 100)).toFixed(0) + '%'; pk.style.background = css; }
				var swp = r.getElementById('s-swatch'); if (swp) swp.style.background = 'linear-gradient(135deg, hsl(' + h + ', ' + s2 + '%, ' + Math.min(88, l + 22) + '%) 0%, hsl(' + h + ', ' + s2 + '%, ' + Math.max(12, l - 16) + '%) 100%)';
				if (commit) { self._tick(1); dotRings(); }
			};
			var wireDrag = function (elx, fromEvent) {
				if (!elx) return;
				var dragging = false;
				elx.addEventListener('pointerdown', function (e) { e.stopPropagation(); dragging = true; try { elx.setPointerCapture(e.pointerId); } catch (_) { /* noop */ } fromEvent(e, false); });
				elx.addEventListener('pointermove', function (e) { if (dragging) fromEvent(e, false); });
				var end = function (e) { if (!dragging) return; dragging = false; fromEvent(e, true); };
				elx.addEventListener('pointerup', end);
				elx.addEventListener('pointercancel', function () { if (dragging) dragging = false; });
			};
			var hue = r.getElementById('s-hue');
			wireDrag(hue, function (e, commit) {
				var hr = hue.getBoundingClientRect();
				var p2 = Math.max(0, Math.min(1, (e.clientX - hr.left) / (hr.width || 1)));
				applyColor(Math.round(p2 * 360), self._frameSat, self._frameLum, commit);
			});
			var pad = r.getElementById('s-pad');
			wireDrag(pad, function (e, commit) {
				var pr = pad.getBoundingClientRect();
				var px = Math.max(0, Math.min(1, (e.clientX - pr.left) / (pr.width || 1)));
				var py = Math.max(0, Math.min(1, (e.clientY - pr.top) / (pr.height || 1)));
				applyColor(self._frameHue, Math.round(px * 100), Math.round((1 - py) * 88) + 6, commit);
			});
			var pr2 = panel.querySelector('[data-act="popout"]');
			if (pr2) pr2.addEventListener('click', function () { self._settingsOpen = false; self._render(); self.dispatchEvent(new CustomEvent('chi-popout', { bubbles: true, composed: true })); });
			var cl = panel.querySelector('[data-act="collapse"]');
			if (cl) cl.addEventListener('click', function () { self._settingsOpen = false; self._toggle(); });
			var list = r.getElementById('slist');
			if (list) {
				list.addEventListener('click', function (e) {
					var navEl = e.target.closest('[data-nav]');
					if (navEl) { self._settingsPanel = navEl.getAttribute('data-nav'); self._render(); return; }
					// capability toggles — FE-local reminders (and live-feature switches)
					var capEl = e.target.closest('[data-tkey]');
					if (capEl) {
						var tk = capEl.getAttribute('data-tkey'), def = capEl.getAttribute('data-tdef') === '1';
						var cur = def ? localStorage.getItem(tk) !== '0' : localStorage.getItem(tk) === '1';
						localStorage.setItem(tk, cur ? (def ? '0' : '0') : '1');
						setSw(capEl.querySelector('.sw'), !cur);
						self._tick();
						return;
					}
					// model rows: radio picks the default; the row expands its inline editor
					var mr = e.target.closest('.mrow');
					if (mr) {
						var slug = mr.getAttribute('data-model');
						if (e.target.closest('.mradio')) {
							localStorage.setItem('chi-model', slug);
							panel.querySelectorAll('.mradio').forEach(function (rd) {
								var selr = rd.getAttribute('data-mradio') === slug;
								rd.style.border = '2px solid ' + (selr ? GREEN : 'rgba(128,128,128,.5)');
								rd.style.background = selr ? GREEN : 'transparent';
								rd.style.boxShadow = selr ? '0 0 8px rgba(48,209,88,.5)' : 'none';
							});
							self.dispatchEvent(new CustomEvent('chi-pref', { detail: { model: slug }, bubbles: true, composed: true }));
							self._tick(1);
						} else {
							var ed = panel.querySelector('[data-med="' + slug + '"]');
							if (ed) ed.style.display = ed.style.display === 'none' ? 'block' : 'none';
						}
						return;
					}
					// on-device model download — REAL: streams the ONNX weights with live % into the button
					var odl = e.target.closest('.odl');
					if (odl) {
						var odSlug = odl.getAttribute('data-od');
						var model = null;
						for (var oi = 0; oi < OD_MODELS.length; oi++) if (OD_MODELS[oi].slug === odSlug) model = OD_MODELS[oi];
						if (!model || odl.getAttribute('data-busy')) return;
						odl.setAttribute('data-busy', '1');
						odl.textContent = '0%';
						var lastPct = -1;
						self._odPipe(model, function (pev) {
							if (pev && pev.status === 'progress') {
								var pct = Math.round(pev.progress || 0);
								if (pct !== lastPct) { lastPct = pct; odl.textContent = pct + '%'; }
							}
						}).then(function () {
							localStorage.setItem('chi-ondevice-' + odSlug, '1');
							self._tick(1);
							var sl3 = r.getElementById('slist'); if (sl3) self._slistScrollKeep = sl3.scrollTop;
							self._render(); // row becomes a selectable READY radio
						}).catch(function (err2) {
							odl.removeAttribute('data-busy');
							odl.textContent = 'Retry';
							odl.title = 'Download failed: ' + (err2 && err2.message ? err2.message : 'network/CSP') + ' — model files come from huggingface.co';
						});
						return;
					}
					// speech-model rows: radio = default STT; row tap = expand inline editor
					var strow = e.target.closest('.strow');
					if (strow) {
						var sslug = strow.getAttribute('data-stt');
						if (e.target.closest('.stradio')) {
							localStorage.setItem('chi-stt-model', sslug);
							panel.querySelectorAll('.stradio').forEach(function (rd2) {
								var selr2 = rd2.getAttribute('data-stradio') === sslug;
								rd2.style.border = '2px solid ' + (selr2 ? GREEN : 'rgba(128,128,128,.5)');
								rd2.style.background = selr2 ? GREEN : 'transparent';
							});
							self._tick(1);
						} else {
							var sted = panel.querySelector('[data-sted="' + sslug + '"]');
							if (sted) sted.style.display = sted.style.display === 'none' ? 'block' : 'none';
						}
						return;
					}
					var dd = e.target.closest('.dict-del');
					if (dd) {
						var di2 = parseInt(dd.getAttribute('data-di'), 10);
						var entries2 = self._dict(); entries2.splice(di2, 1);
						localStorage.setItem('chi-dict', JSON.stringify(entries2));
						var rowD = dd.parentElement; if (rowD) rowD.remove();
						self._tick();
						return;
					}
					var hr2 = e.target.closest('.histrow');
					if (hr2) {
						try {
							var hist2 = JSON.parse(localStorage.getItem('chi-flow-history') || '[]');
							var item = hist2[parseInt(hr2.getAttribute('data-hi'), 10)];
							if (item && item.text) {
								try { navigator.clipboard.writeText(item.text); } catch (e6) { /* noop */ }
								self.dispatchEvent(new CustomEvent('chi-flow-insert', { detail: { text: item.text }, bubbles: true, composed: true }));
								hr2.style.opacity = '.4'; setTimeout(function () { hr2.style.opacity = ''; }, 350);
								self._pluck();
							}
						} catch (e7) { /* noop */ }
						return;
					}
					var micRow = e.target.closest('[data-mic]');
					if (micRow) {
						localStorage.setItem('chi-mic-device', micRow.getAttribute('data-mic'));
						panel.querySelectorAll('[data-mic]').forEach(function (mr2) {
							var selm = mr2 === micRow;
							var rd3 = mr2.querySelector('.micdotr');
							if (rd3) { rd3.style.border = '2px solid ' + (selm ? GREEN : 'rgba(128,128,128,.5)'); rd3.style.background = selm ? GREEN : 'transparent'; }
						});
						self._tick(1);
						return;
					}
					var rowEl = e.target.closest('[data-conn]');
					if (rowEl && rowEl.getAttribute('data-locked') !== '1') {
						var cslug = rowEl.getAttribute('data-conn');
						var key = 'chi-conn-' + cslug;
						var nowOn = localStorage.getItem(key) !== '1';
						localStorage.setItem(key, nowOn ? '1' : '0');
						setSw(rowEl.querySelector('.sw'), nowOn);
						self.dispatchEvent(new CustomEvent('chi-pref', { detail: { connector: { slug: cslug, on: nowOn } }, bubbles: true, composed: true }));
						self._tick();
					}
				});
				// model editor inputs persist as you type; the status LED follows configuration
				list.addEventListener('input', function (e) {
					var inp = e.target.closest('.min');
					if (!inp) return;
					localStorage.setItem(inp.getAttribute('data-store'), inp.value.trim());
					var wrap = inp.closest('[data-med]');
					if (wrap) {
						var slug2 = wrap.getAttribute('data-med');
						var led = panel.querySelector('.mrow[data-model="' + slug2 + '"] .mled');
						var conf = (localStorage.getItem('chi-llm-' + slug2 + '-key') || localStorage.getItem('chi-llm-' + slug2 + '-url') || '').length > 0;
						if (led) { led.style.background = conf ? GREEN : 'rgba(128,128,128,.4)'; led.style.boxShadow = conf ? '0 0 6px rgba(48,209,88,.6)' : 'none'; }
					}
				});
				list.addEventListener('keydown', function (e) { e.stopPropagation(); }); // typing a key must not leak to app hotkeys
				// dictionary: add entry + vocab persistence
				var dictAdd = r.getElementById('dict-add');
				if (dictAdd) dictAdd.addEventListener('click', function () {
					var oI = r.getElementById('dict-o'), rI = r.getElementById('dict-r');
					var ov = (oI && oI.value || '').trim(), rv = (rI && rI.value || '').trim();
					if (!ov) return;
					var entries3 = self._dict(); entries3.push({ o: ov, r: rv });
					localStorage.setItem('chi-dict', JSON.stringify(entries3));
					self._tick(1);
					var sl2 = r.getElementById('slist'); if (sl2) self._slistScrollKeep = sl2.scrollTop;
					self._render();
				});
				var vocabEl = r.getElementById('dict-vocab');
				if (vocabEl) vocabEl.addEventListener('input', function () { localStorage.setItem('chi-vocab', vocabEl.value); });
				// modes: click-to-record keyboard shortcut — press ANY combo; Esc cancels
				var hkchip = r.getElementById('hkchip');
				if (hkchip) hkchip.addEventListener('click', function (e9) {
					e9.stopPropagation();
					if (self._hkRec) return;
					var prev = hkchip.textContent;
					hkchip.textContent = 'Press keys…';
					hkchip.style.borderColor = 'rgba(48,209,88,.6)';
					var done = function () { self._hkRec = null; window.removeEventListener('keydown', cap, true); hkchip.style.borderColor = 'rgba(128,128,128,.25)'; };
					var cap = function (ke) {
						ke.preventDefault(); ke.stopPropagation();
						if (ke.code === 'Escape') { hkchip.textContent = prev; done(); return; }
						if (/^(Control|Meta|Shift|Alt)/.test(ke.code)) return; // wait for the real key
						if (!ke.ctrlKey && !ke.metaKey && !ke.altKey && !/^F\d{1,2}$/.test(ke.code)) {
							hkchip.textContent = 'Add ⌘/Ctrl/⌥…';
							setTimeout(function () { if (self._hkRec) hkchip.textContent = 'Press keys…'; }, 900);
							return;
						}
						var h2 = { ctrl: ke.ctrlKey, meta: ke.metaKey, alt: ke.altKey, shift: ke.shiftKey, code: ke.code, label: null };
						localStorage.setItem('chi-flow-hotkey', JSON.stringify(h2));
						hkchip.textContent = self._hotkeyLabel(h2);
						self._tick(1);
						done();
						// desktop: swap the SYSTEM-WIDE shortcut too (best effort — false = combo taken)
						var br = window.matterchatDesktop;
						var accel = self._hotkeyAccel(h2);
						if (br && br.setFlowShortcut && accel) {
							Promise.resolve(br.setFlowShortcut(accel)).then(function (ok2) {
								if (!ok2) hkchip.title = 'In-app shortcut set. System-wide combo unavailable (taken by another app?) — the previous one still works globally.';
							});
						}
					};
					self._hkRec = cap;
					window.addEventListener('keydown', cap, true);
				});
				// modes: activation cycler (toggle ↔ push-and-hold)
				var mact = r.getElementById('modes-activation');
				if (mact) mact.addEventListener('click', function (e10) {
					e10.stopPropagation();
					var nowHold = self._flowActivation() !== 'hold';
					localStorage.setItem('chi-flow-activation', nowHold ? 'hold' : 'toggle');
					mact.innerHTML = (nowHold ? 'Push &amp; hold' : 'Press to toggle') + ' <svg width="12" height="12" viewBox="0 0 16 16"><path d="M6 3 L11 8 L6 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
					self._tick();
				});
				// modes: output target cycler
				var mt = r.getElementById('modes-target');
				if (mt) mt.addEventListener('click', function (e8) {
					e8.stopPropagation();
					var order = ['composer', 'chi', 'copy'];
					var nxt = order[(order.indexOf(localStorage.getItem('chi-flow-target') || 'composer') + 1) % order.length];
					localStorage.setItem('chi-flow-target', nxt);
					mt.firstChild.textContent ? (mt.childNodes[0].textContent = nxt + ' ') : null;
					mt.innerHTML = nxt + ' ' + '<svg width="12" height="12" viewBox="0 0 16 16"><path d="M6 3 L11 8 L6 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
					self._tick();
				});
				// history: live search filter
				var hq = r.getElementById('hist-q');
				if (hq) hq.addEventListener('input', function () {
					var q2 = hq.value.toLowerCase();
					list.querySelectorAll('.histrow').forEach(function (row2) { row2.style.display = row2.textContent.toLowerCase().indexOf(q2) === -1 ? 'none' : ''; });
				});
				// audio: enumerate microphones (labels appear once mic permission has been granted)
				var micList = r.getElementById('miclist');
				if (micList && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
					navigator.mediaDevices.enumerateDevices().then(function (devs) {
						var mics = devs.filter(function (d6) { return d6.kind === 'audioinput'; });
						var curMic = localStorage.getItem('chi-mic-device') || '';
						micList.style.opacity = '1';
						micList.innerHTML = mics.length ? mics.map(function (d7, i7) {
							var selm2 = curMic ? d7.deviceId === curMic : i7 === 0;
							return '<div data-mic="' + d7.deviceId + '" style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(128,128,128,.13);cursor:pointer;">' +
								'<span class="micdotr" style="width:15px;height:15px;border-radius:50%;flex-shrink:0;border:2px solid ' + (selm2 ? 'rgb(48,209,88)' : 'rgba(128,128,128,.5)') + ';background:' + (selm2 ? 'rgb(48,209,88)' : 'transparent') + ';"></span>' +
								'<span style="font-size:12px;opacity:.88;">' + (d7.label || ('Microphone ' + (i7 + 1))) + '</span></div>';
						}).join('') : 'No microphones found.';
					}).catch(function () { micList.textContent = 'Microphone list unavailable.'; });
				}
				if (this._settingsPanel === 'stt' || this._settingsPanel === 'models') this._injectLocalAi(this._settingsPanel, list);
				this._drumify(list, 1, true);
				if (this._slistScrollKeep != null) {
					var ks = this._slistScrollKeep;
					this._slistScrollKeep = null;
					requestAnimationFrame(function () { requestAnimationFrame(function () { list.scrollTop = ks; self._drumApply(list); }); });
				}
			}
		}
		_render() {
			var t = this._theme, A = this._base, self = this;
			var mask = '-webkit-mask:url(' + A + 'omnis-enso-bristle.svg) center/contain no-repeat;mask:url(' + A + 'omnis-enso-bristle.svg) center/contain no-repeat;';
			var kf = '@keyframes chiRipple{0%{transform:translate(-50%,-50%) scale(2.05);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(-50%,-50%) scale(.3);opacity:0}}@keyframes chiMsgIn{0%{opacity:0;transform:translateY(14px) scale(.955)}70%{opacity:1;transform:translateY(-2px) scale(1.004)}100%{opacity:1;transform:translateY(0) scale(1)}}@keyframes chiBreathe{0%,100%{opacity:.45;transform:translate(-50%,-50%) scale(1)}50%{opacity:.85;transform:translate(-50%,-50%) scale(1.08)}}@keyframes chiDot{0%,80%,100%{opacity:.25}40%{opacity:1}}@keyframes chiHalo{0%,100%{opacity:.65}50%{opacity:1}}@keyframes chiPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}@keyframes chiSweep{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes chiVoicePulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.5}50%{transform:translate(-50%,-50%) scale(1.22);opacity:.95}}@keyframes chiFadeIn{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){*{animation:none !important}}';
			var hover = '#grip:hover{background:rgba(31,157,69,.4);color:#fff}.ctl:active,.arcb:active,.sbtn:active,.fdot:active{transform:scale(.92) !important}#sendbtn:active{transform:scale(.93) !important}.chip:hover{box-shadow:0 4px 14px -4px rgba(48,209,88,.35), inset 0 1px 0 rgba(255,255,255,.14)}.srow{border-radius:8px}.fmin{transition:transform .12s ease, background .15s}.fmin:hover{transform:translateY(-1px);background:rgba(59,155,255,.28) !important}.ctl{transition:transform .15s ease, box-shadow .15s ease}.ctl:hover{transform:translateY(-1px) scale(1.06);box-shadow:0 4px 12px rgba(0,0,0,.35)}.arcb{opacity:.72;transition:opacity .15s ease}.arcb:hover{opacity:1}.chip{transition:transform .15s ease, background .18s, border-color .18s}.chip:hover{transform:translateY(-1px)}.sbtn:hover{background:rgba(128,128,128,.28) !important}.srow{transition:opacity .15s}.fdot{transition:transform .12s ease}.fdot:hover{transform:scale(1.2)}#sendbtn{transition:transform .15s ease, box-shadow .18s}#sendbtn:hover{transform:scale(1.08);box-shadow:0 3px 14px rgba(48,209,88,.55) !important}#inputpill:focus-within{border-color:rgba(48,209,88,.55) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 3px rgba(48,209,88,.12) !important}';
			var head = '<style>' + kf + hover + ':host{display:block;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}input{outline:none;border:none;background:transparent}button{font-family:inherit}::-webkit-scrollbar{width:0;height:0}</style>';

			/* ---- minimized launcher: JUST the ensō + looping ripple + realtime button (transparent).
			   MINIMIZED WINS over realtime — a call started here stays small (a blue listening glow +
			   the mic becomes a stop button); it never expands to the big view, and there are no chips
			   in minimized mode. Expanding (a plain click on the ensō) is the only way to the big view. ---- */
			if (this._min) {
				var rt = this._realtime;
				this.shadowRoot.innerHTML = head +
					'<div id="launch" title="Open Chi (hold to move)" style="position:relative;width:80px;height:80px;cursor:grab;transform:scale(' + this._scale + ');transform-origin:' + (this._hasWinCtrl() ? '50% 50%' : '50% 100%') + ';">' +
					(this._unseen > 0
					? '<div style="position:absolute;inset:-14px;border-radius:50%;pointer-events:none;background:radial-gradient(circle, rgba(255,159,10,.34) 30%, rgba(255,159,10,0) 70%);animation:chiHalo 1.6s ease-in-out infinite;"></div>'
					: '<div style="position:absolute;inset:-14px;border-radius:50%;pointer-events:none;background:radial-gradient(circle, rgba(48,209,88,.22) 30%, rgba(48,209,88,0) 70%);animation:chiHalo 3s ease-in-out infinite;"></div>') +
				(this._unseen > 0 ? '<div style="position:absolute;top:-5px;left:-5px;z-index:5;min-width:18px;height:18px;padding:0 4px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;background:#ff9f0a;color:#1a1206;box-shadow:0 2px 7px rgba(0,0,0,.5);">' + (this._unseen > 99 ? '99+' : this._unseen) + '</div>' : '') +
					(rt ? '<div style="position:absolute;inset:-9px;border-radius:50%;pointer-events:none;box-shadow:0 0 24px 6px rgba(59,155,255,.6);animation:chiHalo 1.5s ease-in-out infinite;"></div>' : '') +
					'<img src="' + A + 'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:80px;height:80px;filter:' + (t.markFilter || 'drop-shadow(0 3px 12px rgba(0,0,0,.55))') + ';">' +
					'<div style="position:absolute;inset:0;' + mask + '">' + ripples() + '</div>' +
					(this._hasRealtime() ? '<div id="micdot" title="' + (rt ? 'End voice call' : 'Talk to Chi') + '" style="position:absolute;right:-2px;bottom:-2px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:' + GREEN + ';box-shadow:0 3px 10px rgba(48,209,88,.55);' + (rt ? 'animation:chiPulse 1.1s ease-in-out infinite;' : '') + '">' + (rt ? '<svg width="10" height="10" viewBox="0 0 12 12"><rect x="3" y="3" width="6" height="6" rx="1.5" fill="#fff"/></svg>' : '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"><path d="M4 8v0M6.5 6v4M9.5 4.5v7M12 6.5v3"/></svg>') + '</div>' : '') +
					'</div>';
				var launchEl = this.shadowRoot.getElementById('launch');
				launchEl.addEventListener('click', function () { if (self._justDragged) { self._justDragged = false; return; } self._toggle(); });
				// hover peek: the latest notification floats up as a ghost card — read without opening
				launchEl.addEventListener('mouseenter', function () {
					if (!self._lastNotif || self.shadowRoot.getElementById('peek')) return;
					var pk = document.createElement('div');
					pk.id = 'peek';
					pk.setAttribute('style', 'position:absolute;bottom:92px;left:50%;transform:translateX(-50%);width:252px;z-index:9;animation:chiMsgIn .25s ease both;pointer-events:none;');
					var card = self._notifCard(self._lastNotif);
					card.style.animation = 'none';
					card.style.borderRadius = '14px';
					pk.appendChild(card);
					launchEl.appendChild(pk);
				});
				launchEl.addEventListener('mouseleave', function () { var pk = self.shadowRoot.getElementById('peek'); if (pk) pk.remove(); });
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
					return '<button data-i="' + i + '" class="chip" style="padding:7px 15px;border-radius:15px;cursor:pointer;font:600 12px inherit;box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 2px 8px -3px rgba(0,0,0,.3);' + t.chip + '">' + esc(a.label) + '</button>';
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
						'<div id="caps" style="display:flex;flex-direction:column;align-items:center;gap:3px;min-height:32px;max-width:300px;"></div>' +
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
				return '<button data-i="' + i + '" class="chip" style="padding:5px 12px;border-radius:13px;cursor:pointer;font:600 11px inherit;box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 2px 8px -3px rgba(0,0,0,.3);' + t.chip + '"></button>';
			}).join('');
			var inner =
				'<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:2px;padding:2px 0 8px;">' +
					'<div style="position:relative;width:56px;height:46px;">' +
						'<div style="position:absolute;left:50%;top:50%;width:110px;height:110px;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);background:radial-gradient(circle, ' + t.glow + ' 0%, transparent 62%);animation:chiBreathe 5.5s ease-in-out infinite;"></div>' +
						'<img src="' + A + 'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:' + (t.markFilter || 'drop-shadow(0 0 10px rgba(255,255,255,.2))') + ';">' +
						'<div id="markloop" style="position:absolute;inset:0;display:none;' + mask + '">' + ripples() + '</div>' +
					'</div>' +
					'<div style="font-size:15px;font-weight:800;letter-spacing:3px;color:' + t.name + ';">CHI</div>' +
					'<div id="status" style="font-size:10px;letter-spacing:1.4px;font-weight:600;color:' + t.dim + ';min-height:12px;"></div>' +
				'</div>' +
				'<div id="msgs" style="flex:1;overflow-y:auto;padding:6px 88px 8px;display:flex;flex-direction:column;gap:8px;min-height:0;-webkit-mask-image:linear-gradient(to bottom, transparent 0, #000 10%, #000 88%, transparent 100%);mask-image:linear-gradient(to bottom, transparent 0, #000 10%, #000 88%, transparent 100%);"></div>' +
				'<div id="chips" style="flex-shrink:0;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:2px 92px 8px;">' + chips + '</div>' +
				'<div style="flex-shrink:0;padding:6px 96px 44px;display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
					'<div id="flowpanel" style="display:none;width:100%;margin-bottom:6px;flex-direction:column;gap:7px;padding:9px 11px;border-radius:14px;animation:chiMsgIn .3s ease both;' + (t.card || t.chi) + '">' +
						'<div style="display:flex;align-items:center;gap:7px;"><span style="width:7px;height:7px;border-radius:50%;background:#ff453a;animation:chiHalo 1.2s ease-in-out infinite;"></span><span style="font-size:10px;font-weight:800;letter-spacing:1.4px;color:#ff453a;">REC</span><span id="flowtime" style="font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;opacity:.85;">0:00</span>' +
						'<span id="flowmeter" style="display:flex;align-items:flex-end;gap:2px;height:22px;margin-left:2px;">' + Array.from({ length: 14 }).map(function () { return '<span style="width:3px;height:3px;border-radius:2px;background:#ff6b60;transition:height .1s linear, opacity .15s;opacity:.4;"></span>'; }).join('') + '</span>' +
						'<span style="margin-left:auto;font-size:10px;opacity:.55;">it lands where you pick</span></div>' +
						'<div id="flowlive" style="max-height:64px;overflow-y:auto;font-size:12.5px;line-height:1.45;opacity:.92;">Listening…</div>' +
						'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
							['composer|Composer', 'chi|Ask Chi', 'copy|Copy'].map(function (o) {
								var k2 = o.split('|')[0], lb = o.split('|')[1];
								var selT = (localStorage.getItem('chi-flow-target') || 'composer') === k2;
								return '<span class="flowt" data-ft="' + k2 + '" style="padding:3px 11px;border-radius:11px;cursor:pointer;font-size:10.5px;font-weight:700;border:1px solid ' + (selT ? 'rgba(48,209,88,.5)' : 'rgba(128,128,128,.3)') + ';background:' + (selT ? 'rgba(48,209,88,.18)' : 'transparent') + ';color:' + (selT ? GREEN : 'inherit') + ';">' + lb + '</span>';
							}).join('') +
							'<span class="flowt" id="flowpolish" style="margin-left:auto;padding:3px 11px;border-radius:11px;cursor:pointer;font-size:10.5px;font-weight:700;border:1px solid ' + (localStorage.getItem('chi-flow-polish') !== '0' ? 'rgba(59,155,255,.5)' : 'rgba(128,128,128,.3)') + ';background:' + (localStorage.getItem('chi-flow-polish') !== '0' ? 'rgba(59,155,255,.16)' : 'transparent') + ';color:' + (localStorage.getItem('chi-flow-polish') !== '0' ? '#8fc2ff' : 'inherit') + ';">✨ Polish</span>' +
							'<span id="flowgo" style="padding:4px 14px;border-radius:11px;cursor:pointer;font-size:10.5px;font-weight:800;background:rgba(48,209,88,.9);color:#fff;box-shadow:0 2px 8px rgba(48,209,88,.4);">Done</span>' +
							'<span id="flowcancel" style="padding:4px 10px;border-radius:11px;cursor:pointer;font-size:10.5px;font-weight:600;opacity:.65;">Cancel</span>' +
						'</div>' +
					'</div>' +
					'<div id="replybar" style="display:none;width:100%;margin-bottom:6px;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-radius:13px;animation:chiMsgIn .3s ease both;' + t.chi + '">' +
						'<svg width="12" height="12" viewBox="0 0 12 12" style="opacity:.7;flex-shrink:0;"><path d="M5 2 L2 5 L5 8 M2.5 5 H8 a2 2 0 0 1 2 2 v2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
						'<span id="replyname" style="font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>' +
						'<span id="replymic" title="Speak your reply" style="margin-left:auto;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;opacity:.65;"><svg width="11" height="11" viewBox="0 0 16 16"><rect x="6" y="1.5" width="4" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 7.5 c0 2.5 2 4.5 4.5 4.5 s4.5 -2 4.5 -4.5 M8 12 v2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>' +
					'<span id="replycancel" title="Cancel reply" style="width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;opacity:.6;"><svg width="9" height="9" viewBox="0 0 12 12"><path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>' +
					'</div>' +
					'<div id="inputpill" style="width:100%;height:44px;border-radius:22px;display:flex;align-items:center;gap:6px;padding:0 6px 0 16px;transition:border-color .2s, box-shadow .2s;' + t.input + '">' +
						'<input id="in" placeholder="Ask Chi anything…" style="flex:1;font-size:13px;color:' + t.inputText + ';font-family:inherit;">' +
						'<div id="flowbtn" class="ctl" title="Flow — dictate anything, fast" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:' + t.dim + ';"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 10.5 c1 0 1 -2.4 2 -2.4 s1 3.6 2 3.6 1.2 -5 2.2 -5"/><path d="M10.2 12.6 L14 8.8 a1.1 1.1 0 0 0 -1.6 -1.6 L8.6 11 8.2 13 Z" stroke-linejoin="round"/></svg></div>' +
						(this._hasRealtime() ? '<div id="voicebtn" class="ctl" title="Talk to Chi (realtime)" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:' + t.dim + ';"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8v0M5.5 5.5v5M8 3v10M10.5 5.5v5M13 8v0"/></svg></div>' : '') +
						'<div id="micbtn" class="ctl" title="Dictate" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:' + t.dim + ';"><svg width="14" height="14" viewBox="0 0 16 16"><rect x="6" y="1.5" width="4" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 7.5 c0 2.5 2 4.5 4.5 4.5 s4.5 -2 4.5 -4.5 M8 12 v2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></div>' +
						'<div id="sendbtn" title="Send" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(48,209,88,.9);color:#fff;box-shadow:0 2px 8px rgba(48,209,88,.4);"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 13 V3 M4 7 L8 3 L12 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
					'</div>' +
				'</div>';
			this.shadowRoot.innerHTML = head + this._shell(inner + (this._settingsOpen ? this._settingsHTML() : ''));

			if (!this.history.length) this.history.push({ who: 'chi', text: "Hi, I'm Chi. Ask me anything — I'll draw a circle around it." });
			this.shadowRoot.getElementById('sendbtn').addEventListener('click', function () { self._send(); });
			this.shadowRoot.getElementById('in').addEventListener('keydown', function (e) { if (e.key === 'Enter') self._send(); });
			var rc = this.shadowRoot.getElementById('replycancel');
			if (rc) rc.addEventListener('click', function () { self._replyTo = null; self._syncReplyBar(); });
			this._syncReplyBar(); // restore the bar if a reply was in progress across a re-render
			var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
			var mic = this.shadowRoot.getElementById('micbtn');
			if (SR) mic.addEventListener('click', function () { self._mic(); }); else mic.style.display = 'none';
			var rm = this.shadowRoot.getElementById('replymic');
			if (rm) { if (SR) rm.addEventListener('click', function () { self._mic(); }); else rm.style.display = 'none'; }
			var fb = this.shadowRoot.getElementById('flowbtn');
			if (fb) {
				fb.addEventListener('click', function () { if (self._flowActivation() === 'hold') return; if (self._flow) self._flowFinish(); else self._flowStart(); });
				fb.addEventListener('pointerdown', function () { if (self._flowActivation() !== 'hold' || self._flow) return; self._flowStart(); });
				var fbUp = function () { if (self._flowActivation() === 'hold' && self._flow) self._flowFinish(); };
				fb.addEventListener('pointerup', fbUp);
				fb.addEventListener('pointercancel', fbUp);
			}
			var fgo = this.shadowRoot.getElementById('flowgo'); if (fgo) fgo.addEventListener('click', function () { self._flowFinish(); });
			var fca = this.shadowRoot.getElementById('flowcancel'); if (fca) fca.addEventListener('click', function () { self._flowCancel(); });
			var fpanel = this.shadowRoot.getElementById('flowpanel');
			if (fpanel) fpanel.addEventListener('click', function (e) {
				var ft = e.target.closest('.flowt'); if (!ft) return;
				if (ft.id === 'flowpolish') {
					var wasP = localStorage.getItem('chi-flow-polish') !== '0';
					localStorage.setItem('chi-flow-polish', wasP ? '0' : '1');
					ft.style.border = '1px solid ' + (!wasP ? 'rgba(59,155,255,.5)' : 'rgba(128,128,128,.3)');
					ft.style.background = !wasP ? 'rgba(59,155,255,.16)' : 'transparent';
					ft.style.color = !wasP ? '#8fc2ff' : 'inherit';
					return;
				}
				var k3 = ft.getAttribute('data-ft'); if (!k3) return;
				localStorage.setItem('chi-flow-target', k3);
				fpanel.querySelectorAll('.flowt[data-ft]').forEach(function (o2) {
					var selT = o2.getAttribute('data-ft') === k3;
					o2.style.border = '1px solid ' + (selT ? 'rgba(48,209,88,.5)' : 'rgba(128,128,128,.3)');
					o2.style.background = selT ? 'rgba(48,209,88,.18)' : 'transparent';
					o2.style.color = selT ? GREEN : 'inherit';
				});
			});
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
			var fchip = r.getElementById('focuschip');
			if (fchip) fchip.addEventListener('click', function (e) { e.stopPropagation(); self._endFocus(true); });
			this._focusEnsure(); // restore a running countdown across re-renders
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
