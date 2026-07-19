/*!
 * Omnis AI — Ensō Loader (Green) v1.3
 * Brand loading animation: charge → implode → ignite → reveal.
 * Vanilla JS, no dependencies. Works over any app (dark or light UI via scrim).
 *
 * ONE-SHOT (3.5s splash), auto-play on page load:
 *   <script src="enso-loader.js" data-auto></script>
 *
 * HOLD MODE (true loading screen — loops the charge until your app is ready):
 *   <script src="enso-loader.js" data-auto data-hold></script>
 *   ...later, when the app has booted:
 *   EnsoLoader.done();   // ignites + reveals (~1.3s)
 *
 * Programmatic:
 *   EnsoLoader.play({ scrim:true, hold:true, size:340, onDone:() => {} });
 *   EnsoLoader.done();
 *
 * Options:
 *   scrim          (bool, default true)   dim layer under the mark — use over light UIs
 *   hold           (bool, default false)  loop charging until EnsoLoader.done() is called
 *   size           (number, default 340)  mark width in px (e.g. 170 half, 34 tiny)
 *   firstVisitOnly (bool, default false)  remember in localStorage, skip on return visits
 *   storageKey     (string)               localStorage key for the above
 *   zIndex         (number, default 99999)
 *   assetBase      (string)               override path to enso-assets/ (default: next to this script)
 *   onDone         (function)             called when the overlay has fully faded out
 *
 * Also dispatches `window` event: 'enso-loader-done'
 */
(function (global) {
  'use strict';

  var script = document.currentScript;
  var DEFAULT_BASE = script ? script.src.replace(/[^\/]*$/, '') + 'enso-assets/' : 'enso-assets/';

  var CSS = [
    /* ---- shared ---- */
    '@keyframes ensoScrimIn{0%{opacity:0}100%{opacity:1}}',
    '@keyframes ensoRipple{0%{transform:translate(-50%,-50%) scale(2.05);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(-50%,-50%) scale(.3);opacity:0}}',
    /* ---- one-shot timeline (3.5s) ---- */
    '@keyframes ensoVanish{0%,88%{opacity:1}100%{opacity:0}}',
    '@keyframes ensoBloom{0%{filter:brightness(.8);animation-timing-function:cubic-bezier(.45,0,.75,.4)}50%{filter:brightness(.98);animation-timing-function:cubic-bezier(.55,0,.8,.35)}62%{filter:brightness(1.18);animation-timing-function:cubic-bezier(.25,.8,.35,1)}68%{filter:brightness(.85);animation-timing-function:cubic-bezier(.7,0,.9,.4)}74%{filter:brightness(1.55)}100%{filter:brightness(1.55)}}',
    '@keyframes ensoDim{0%{opacity:.66;animation-timing-function:cubic-bezier(.45,0,.75,.4)}50%{opacity:.48}62%{opacity:.2;animation-timing-function:cubic-bezier(.25,.8,.35,1)}68%{opacity:.44;animation-timing-function:cubic-bezier(.7,0,.9,.4)}74%{opacity:0}100%{opacity:0}}',
    '@keyframes ensoScale{0%,62%{transform:scale(1)}68%{transform:scale(.968);animation-timing-function:cubic-bezier(.7,0,.85,.5)}74%{transform:scale(1.035)}84%{transform:scale(1.01)}100%{transform:scale(1.01)}}',
    '@keyframes ensoFill{0%,70%{opacity:0}74%{opacity:1}100%{opacity:1}}',
    '@keyframes ensoPeakBloom{0%,69%{filter:drop-shadow(0 0 0 rgba(255,255,255,0))}74%{filter:drop-shadow(0 0 14px #ffffff) drop-shadow(0 0 40px rgba(150,245,185,.9)) drop-shadow(0 0 85px rgba(90,220,140,.6))}100%{filter:drop-shadow(0 0 14px #ffffff) drop-shadow(0 0 40px rgba(150,245,185,.9)) drop-shadow(0 0 85px rgba(90,220,140,.6))}}',
    '@keyframes ensoPop{0%,72%{opacity:0}74.5%{opacity:.95}80%{opacity:.1}84%{opacity:0}100%{opacity:0}}',
    '@keyframes ensoShock{0%,66%{opacity:0;transform:translate(-50%,-50%) scale(1.75)}68%{opacity:.9}74%{opacity:0;transform:translate(-50%,-50%) scale(.55)}100%{opacity:0;transform:translate(-50%,-50%) scale(.55)}}',
    '@keyframes ensoEmber{0%,62%{opacity:0;transform:translate(var(--ex),var(--ey)) scale(.35)}66%{opacity:1}73%,100%{opacity:0;transform:translate(0,0) scale(.9)}}',
    '@keyframes ensoBuildA{0%,26%{opacity:0}50%{opacity:.75}62%{opacity:.85;animation-timing-function:cubic-bezier(.25,.8,.35,1)}68%{opacity:.5;animation-timing-function:cubic-bezier(.7,0,.9,.4)}74%{opacity:.9}100%{opacity:.9}}',
    '@keyframes ensoBuildB{0%,40%{opacity:0}60%{opacity:.8;animation-timing-function:cubic-bezier(.25,.8,.35,1)}68%{opacity:.45;animation-timing-function:cubic-bezier(.7,0,.9,.4)}74%{opacity:.95}100%{opacity:.95}}',
    '@keyframes ensoBuildC{0%,52%{opacity:0}64%{opacity:.9;animation-timing-function:cubic-bezier(.25,.8,.35,1)}68%{opacity:.4;animation-timing-function:cubic-bezier(.7,0,.9,.4)}74%{opacity:1}100%{opacity:1}}',
    /* ---- hold loop (charging breath, repeats until done()) ---- */
    '@keyframes ensoBloomHold{0%,100%{filter:brightness(.8)}55%{filter:brightness(1.14)}}',
    '@keyframes ensoDimHold{0%,100%{opacity:.6}55%{opacity:.22}}',
    '@keyframes ensoBuildHold{0%,100%{opacity:0}55%{opacity:.55}}',
    /* ---- fire finale (1.3s after done()) ---- */
    '@keyframes ensoVanishFire{0%,72%{opacity:1}100%{opacity:0}}',
    '@keyframes ensoBloomFire{0%{filter:brightness(1.1)}18%{filter:brightness(.85);animation-timing-function:cubic-bezier(.7,0,.9,.4)}30%{filter:brightness(1.55)}100%{filter:brightness(1.55)}}',
    '@keyframes ensoDimFire{0%{opacity:.3}18%{opacity:.44}30%{opacity:0}100%{opacity:0}}',
    '@keyframes ensoScaleFire{0%{transform:scale(1)}18%{transform:scale(.968);animation-timing-function:cubic-bezier(.7,0,.85,.5)}30%{transform:scale(1.035)}45%{transform:scale(1.01)}100%{transform:scale(1.01)}}',
    '@keyframes ensoFillFire{0%,25%{opacity:0}30%{opacity:1}100%{opacity:1}}',
    '@keyframes ensoPeakFire{0%,22%{filter:drop-shadow(0 0 0 rgba(255,255,255,0))}30%{filter:drop-shadow(0 0 14px #ffffff) drop-shadow(0 0 40px rgba(150,245,185,.9)) drop-shadow(0 0 85px rgba(90,220,140,.6))}100%{filter:drop-shadow(0 0 14px #ffffff) drop-shadow(0 0 40px rgba(150,245,185,.9)) drop-shadow(0 0 85px rgba(90,220,140,.6))}}',
    '@keyframes ensoPopFire{0%,26%{opacity:0}31%{opacity:.95}45%{opacity:.1}55%{opacity:0}100%{opacity:0}}',
    '@keyframes ensoShockFire{0%,8%{opacity:0;transform:translate(-50%,-50%) scale(1.75)}14%{opacity:.9}30%{opacity:0;transform:translate(-50%,-50%) scale(.55)}100%{opacity:0;transform:translate(-50%,-50%) scale(.55)}}',
    '@keyframes ensoEmberFire{0%{opacity:0;transform:translate(var(--ex),var(--ey)) scale(.35)}8%{opacity:1}28%,100%{opacity:0;transform:translate(0,0) scale(.9)}}',
    '@keyframes ensoBuildFire{0%{opacity:.5}18%{opacity:.4}30%{opacity:1}100%{opacity:1}}',
    '@keyframes ensoQuietOut{0%{opacity:1}100%{opacity:0}}',
    '.enso-paused *{animation-play-state:paused !important}',
    '.enso-static *{animation:none !important}',
    /* ---- state wiring ---- */
    '[data-enso-loader].enso-oneshot{animation:ensoVanish 3.5s linear forwards}',
    '.enso-oneshot .e-bloom{animation:ensoBloom 3.5s linear both}',
    '.enso-oneshot .e-dim{animation:ensoDim 3.5s linear both}',
    '.enso-oneshot .e-scale{animation:ensoScale 3.5s linear both}',
    '.enso-oneshot .e-fill{animation:ensoFill 3.5s linear both}',
    '.enso-oneshot .e-peak{animation:ensoPeakBloom 3.5s linear both}',
    '.enso-oneshot .e-pop{animation:ensoPop 3.5s linear both}',
    '.enso-oneshot .e-shock{animation:ensoShock 3.5s cubic-bezier(.2,.7,.3,1) both}',
    '.enso-oneshot .e-ember{animation:ensoEmber 3.5s ease-out both}',
    '.enso-oneshot .e-b1{animation:ensoBuildA 3.5s linear both}',
    '.enso-oneshot .e-b2{animation:ensoBuildB 3.5s linear both}',
    '.enso-oneshot .e-b3{animation:ensoBuildC 3.5s linear both}',
    '.enso-hold .e-bloom{animation:ensoBloomHold 2.4s ease-in-out infinite}',
    '.enso-hold .e-dim{animation:ensoDimHold 2.4s ease-in-out infinite}',
    '.enso-hold .e-b1{animation:ensoBuildHold 2.4s ease-in-out infinite}',
    '.enso-hold .e-b2{animation:ensoBuildHold 2.4s ease-in-out -0.8s infinite}',
    '.enso-hold .e-b3{animation:ensoBuildHold 2.4s ease-in-out -1.6s infinite}',
    '[data-enso-loader].enso-fire{animation:ensoVanishFire 1.3s linear forwards}',
    '.enso-fire .e-bloom{animation:ensoBloomFire 1.3s linear both}',
    '.enso-fire .e-dim{animation:ensoDimFire 1.3s linear both}',
    '.enso-fire .e-scale{animation:ensoScaleFire 1.3s linear both}',
    '.enso-fire .e-fill{animation:ensoFillFire 1.3s linear both}',
    '.enso-fire .e-peak{animation:ensoPeakFire 1.3s linear both}',
    '.enso-fire .e-pop{animation:ensoPopFire 1.3s linear both}',
    '.enso-fire .e-shock{animation:ensoShockFire 1.3s cubic-bezier(.2,.7,.3,1) both}',
    '.enso-fire .e-ember{animation:ensoEmberFire 1.3s ease-out both}',
    '.enso-fire .e-b1{animation:ensoBuildFire 1.3s linear both}',
    '.enso-fire .e-b2{animation:ensoBuildFire 1.3s linear both}',
    '.enso-fire .e-b3{animation:ensoBuildFire 1.3s linear both}'
  ].join('\n');

  var EMBERS = [
    [168, 0, -5, -71, 4], [232, 17, 8, -79, 3], [279, 63, 15, -62, 4], [296, 128, 19, -54, 3],
    [104, 17, -10, -74, 4], [58, 63, -16, -65, 3], [41, 128, -19, -54, 3], [191, 3, -3, -82, 4]
  ];

  function ensureStyle() {
    if (document.getElementById('enso-loader-css')) return;
    var s = document.createElement('style');
    s.id = 'enso-loader-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function buildOverlay(o) {
    var A = o.assetBase;
    var scale = (o.size || 340) / 340;
    var mask = function (file) {
      return '-webkit-mask:url(' + A + file + ') center/contain no-repeat;mask:url(' + A + file + ') center/contain no-repeat;';
    };
    var ripple = 'position:absolute;left:50%;top:50%;width:150%;height:185%;transform:translate(-50%,-50%);background:radial-gradient(circle at 50% 50%, rgba(70,235,130,0) 14%, rgba(90,240,150,.28) 19%, rgba(80,240,140,.55) 24%, rgba(60,235,120,1) 27%, #b8ffcf 29.5%, #6bffa2 31.5%, rgba(80,240,140,.95) 34%, rgba(50,215,105,0) 39%);mix-blend-mode:screen;';
    var embers = EMBERS.map(function (e) {
      return '<div class="e-ember" style="position:absolute;left:' + e[0] + 'px;top:' + e[1] + 'px;width:' + e[4] + 'px;height:' + e[4] + 'px;border-radius:50%;background:#fff;box-shadow:0 0 7px #fff,0 0 14px rgba(150,240,180,.9);--ex:' + e[2] + 'px;--ey:' + e[3] + 'px;opacity:0;"></div>';
    }).join('');

    var el = document.createElement('div');
    el.setAttribute('data-enso-loader', '');
    el.className = o.hold ? 'enso-hold' : 'enso-oneshot';
    el.style.cssText = 'position:fixed;inset:0;z-index:' + o.zIndex + ';display:flex;align-items:center;justify-content:center;pointer-events:none;';
    el.innerHTML =
      (o.scrim ? '<div style="position:absolute;inset:0;background:rgba(3,14,7,.9);animation:ensoScrimIn .35s ease-out both;"></div>' : '') +
      '<div style="transform:scale(' + scale + ');">' +
      '<div class="e-scale" style="position:relative;">' +
        '<div class="e-bloom">' +
          '<div style="position:relative;filter:contrast(1.12) saturate(1.05) drop-shadow(-1.6px -1.6px 0 rgba(255,255,255,.9)) drop-shadow(1.8px 1.8px 0 rgba(6,26,13,.95));">' +
            '<div style="position:relative;width:340px;height:276px;' + mask('omnis-enso-bristle.svg') + '">' +
              '<div style="position:absolute;inset:0;background:#04140a;"></div>' +
              '<img src="' + A + 'omnis-enso-bristle.svg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:contrast(1.42) brightness(.98) saturate(1.12);">' +
              '<div style="position:absolute;inset:0;background:#22c25c;mix-blend-mode:multiply;"></div>' +
              '<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 47%, transparent 0 33%, rgba(4,20,10,.6) 39%, rgba(4,20,10,.12) 45%, rgba(4,20,10,0) 47%, rgba(4,20,10,.16) 49%, rgba(4,20,10,.62) 55%, transparent 63%);mix-blend-mode:multiply;"></div>' +
              '<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 46%, transparent 0 42.5%, rgba(210,255,225,.28) 46.5%, transparent 50.5%);mix-blend-mode:screen;"></div>' +
              '<div class="e-dim" style="position:absolute;inset:0;background:linear-gradient(160deg, #186b34 0%, #0c3d1e 100%);mix-blend-mode:multiply;"></div>' +
              '<div style="' + ripple + 'animation:ensoRipple 1.3s ease-out infinite;"></div>' +
              '<div style="' + ripple + 'animation:ensoRipple 1.3s ease-out .43s infinite;"></div>' +
              '<div style="' + ripple + 'animation:ensoRipple 1.3s ease-out .87s infinite;"></div>' +
              '<div class="e-fill" style="position:absolute;inset:0;background:#ffffff;mix-blend-mode:screen;opacity:0;"></div>' +
            '</div>' +
            '<div class="e-b1" style="position:absolute;inset:0;' + mask('omnis-enso-b2.svg') + 'background:#ffffff;mix-blend-mode:screen;opacity:0;"></div>' +
            '<div class="e-b2" style="position:absolute;inset:0;' + mask('omnis-enso-b3.svg') + 'background:#ffffff;mix-blend-mode:screen;opacity:0;"></div>' +
            '<div class="e-b3" style="position:absolute;inset:0;' + mask('omnis-enso-b4.svg') + 'background:#ffffff;mix-blend-mode:screen;opacity:0;"></div>' +
            '<div class="e-peak" style="position:absolute;inset:0;"><div class="e-fill" style="position:absolute;inset:0;' + mask('omnis-enso-solid.png') + 'background:#ffffff;opacity:0;"></div></div>' +
            '<div class="e-shock" style="position:absolute;left:50%;top:47%;width:286px;height:286px;border-radius:50%;border:2px solid rgba(255,255,255,.95);box-shadow:0 0 20px rgba(150,240,180,.8), inset 0 0 20px rgba(150,240,180,.5);opacity:0;"></div>' +
            embers +
            '<div class="e-pop" style="position:absolute;left:50%;top:47%;width:400px;height:400px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle, #ffffff 0%, rgba(235,255,242,.8) 30%, rgba(160,245,190,.3) 55%, transparent 72%);opacity:0;"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '</div>';
    return el;
  }

  var current = null;
  var currentFinish = null;

  /* Ambient embed: loop the charging enso inside any element, forever (decorative). */
  function mount(target, opts) {
    opts = opts || {};
    ensureStyle();
    var box = typeof target === 'string' ? document.querySelector(target) : target;
    if (!box) return null;
    var size = opts.size || Math.min(box.clientWidth || 340, ((box.clientHeight || 276) * 340) / 276);
    var el = buildOverlay({
      scrim: false,
      hold: true,
      zIndex: opts.zIndex || 1,
      size: size,
      assetBase: opts.assetBase || DEFAULT_BASE
    });
    el.style.position = 'absolute';
    el.style.inset = '0';
    var pos = getComputedStyle(box).position;
    if (pos === 'static') box.style.position = 'relative';
    box.appendChild(el);

    /* accessibility: render static for users who turned animations off */
    var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    var applyMotionPref = function () {
      el.classList.toggle('enso-static', !!(mq && mq.matches));
    };
    applyMotionPref();
    if (mq && mq.addEventListener) mq.addEventListener('change', applyMotionPref);

    /* perf: freeze the loop while the container is offscreen */
    var io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        el.classList.toggle('enso-paused', !entries[0].isIntersecting);
      }, { threshold: 0.01 });
      io.observe(box);
    }

    return {
      element: el,
      remove: function () {
        if (io) io.disconnect();
        if (mq && mq.removeEventListener) mq.removeEventListener('change', applyMotionPref);
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  function play(opts) {
    opts = opts || {};
    var o = {
      scrim: opts.scrim !== false,
      hold: !!opts.hold,
      peak: opts.peak !== false,
      firstVisitOnly: !!opts.firstVisitOnly,
      storageKey: opts.storageKey || 'enso-loader-seen',
      zIndex: opts.zIndex || 99999,
      size: opts.size || 340,
      assetBase: opts.assetBase || DEFAULT_BASE,
      onDone: typeof opts.onDone === 'function' ? opts.onDone : null
    };

    function finish() {
      window.dispatchEvent(new CustomEvent('enso-loader-done'));
      if (o.onDone) o.onDone();
    }

    if (o.firstVisitOnly) {
      try {
        if (localStorage.getItem(o.storageKey)) { finish(); return; }
        localStorage.setItem(o.storageKey, String(Date.now()));
      } catch (e) { /* storage unavailable — just play */ }
    }
    if (current) return;

    ensureStyle();
    var el = buildOverlay(o);
    if (!o.peak) el.setAttribute('data-no-peak', '');
    document.body.appendChild(el);
    current = el;
    currentFinish = finish;

    if (!o.hold) {
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        current = null; currentFinish = null;
        finish();
      }, 3550);
    }
  }

  function done() {
    var el = current;
    if (!el) return;
    if (el.className.indexOf('enso-hold') === -1) return; // one-shot manages itself
    if (el.hasAttribute('data-no-peak')) {
      // quiet exit: no ignition — the charging loop just fades away
      el.style.animation = 'ensoQuietOut .8s ease forwards';
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        var f = currentFinish;
        current = null; currentFinish = null;
        if (f) f();
      }, 850);
      return;
    }
    el.className = 'enso-fire';
    el.setAttribute('data-enso-loader', '');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      var f = currentFinish;
      current = null; currentFinish = null;
      if (f) f();
    }, 1350);
  }

  global.EnsoLoader = { play: play, done: done, mount: mount, version: '1.6.0-green' };

  if (script && script.hasAttribute('data-auto')) {
    var go = function () {
      play({
        scrim: script.getAttribute('data-scrim') !== 'false',
        hold: script.hasAttribute('data-hold'),
        peak: script.getAttribute('data-peak') !== 'false',
        firstVisitOnly: script.hasAttribute('data-first-visit-only')
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(window);
