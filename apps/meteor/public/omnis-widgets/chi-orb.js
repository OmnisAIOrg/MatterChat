/* <chi-orb> — Chi AI assistant orb (Omnis AI)
 * Round glass chat window; the ensō is Chi's signature and runs the brand
 * "ingest" ripple loop (from enso-loader) while Chi thinks.
 * Zero dependencies. Plug in any LLM via the ask adapter.
 *
 * Usage:
 *   <script src="chi-orb.js"></script>
 *   <chi-orb theme="dark" asset-base="./enso-assets/"></chi-orb>
 *   <script>
 *     const chi = document.querySelector('chi-orb');
 *     // REAL LLM: set an async adapter — receives (text, history[]) and returns the reply string
 *     chi.ask = async (text, history) => {
 *       const r = await fetch('/api/chat', {method:'POST', body: JSON.stringify({text, history})});
 *       return (await r.json()).reply;
 *     };
 *   </script>
 *
 * Attributes: theme="dark|light|warm|legal"  asset-base="path/to/enso-assets/"  think-seconds="2.4" (demo fallback only)
 * Without an adapter it uses canned demo replies. Minimized state persists in localStorage("chi-orb-min").
 */
(function(){
'use strict';
var THEMES = {
  dark:  { page:'radial-gradient(90% 90% at 50% 40%, #14181d 0%, #0c0e11 70%)', win:'radial-gradient(120% 100% at 50% 0%, rgba(32,38,45,.94) 0%, rgba(13,15,19,.97) 70%)', winBorder:'rgba(255,255,255,.20)', name:'#f2f3f5', dim:'rgba(255,255,255,.45)', me:'background:rgba(48,209,88,.16);border:1px solid rgba(48,209,88,.3);color:#e9f7ee;', chi:'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);color:#dfe3e8;', input:'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);', inputText:'#e8eaed' },
  light: { page:'radial-gradient(90% 90% at 50% 40%, #ffffff 0%, #e8ebef 70%)', win:'radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,.97) 0%, rgba(238,241,245,.98) 70%)', winBorder:'rgba(0,0,0,.10)', name:'#1b1e22', dim:'rgba(0,0,0,.45)', me:'background:rgba(31,157,69,.14);border:1px solid rgba(31,157,69,.3);color:#14532d;', chi:'background:rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.08);color:#2a2e33;', input:'background:rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.12);', inputText:'#23272c', markFilter:'brightness(0) saturate(100%) invert(35%) sepia(65%) saturate(1900%) hue-rotate(205deg) brightness(0.98)' },
  warm:  { page:'radial-gradient(90% 90% at 50% 40%, #f7f1e4 0%, #e9e0cd 70%)', win:'radial-gradient(120% 100% at 50% 0%, rgba(253,249,240,.97) 0%, rgba(243,235,219,.98) 70%)', winBorder:'rgba(90,66,34,.16)', name:'#2e2820', dim:'rgba(90,66,34,.55)', me:'background:rgba(31,157,69,.13);border:1px solid rgba(31,157,69,.28);color:#1d4d2c;', chi:'background:rgba(90,66,34,.07);border:1px solid rgba(90,66,34,.12);color:#3a352c;', input:'background:rgba(90,66,34,.07);border:1px solid rgba(90,66,34,.16);', inputText:'#33302a', markFilter:'brightness(0) saturate(100%) invert(35%) sepia(65%) saturate(1900%) hue-rotate(205deg) brightness(0.98)' },
  legal: { page:'radial-gradient(90% 90% at 50% 40%, #101c33 0%, #0a1222 70%)', win:'radial-gradient(120% 100% at 50% 0%, rgba(20,32,56,.95) 0%, rgba(10,17,32,.97) 70%)', winBorder:'rgba(201,168,106,.35)', name:'#e8d9b8', dim:'rgba(232,217,184,.6)', me:'background:rgba(201,168,106,.14);border:1px solid rgba(201,168,106,.35);color:#f0e6cd;', chi:'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#dce3ee;', input:'background:rgba(201,168,106,.08);border:1px solid rgba(201,168,106,.3);', inputText:'#efe8d8' }
};
var CANNED = ["Here's what I found — want me to go deeper?","Done. Anything else on your mind?","Good question. Short answer: yes — and I can show you why.","I've drafted that for you. Want it posted to the channel?"];
var RIPPLE = "radial-gradient(circle at 50% 50%, rgba(120,185,255,0) 15%, rgba(130,195,255,.2) 20%, rgba(125,192,255,.42) 25%, rgba(110,190,255,.95) 27%, #ffffff 29.5%, #ffffff 31.5%, rgba(130,200,255,.9) 34%, rgba(90,170,255,0) 38%)";
function ripples(base){
  var d = ['0s','.43s','.87s'];
  return d.map(function(delay){
    return '<div style="position:absolute;left:50%;top:50%;width:150%;height:185%;transform:translate(-50%,-50%);mix-blend-mode:screen;background:'+RIPPLE+';animation:chiRipple 1.3s ease-out '+delay+' infinite;"></div>';
  }).join('');
}
class ChiOrb extends HTMLElement {
  constructor(){
    super();
    this.attachShadow({mode:'open'});
    this.ask = null;                       // async (text, history) => reply  — PLUG YOUR LLM HERE
    this.actions = null;                   // [{label, command}] suggested-action chips (or JSON in actions="" attr)
    this.onvoice = null;                   // callback(transcript) — reroute to your realtime stream if desired
    this._listening = false;
    this.history = [];                     // [{who:'me'|'chi', text}]
    this._thinking = false;
    this._min = localStorage.getItem('chi-orb-min')==='1';
  }
  static get observedAttributes(){ return ['theme','asset-base']; }
  attributeChangedCallback(){ if(this.shadowRoot && this.shadowRoot.childNodes.length) this._render(); }
  connectedCallback(){ this._render(); }
  get _theme(){ return THEMES[this.getAttribute('theme')] || THEMES.dark; }
  get _base(){ return this.getAttribute('asset-base') || 'enso-assets/'; }
  _toggle(){ this._min=!this._min; localStorage.setItem('chi-orb-min', this._min?'1':'0'); this._render(); }
  _bubble(m){
    var t=this._theme;
    return 'max-width:82%;padding:9px 14px;font-size:13px;line-height:1.5;animation:chiMsgIn .4s cubic-bezier(.2,.7,.3,1) both;' +
      (m.who==='me' ? 'align-self:flex-end;border-radius:18px 4px 18px 18px;'+t.me : 'align-self:flex-start;border-radius:4px 18px 18px 18px;'+t.chi);
  }
  _actionsList(){
    if(Array.isArray(this.actions)&&this.actions.length) return this.actions;
    var a=this.getAttribute('actions'); if(a){ try{ return JSON.parse(a); }catch(e){} }
    return [{label:'Summarize this channel',command:'Summarize this channel'},{label:'Draft a reply',command:'Draft a reply to the last message'},{label:"What's new?",command:'What is new today?'}];
  }
  _mic(){
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return;
    var self=this;
    if(this._listening){ try{this._rec.stop();}catch(e){} return; } // 2nd click = stop → onend sends
    var rec=new SR(); this._rec=rec; rec.lang=this.getAttribute('lang')||'en-US';
    // CONTINUOUS so it doesn't cut off after ~1s of silence; interim results stream the transcript
    // live into the input. Sending happens when the user stops (clicks the mic again) or recognition
    // ends, so a natural pause doesn't fire a half-formed message.
    rec.continuous=true; rec.interimResults=true; self._voiceFinal='';
    rec.onresult=function(e){
      var interim='';
      for(var i=e.resultIndex;i<e.results.length;i++){ var r=e.results[i]; if(r.isFinal) self._voiceFinal+=r[0].transcript; else interim+=r[0].transcript; }
      var inp=self.shadowRoot.getElementById('in'); if(inp) inp.value=(self._voiceFinal+interim).trim();
    };
    rec.onend=function(){
      self._listening=false; self._sync();
      var inp=self.shadowRoot.getElementById('in'); var t=inp?(inp.value||'').trim():'';
      if(t){ if(self.onvoice) self.onvoice(t); self._send(); }
    };
    rec.onerror=function(){ self._listening=false; self._sync(); };
    this._listening=true; this._sync(); rec.start();
  }
  _send(){
    var input=this.shadowRoot.getElementById('in');
    var text=(input.value||'').trim();
    if(!text||this._thinking) return;
    input.value='';
    this.history.push({who:'me',text:text});
    this._thinking=true; this._sync();
    var self=this;
    function done(r){ self._thinking=false; self.history.push({who:'chi',text:String(r)}); self._sync(); }
    if(this.ask){ Promise.resolve().then(function(){return self.ask(text,self.history.slice());}).then(done).catch(function(){done(CANNED[0]);}); }
    else if(window.claude&&window.claude.complete){ window.claude.complete('You are Chi, a concise, warm AI assistant. Reply briefly to: '+text).then(done).catch(function(){done(CANNED[0]);}); }
    else { setTimeout(function(){done(CANNED[Math.floor(Math.random()*CANNED.length)]);}, (parseFloat(self.getAttribute('think-seconds'))||2.4)*1000); }
  }
  _sync(){ // re-render message list + thinking state without rebuilding input
    var r=this.shadowRoot, list=r.getElementById('msgs'); if(!list){this._render();return;}
    var self=this;
    list.innerHTML=this.history.map(function(m){return '<div style="'+self._bubble(m)+'"></div>';}).join('');
    Array.prototype.forEach.call(list.children,function(el,i){ el.textContent=self.history[i].text; });
    if(this._thinking){
      var d=document.createElement('div');
      d.setAttribute('style','align-self:flex-start;display:flex;gap:5px;padding:11px 14px;border-radius:4px 18px 18px 18px;'+this._theme.chi);
      d.innerHTML='<i style="width:5px;height:5px;border-radius:50%;background:#7ee2a0;animation:chiDot 1.2s infinite;display:block;"></i><i style="width:5px;height:5px;border-radius:50%;background:#7ee2a0;animation:chiDot 1.2s .2s infinite;display:block;"></i><i style="width:5px;height:5px;border-radius:50%;background:#7ee2a0;animation:chiDot 1.2s .4s infinite;display:block;"></i>';
      list.appendChild(d);
    }
    var ch=r.getElementById('chips');
    if(ch) ch.style.display=this.history.some(function(m){return m.who==='me';})?'none':'';
    list.scrollTop=list.scrollHeight;
    var st=r.getElementById('status');
    st.textContent=this._thinking?'THINKING':(this._listening?'LISTENING':'');
    st.style.color=(this._thinking||this._listening)?'#30d158':this._theme.dim;
    st.style.textShadow=(this._thinking||this._listening)?'0 0 12px rgba(48,209,88,.8)':'none';
    r.getElementById('halo').style.opacity=this._thinking?'1':'0';
    r.getElementById('markloop').style.display=(this._thinking||this._listening)?'':'none';
    var mic=r.getElementById('micbtn');
    if(mic){ mic.style.background=this._listening?'rgba(48,209,88,.25)':'rgba(255,255,255,.08)'; mic.style.color=this._listening?'#30d158':this._theme.dim; }
  }
  _render(){
    var t=this._theme, A=this._base, self=this;
    var mask='-webkit-mask:url('+A+'omnis-enso-bristle.svg) center/contain no-repeat;mask:url('+A+'omnis-enso-bristle.svg) center/contain no-repeat;';
    var kf='@keyframes chiRipple{0%{transform:translate(-50%,-50%) scale(2.05);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(-50%,-50%) scale(.3);opacity:0}}@keyframes chiMsgIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes chiDot{0%,80%,100%{opacity:.25}40%{opacity:1}}@keyframes chiHalo{0%,100%{opacity:.25}50%{opacity:.6}}@media (prefers-reduced-motion:reduce){*{animation:none !important}}';
    if(this._min){
      this.shadowRoot.innerHTML='<style>'+kf+':host{display:block;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}</style>'+
        '<div id="launch" title="Open Chi" style="position:relative;width:76px;height:76px;cursor:pointer;">'+
        '<div style="position:absolute;inset:-14px;border-radius:50%;background:radial-gradient(circle, rgba(48,209,88,.25) 30%, rgba(48,209,88,0) 70%);animation:chiHalo 3s ease-in-out infinite;"></div>'+
        '<img src="'+A+'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:76px;height:76px;filter:'+(this._theme.markFilter||'drop-shadow(0 4px 14px rgba(0,0,0,.5))')+';">'+
        '<div style="position:absolute;inset:0;'+mask+'">'+ripples()+'</div></div>';
      this.shadowRoot.getElementById('launch').addEventListener('click',function(){self._toggle();});
      return;
    }
    this.shadowRoot.innerHTML='<style>'+kf+':host{display:block;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}input{outline:none;border:none;background:transparent}</style>'+
      '<div style="position:relative;width:520px;height:520px;">'+
      '<div id="halo" style="position:absolute;inset:-10px;border-radius:50%;pointer-events:none;background:radial-gradient(circle, rgba(48,209,88,0) 58%, rgba(48,209,88,.22) 76%, rgba(48,209,88,0) 92%);transition:opacity .6s;opacity:0;animation:chiHalo 1.6s ease-in-out infinite;"></div>'+
      '<div style="position:absolute;inset:16px;border-radius:50%;pointer-events:none;background:conic-gradient(from 210deg, rgba(255,255,255,.38), rgba(255,255,255,.03) 22%, rgba(255,255,255,.20) 48%, rgba(255,255,255,.03) 74%, rgba(255,255,255,.38));box-shadow:0 24px 70px rgba(0,0,0,.65), 0 4px 12px rgba(0,0,0,.5);"></div>'+
      '<div style="position:absolute;inset:18px;border-radius:50%;pointer-events:none;background:#0a0c0f;box-shadow:inset 0 2px 6px rgba(255,255,255,.10), inset 0 -3px 8px rgba(0,0,0,.8);"></div>'+
      '<div style="position:absolute;inset:26px;border-radius:50%;overflow:hidden;display:flex;flex-direction:column;background:'+t.win+';border:1px solid '+t.winBorder+';box-shadow:inset 0 2px 1px rgba(255,255,255,.26), inset 0 -2px 2px rgba(0,0,0,.65), inset 0 -46px 90px rgba(0,0,0,.25), 0 12px 26px rgba(0,0,0,.5);">'+
        '<div style="position:absolute;top:0;left:14%;right:14%;height:24%;pointer-events:none;background:radial-gradient(ellipse at 50% 0%, rgba(255,255,255,.16), transparent 70%);"></div>'+
        '<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:2px;padding:30px 0 8px;">'+
          '<div style="position:relative;width:64px;height:52px;">'+
            '<img src="'+A+'omnis-enso-bristle.svg" alt="Chi" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:'+(t.markFilter||'drop-shadow(0 0 10px rgba(255,255,255,.2))')+';">'+
            '<div id="markloop" style="position:absolute;inset:0;display:none;'+mask+'">'+ripples()+'</div>'+
          '</div>'+
          '<div style="font-size:15px;font-weight:800;letter-spacing:3px;color:'+t.name+';">CHI</div>'+
          '<div id="status" style="font-size:10px;letter-spacing:1.4px;font-weight:600;color:'+t.dim+';"></div>'+
        '</div>'+
        '<div id="msgs" style="flex:1;overflow-y:auto;padding:6px 94px 8px;display:flex;flex-direction:column;gap:8px;min-height:0;"></div>'+
        '<div id="chips" style="flex-shrink:0;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:2px 100px 8px;">'+
        this._actionsList().map(function(a,i){return '<button data-i="'+i+'" style="padding:5px 12px;border-radius:13px;cursor:pointer;font:600 11px inherit;font-family:inherit;'+t.chi+'"></button>';}).join('')+
        '</div>'+
        '<div style="flex-shrink:0;padding:6px 110px 46px;display:flex;justify-content:center;">'+
          '<div style="width:100%;height:44px;border-radius:22px;display:flex;align-items:center;gap:8px;padding:0 6px 0 16px;'+t.input+'">'+
            '<input id="in" placeholder="Ask Chi anything…" style="flex:1;font-size:13px;color:'+t.inputText+';font-family:inherit;">'+
            '<div id="micbtn" title="Speak to Chi" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);color:'+t.dim+';"><svg width="14" height="14" viewBox="0 0 16 16"><rect x="6" y="1.5" width="4" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 7.5 c0 2.5 2 4.5 4.5 4.5 s4.5 -2 4.5 -4.5 M8 12 v2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></div>'+
            '<div id="sendbtn" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(48,209,88,.18);border:1px solid rgba(48,209,88,.4);color:#30d158;"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 13 V3 M4 7 L8 3 L12 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div id="minbtn" title="Minimize Chi" style="position:absolute;top:78px;right:78px;z-index:6;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.8);"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6 h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div>'+
      '</div>';
    if(!this.history.length) this.history.push({who:'chi',text:"Hi, I'm Chi. Ask me anything — I'll draw a circle around it."});
    this.shadowRoot.getElementById('minbtn').addEventListener('click',function(){self._toggle();});
    this.shadowRoot.getElementById('sendbtn').addEventListener('click',function(){self._send();});
    this.shadowRoot.getElementById('in').addEventListener('keydown',function(e){ if(e.key==='Enter') self._send(); });
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    var mic=this.shadowRoot.getElementById('micbtn');
    if(SR) mic.addEventListener('click',function(){self._mic();}); else mic.style.display='none';
    var chips=this.shadowRoot.getElementById('chips'), acts=this._actionsList();
    Array.prototype.forEach.call(chips.children,function(b,i){ b.textContent=acts[i].label; });
    chips.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return;
      var inp=self.shadowRoot.getElementById('in'); inp.value=acts[+b.dataset.i].command; self._send(); });
    this._sync();
  }
}
if (!customElements.get('chi-orb')) customElements.define('chi-orb', ChiOrb);
})();
