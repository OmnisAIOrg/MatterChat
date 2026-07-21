/* <word-clock-widget> — MatterChat sidebar clock + Word of the Day
 * Framework-agnostic Web Component (no dependencies). Drop into any stack.
 * Attributes:
 *   format="12|24"        clock format (default 12)
 *   word-seconds="9"      how long the word card shows
 *   clock-seconds="5"     clock-only rest between words
 *   accent="#ffd60a"      label/ticker accent color
 *   wallpaper="url"       background image (dark image recommended)
 * Property:
 *   el.words = [{word, pos, def}, ...]  // set before or after mount
 * Persists collapsed state in localStorage("wcw-collapsed").
 */
class WordClockWidget extends HTMLElement {
  static DEFAULT_WORDS = [
    { word: 'Facetious', pos: 'adj.', def: 'Treating serious issues with deliberately inappropriate humor.' },
    { word: 'Ephemeral', pos: 'adj.', def: 'Lasting for a very short time; fleeting.' },
    { word: 'Sonder', pos: 'n.', def: 'The realization that each passerby has a life as vivid as your own.' },
    { word: 'Petrichor', pos: 'n.', def: 'The pleasant, earthy smell after rain falls on dry ground.' },
    { word: 'Limerence', pos: 'n.', def: 'The euphoric, all-consuming early state of being in love.' },
    { word: 'Vellichor', pos: 'n.', def: 'The strange wistfulness of used bookstores.' },
  ];
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._words = WordClockWidget.DEFAULT_WORDS;
    this._idx = 0; this._phase = 'word';
    this._collapsed = localStorage.getItem('wcw-collapsed') === '1';
  }
  get words() { return this._words; }
  set words(w) { if (Array.isArray(w) && w.length) { this._words = w; this._idx = 0; this._render(); } }
  connectedCallback() {
    this._render();
    this._clockT = setInterval(() => this._tickClock(), 1000);
    this._schedule();
  }
  disconnectedCallback() { clearInterval(this._clockT); clearTimeout(this._phaseT); }
  _num(attr, dflt) { const v = parseFloat(this.getAttribute(attr)); return isNaN(v) ? dflt : v; }
  _schedule() {
    clearTimeout(this._phaseT);
    const ms = (this._phase === 'word' ? this._num('word-seconds', 9) : this._num('clock-seconds', 5)) * 1000;
    this._phaseT = setTimeout(() => {
      if (this._phase === 'word') this._phase = 'clock';
      else { this._phase = 'word'; this._idx = (this._idx + 1) % this._words.length; }
      this._applyPhase(); this._schedule();
    }, ms);
  }
  _time() {
    const now = new Date(); let h = now.getHours(), ampm = '';
    if (this.getAttribute('format') !== '24') { ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; }
    return { t: h + ':' + String(now.getMinutes()).padStart(2, '0'), ampm,
      d: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) };
  }
  _tickClock() {
    const { t, ampm, d } = this._time();
    for (const el of this.shadowRoot.querySelectorAll('[data-time]')) el.textContent = t;
    for (const el of this.shadowRoot.querySelectorAll('[data-ampm]')) el.textContent = ampm;
    const de = this.shadowRoot.querySelector('[data-date]'); if (de) de.textContent = d;
  }
  _toggle() { this._collapsed = !this._collapsed; localStorage.setItem('wcw-collapsed', this._collapsed ? '1' : '0'); this._render(); }
  _applyPhase() {
    const r = this.shadowRoot, w = this._words[this._idx], showWord = this._phase === 'word';
    const clock = r.querySelector('.clock'), card = r.querySelector('.card');
    if (clock) clock.style.transform = showWord ? 'translateY(56px)' : 'translateY(118px)';
    if (card) { card.style.opacity = showWord ? '1' : '0'; card.style.transform = showWord ? 'translateY(0)' : 'translateY(18px)'; card.style.pointerEvents = showWord ? '' : 'none'; }
    if (showWord) {
      const body = r.querySelector('.word-body');
      if (body) {
        body.innerHTML = '<div class="wrow"><span class="w">' + w.word + '</span><span class="pos">(' + w.pos + ')</span></div><div class="def">' + w.def + '</div>';
        body.style.animation = 'none'; void body.offsetWidth; body.style.animation = '';
      }
      r.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i === this._idx));
    }
  }
  _render() {
    const accent = this.getAttribute('accent') || '#ffd60a';
    const wp = this.getAttribute('wallpaper');
    const { t, ampm, d } = this._time();
    const w = this._words[this._idx];
    const css = `
      :host { display:block; font-family:-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; }
      * { box-sizing:border-box; }
      .expanded { position:relative; height:400px; border-radius:22px; overflow:hidden;
        background:#101014 ${wp ? "url('" + wp + "') center/cover" : ''};
        box-shadow:0 18px 44px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.10); }
      .scrim { position:absolute; inset:0; pointer-events:none;
        background:linear-gradient(180deg, rgba(8,9,12,.55) 0%, rgba(8,9,12,.10) 34%, rgba(8,9,12,.15) 62%, rgba(8,9,12,0) 100%); }
      .toggle { position:absolute; top:12px; right:12px; z-index:5; width:28px; height:28px; border-radius:50%;
        display:flex; align-items:center; justify-content:center; cursor:pointer; border:1px solid rgba(255,255,255,.18);
        background:rgba(255,255,255,.10); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); color:rgba(255,255,255,.85); }
      .toggle:hover { background:rgba(255,255,255,.22); }
      .clock { position:absolute; left:0; right:0; top:0; padding:26px 18px 0; display:flex; flex-direction:column;
        align-items:center; pointer-events:none; transition:transform .8s cubic-bezier(.32,.72,.28,1); transform:translateY(56px); }
      .date { font-size:15px; font-weight:600; color:rgba(255,255,255,.92); text-shadow:0 1px 10px rgba(0,0,0,.4); }
      .trow { display:flex; align-items:baseline; margin-top:-4px; }
      .time { font-size:82px; font-weight:250; letter-spacing:-3px; line-height:1.05; color:rgba(255,255,255,.92);
        text-shadow:0 2px 24px rgba(0,0,0,.45); font-variant-numeric:tabular-nums; }
      .ampm { font-size:22px; font-weight:500; color:rgba(255,255,255,.75); margin-left:6px; }
      .card { position:absolute; left:14px; right:14px; bottom:16px; transition:opacity .7s ease, transform .8s cubic-bezier(.32,.72,.28,1); }
      .glass { position:relative; overflow:hidden; border-radius:18px; padding:14px 16px 13px;
        background:rgba(255,255,255,.09); backdrop-filter:blur(24px) saturate(1.6); -webkit-backdrop-filter:blur(24px) saturate(1.6);
        border:1px solid rgba(255,255,255,.16); box-shadow:inset 0 1px 0 rgba(255,255,255,.22), 0 10px 30px rgba(0,0,0,.35); }
      .sheen { position:absolute; top:-40%; bottom:-40%; width:38px; pointer-events:none;
        background:linear-gradient(90deg, transparent, rgba(255,255,255,.10), transparent); animation:sheen 7s ease-in-out infinite; }
      .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:7px; }
      .label { font-size:10px; font-weight:700; letter-spacing:2.2px; color:${accent}; }
      .dots { display:flex; gap:4px; } .dot { width:4px; height:4px; border-radius:50%; background:rgba(255,255,255,.28); transition:background .4s; }
      .dot.on { background:${accent}; }
      .word-body { animation:wordIn .55s cubic-bezier(.2,.7,.3,1) both; }
      .wrow { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
      .w { font-size:22px; font-weight:700; letter-spacing:.5px; color:rgba(255,255,255,.96); }
      .pos { font-size:12px; font-style:italic; color:rgba(255,255,255,.6); }
      .def { margin-top:3px; font-size:13px; line-height:1.45; color:rgba(255,255,255,.82); text-wrap:pretty; }
      .pill { position:relative; overflow:hidden; height:46px; border-radius:23px; cursor:pointer; display:flex; align-items:center;
        gap:10px; padding:0 14px 0 16px; background:rgba(255,255,255,.07); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px);
        border:1px solid rgba(255,255,255,.13); box-shadow:inset 0 1px 0 rgba(255,255,255,.15), 0 8px 22px rgba(0,0,0,.4); }
      .pill:hover { background:rgba(255,255,255,.13); }
      .pt { font-size:15px; font-weight:600; color:rgba(255,255,255,.92); font-variant-numeric:tabular-nums; flex-shrink:0; }
      .pt small { font-size:10px; color:rgba(255,255,255,.6); }
      .ticker { flex:1; overflow:hidden; position:relative; height:16px;
        mask-image:linear-gradient(90deg, transparent, black 12px, black calc(100% - 12px), transparent);
        -webkit-mask-image:linear-gradient(90deg, transparent, black 12px, black calc(100% - 12px), transparent); }
      .ticker > div { position:absolute; white-space:nowrap; display:flex; animation:ticker 14s linear infinite;
        font-size:11px; color:rgba(255,255,255,.65); line-height:16px; }
      .ticker span.seg { padding-right:32px; } .ticker b { font-weight:700; color:${accent}; }
      @keyframes wordIn { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
      @keyframes sheen { 0% { transform:translateX(-120%) rotate(8deg); } 100% { transform:translateX(220%) rotate(8deg); } }
      @keyframes ticker { 0% { transform:translateX(0); } 100% { transform:translateX(-50%); } }
      @media (prefers-reduced-motion: reduce) { .sheen, .ticker > div, .word-body { animation:none !important; } }
    `;
    const chevron = dir => '<svg width="12" height="12" viewBox="0 0 12 12"><path d="' + (dir === 'down' ? 'M2 4.5 L6 8.5 L10 4.5' : 'M2 7.5 L6 3.5 L10 7.5') + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const seg = '<span class="seg"><b>' + w.word + '</b> · ' + w.def + '</span>';
    this.shadowRoot.innerHTML = '<style>' + css + '</style>' + (this._collapsed
      ? '<div class="pill" part="pill"><span class="pt"><span data-time>' + t + '</span> <small data-ampm>' + ampm + '</small></span><div class="ticker"><div>' + seg + seg + '</div></div>' + chevron('up') + '</div>'
      : '<div class="expanded" part="expanded"><div class="scrim"></div><div class="toggle" title="Collapse">' + chevron('down') + '</div>' +
        '<div class="clock"><div class="date" data-date>' + d + '</div><div class="trow"><span class="time" data-time>' + t + '</span><span class="ampm" data-ampm>' + ampm + '</span></div></div>' +
        '<div class="card"><div class="glass"><div class="sheen"></div><div class="head"><span class="label">WORD OF THE DAY</span><div class="dots">' +
        this._words.map(() => '<span class="dot"></span>').join('') + '</div></div><div class="word-body"></div></div></div></div>');
    const tg = this.shadowRoot.querySelector('.toggle') || this.shadowRoot.querySelector('.pill');
    tg.addEventListener('click', () => this._toggle());
    this._applyPhase();
  }
}
if (!customElements.get('word-clock-widget')) customElements.define('word-clock-widget', WordClockWidget);
