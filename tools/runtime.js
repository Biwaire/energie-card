/*@@HEADER@@*/
/*
 ╔══════════════════════════════════════════════════════════════════════╗
 ║  ENERGIE-CARD @@VERSION@@ — carte Lovelace (custom:energie-card)            ║
 ╚══════════════════════════════════════════════════════════════════════╝
 Installation : HACS (dépôt personnalisé, type « Tableau de bord ») ou manuelle (voir README).
 Configuration : éditeur visuel de la carte. Sans réglage, les capteurs sont détectés automatiquement.
 Toutes les options YAML sont décrites dans le README.
*/
(() => {
'use strict';
const TAG = 'energie-card', VERSION = '@@VERSION@@';
if (customElements.get(TAG)) return;
console.info('%c ENERGIE-CARD %c ' + VERSION + ' ', 'color:#05080f;background:#2dff8a;font-weight:700', 'color:#2dff8a;background:#05080f');

/* tableaux de bord disponibles : « new » est inclus, « classic » est chargé à la demande (fichier voisin) */
const DASH = window.__ENERGIE_CARD_DASH = window.__ENERGIE_CARD_DASH || {};
const STYLE_FILES = { classic: 'energie-card-classic.js', tuyaux: 'energie-card-tuyaux.js' };
const STYLE_NAMES = { new: 'Nouveau', classic: 'Classique', tuyaux: 'Tuyaux' };
const LOADS = {};
let BASE_URL = '';
try { BASE_URL = import.meta.url; } catch (e) {}
function loadStyle(key) {
  if (DASH[key]) return Promise.resolve(DASH[key]);
  if (!LOADS[key]) {
    const url = new URL(STYLE_FILES[key] + '?v=' + VERSION, BASE_URL || location.href).href;
    LOADS[key] = import(url).then(() => {
      if (!DASH[key]) throw new Error('style introuvable');
      return DASH[key];
    }).catch(e => { delete LOADS[key]; throw e; });
  }
  return LOADS[key];
}

/* événements d'interface : écoutés dans la carte, jamais sur toute la page Home Assistant */
const SCOPED = new Set(['click','dblclick','auxclick','contextmenu','mousedown','mouseup','mousemove','mouseover','mouseout',
  'pointerdown','pointerup','pointermove','pointercancel','pointerover','pointerout','touchstart','touchend','touchmove',
  'touchcancel','keydown','keyup','keypress','input','change','wheel','focusin','focusout','beforeinput']);

const BASE_CSS = `/* la carte ne doit rien hériter de la typographie de Home Assistant (comme une iframe) */
:host{all:initial;display:block;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.zh{position:relative;display:block;width:100%;aspect-ratio:16/9;overflow:hidden;contain:layout paint style;container-type:inline-size;container-name:zh;transform:translateZ(0);border-radius:var(--ha-card-border-radius,12px)}
.zh.fit{max-height:calc(100dvh - var(--header-height, 56px) - var(--energie-card-offset, 16px))}
.zh:fullscreen{border-radius:0;max-height:none}
.zhead{display:none}
.zh.paused *,.zh.paused *::before,.zh.paused *::after{animation-play-state:paused!important}
:host(.pfs){position:relative;z-index:2147483000}
.zh.pfs{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-height:none!important;aspect-ratio:auto!important;border-radius:0!important;z-index:2147483000}
#fsbtn{left:8px;bottom:8px}
/* points de vue : coin bas droit, à la verticale (ne cachent plus la barre de navigation) */
#vdots{position:absolute;right:8px;bottom:8px;z-index:60;display:flex;flex-direction:column;gap:12px;padding:10px 8px;border-radius:12px;background:rgba(5,8,15,.55)}
#vdots i{display:block;width:11px;height:11px;border-radius:50%;background:rgba(160,200,255,.35);cursor:pointer}
#vdots i.on{background:#4de1ff;box-shadow:0 0 6px #4de1ff}
#fsbtn svg{width:20px;height:20px;pointer-events:none}`;

function rwCss(css) {
  return css
    .replace(/(^|[\s,>+~(}{\/])(html|body)(?=[\s.#:\[,{>+~)])/g, (_, p, t) => p + (t === 'html' ? '.zh' : '.zb'))
    .replace(/@media\s*\(\s*((?:max|min)-width)\s*:\s*([^)]+)\)\s*\{/g, '@container zh ($1:$2){');
}

/* ════════ style « Nouveau » : code du tableau de bord d'origine (exécuté une fois par carte, dans son propre contexte) ════════ */
DASH.new = /*@@DASH@@*/;

class EnergieCard extends HTMLElement {
  constructor() { super(); this._config = {}; this._hass = null; this._run = null; }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Configuration invalide');
    const prev = JSON.stringify(this._config);
    this._config = Object.assign({}, config);
    if (this._run && prev !== JSON.stringify(this._config)) {
      // l'éditeur envoie une config à chaque frappe : on redémarre une seule fois, après une courte pause
      clearTimeout(this._cfgT);
      this._cfgT = setTimeout(() => { this._teardown(); this._maybeStart(true); }, 700);
    }
  }
  set hass(h) { this._hass = h; this._maybeStart(); }
  get hass() { return this._hass; }

  connectedCallback() {
    clearTimeout(this._tdT);
    this._maybeStart();
    // sans Home Assistant (aperçu, test) : démarrage en mode DÉMO
    if (!this._run) this._demoT = setTimeout(() => this._maybeStart(true), 1500);
  }
  disconnectedCallback() {
    clearTimeout(this._demoT);
    // Home Assistant déplace parfois les cartes : on attend avant de tout arrêter
    this._tdT = setTimeout(() => { if (!this.isConnected) this._teardown(); }, 3000);
  }
  getCardSize() { return 12; }
  getGridOptions() { return { columns: 'full', min_columns: 6 }; }
  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement(TAG + '-editor'); }

  _styleKey() { const s = this._config.style; return s === 'classic' || s === 'tuyaux' ? s : 'new'; }

  _maybeStart(force) {
    if (this._run || this._loading || !this.isConnected) return;
    if (!this._hass && !force) return;
    clearTimeout(this._demoT);
    const key = this._styleKey();
    if (DASH[key]) { this._start(); return; }
    // style pas encore chargé : petit écran d'attente, puis démarrage
    const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + BASE_CSS + '.zh{display:flex;align-items:center;justify-content:center;background:#05080f;color:#8fb4d8;font:600 15px system-ui,sans-serif}</style><div class="zh">Chargement du style ' + STYLE_NAMES[key] + '…</div>';
    this._size(root.querySelector('.zh'));
    this._loading = true;
    loadStyle(key).then(() => {
      this._loading = false;
      if (!this._run && this.isConnected && this._styleKey() === key) this._start();
      else if (!this._run) this._maybeStart(true);
    }).catch(e => {
      this._loading = false;
      const z = root.querySelector('.zh');
      if (z) z.textContent = 'Style ' + STYLE_NAMES[key] + ' introuvable : le fichier ' + STYLE_FILES[key] + ' doit être à côté de energie-card.js (réinstallez la carte avec HACS).';
      console.error('[energie-card]', e);
    });
  }

  _size(zh) {
    const c = this._config, s = zh.style;
    // par défaut : la carte tient dans la hauteur visible de l'écran (sous la barre de Home Assistant)
    zh.classList.toggle('fit', c.fit_screen !== false);
    s.removeProperty('height'); s.removeProperty('aspect-ratio');
    if (c.height) { s.setProperty('height', String(c.height), 'important'); s.setProperty('aspect-ratio', 'auto', 'important'); return; }
    if (c.aspect_ratio != null) {
      let a = String(c.aspect_ratio).trim(), m;
      if ((m = /^([\d.]+)\s*%$/.exec(a))) a = '100/' + m[1];          // « 56% » comme l'option aspect_ratio des iframes
      else if ((m = /^([\d.]+)\s*[:x]\s*([\d.]+)$/.exec(a))) a = m[1] + '/' + m[2];
      s.setProperty('aspect-ratio', a, 'important'); s.setProperty('height', 'auto', 'important');
    }
  }

  _start() {
    const card = this, W = window, D = document;
    const { STYLES, HTML, RUN } = DASH[this._styleKey()];
    const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    root.innerHTML = '';
    const base = D.createElement('style'); base.textContent = BASE_CSS; root.appendChild(base);
    const head = D.createElement('div'); head.className = 'zhead';
    STYLES.forEach(s => { const e = D.createElement('style'); if (s.id) e.id = s.id; e.textContent = s.css; head.appendChild(e); });
    root.appendChild(head);
    const zh = D.createElement('div'); zh.className = 'zh'; zh.lang = 'fr';
    const zb = D.createElement('div'); zb.className = 'zb';
    zh.appendChild(zb); root.appendChild(zh);
    this._size(zh);

    const run = this._run = { visible: true, dead: false, timers: new Set(), intervals: new Set(), rafs: new Set(), listeners: [],
      resize: [], own: Object.create(null), audio: [], css: new WeakMap(), mo: null, ro: null };

    /* erreurs : bandeau rouge dans la carte (comme le fichier d'origine), sans toucher à la console de Home Assistant */
    const show = m => { try { let d = root.getElementById('zerr'); if (!d) { d = D.createElement('div'); d.id = 'zerr';
      d.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:99999;background:#a00;color:#fff;font:700 22px monospace;padding:10px;white-space:pre-wrap';
      zh.appendChild(d); } d.textContent = 'ERREUR : ' + m; } catch (e) {} };
    const fmt = a => [].slice.call(a).map(x => x && x.message ? x.message : String(x)).join(' ');
    const con = Object.create(W.console);
    con.error = function () { show(fmt(arguments)); W.console.error.apply(W.console, ['[energie-card]'].concat([].slice.call(arguments))); };
    const fail = e => { show((e && e.message) || String(e)); W.console.error('[energie-card]', e); };

    /* minuteries suivies (arrêtées quand la carte disparaît) */
    const sT = (fn, ms, ...a) => { const id = W.setTimeout(() => { run.timers.delete(id); if (run.dead) return; try { typeof fn === 'function' && fn(...a); } catch (e) { fail(e); } }, ms); run.timers.add(id); return id; };
    // minuteries rapides (≤ 250 ms) = animations : suspendues hors écran, une sur deux en mode Économie
    const sI = (fn, ms, ...a) => {
      const fast = +ms <= 250; let n = 0;
      const id = W.setInterval(() => {
        if (run.dead) return;
        if (fast && (!run.visible || (card._config.animations === 'eco' && (n++ & 1)))) return;
        try { typeof fn === 'function' && fn(...a); } catch (e) { fail(e); }
      }, ms);
      run.intervals.add(id); return id;
    };
    const cT = id => { run.timers.delete(id); W.clearTimeout(id); };
    const cI = id => { run.intervals.delete(id); W.clearInterval(id); };
    /* animations : 60 images/s maximum (30 en mode Économie) et suspendues quand la carte n'est pas visible */
    const minDt = card._config.animations === 'eco' ? 1000 / 30 : 1000 / 60;   // 60 images/s maximum (écrans 120/144/180 Hz)
    run.visible = true; run.held = new Map(); run.lastFrame = -1e9;
    let seq = 0; const real = new Map();
    const rAF = fn => {
      const id = ++seq;
      const tick = t => {
        if (run.dead) return;
        if (!run.visible) { real.delete(id); run.held.set(id, tick); return; }          // en pause : reprise à l'affichage
        if (minDt && t !== run.lastFrame && t - run.lastFrame < minDt - 1) { real.set(id, W.requestAnimationFrame(tick)); return; }
        run.lastFrame = t; real.delete(id); run.rafs.delete(id);
        try { fn(t); } catch (e) { fail(e); }
      };
      real.set(id, W.requestAnimationFrame(tick)); run.rafs.add(id);
      return id;
    };
    const cAF = id => { run.rafs.delete(id); run.held.delete(id); const r = real.get(id); if (r) W.cancelAnimationFrame(r); real.delete(id); };
    run.cancelAll = () => { real.forEach(r => W.cancelAnimationFrame(r)); real.clear(); run.held.clear(); };

    /* écouteurs « fenêtre » : redimensionnement = taille de la carte, clics/touches = dans la carte seulement */
    const addL = (type, fn, opt) => {
      if (type === 'resize') { run.resize.push(fn); return; }
      const t = SCOPED.has(type) ? root : W; t.addEventListener(type, fn, opt); run.listeners.push([t, type, fn, opt]);
    };
    const remL = (type, fn, opt) => {
      if (type === 'resize') { run.resize = run.resize.filter(f => f !== fn); return; }
      (SCOPED.has(type) ? root : W).removeEventListener(type, fn, opt);
    };
    const addDocL = (type, fn, opt) => { const t = SCOPED.has(type) ? root : D; t.addEventListener(type, fn, opt); run.listeners.push([t, type, fn, opt]); };
    const remDocL = (type, fn, opt) => (SCOPED.has(type) ? root : D).removeEventListener(type, fn, opt);

    const bound = new Map();
    const bindOf = (obj, k, v) => { let b = bound.get(v); if (!b) { b = v.bind(obj); bound.set(v, b); } return b; };

    /* Web Audio : contextes fermés avec la carte */
    let AC = null;
    const audioClass = name => { const Base = W[name]; if (!Base) return Base; if (!AC) AC = {};
      if (!AC[name]) AC[name] = class extends Base { constructor(...a) { super(...a); run.audio.push(this); } };
      return AC[name]; };

    /* « window » propre à la carte */
    const WOV = {
      innerWidth: () => zh.clientWidth || W.innerWidth, innerHeight: () => zh.clientHeight || W.innerHeight,
      setTimeout: () => sT, setInterval: () => sI, clearTimeout: () => cT, clearInterval: () => cI,
      requestAnimationFrame: () => rAF, cancelAnimationFrame: () => cAF,
      addEventListener: () => addL, removeEventListener: () => remL,
      console: () => con, parent: () => W, top: () => W,
      AudioContext: () => audioClass('AudioContext'), webkitAudioContext: () => audioClass('webkitAudioContext'),
    };
    let winP, docP;
    winP = new Proxy({}, {
      get(t, k) {
        if (k === 'window' || k === 'self' || k === 'globalThis') return winP;
        if (k === 'document') return docP;
        if (typeof k === 'string' && WOV[k]) return WOV[k]();
        if (k in run.own) return run.own[k];
        const v = W[k];
        return typeof v === 'function' && typeof k === 'string' && /^[a-z]/.test(k) ? bindOf(W, k, v) : v;
      },
      set(t, k, v) { run.own[k] = v; return true; },
      has(t, k) { return k in run.own || k in W; },
      deleteProperty(t, k) { delete run.own[k]; return true; },
    });

    /* « document » propre à la carte : recherche d'éléments dans la carte, body = conteneur de la carte */
    const DOV = {
      body: () => zb, head: () => head, documentElement: () => zh, defaultView: () => winP,
      getElementById: () => id => root.getElementById(id),
      querySelector: () => s => root.querySelector(s),
      querySelectorAll: () => s => root.querySelectorAll(s),
      getElementsByClassName: () => c => zh.getElementsByClassName(c),
      getElementsByTagName: () => n => zh.getElementsByTagName(n),
      elementFromPoint: () => (x, y) => root.elementFromPoint(x, y),
      elementsFromPoint: () => (x, y) => root.elementsFromPoint(x, y),
      activeElement: () => root.activeElement,
      addEventListener: () => addDocL, removeEventListener: () => remDocL,
    };
    docP = new Proxy({}, {
      get(t, k) {
        if (typeof k === 'string' && DOV[k]) return DOV[k]();
        const v = D[k];
        return typeof v === 'function' && typeof k === 'string' && /^[a-z]/.test(k) ? bindOf(D, k, v) : v;
      },
      set(t, k, v) { D[k] = v; return true; },
      has(t, k) { return k in D; },
    });

    /* feuilles de style ajoutées dynamiquement : même adaptation html/body que les feuilles d'origine */
    const fixStyle = el => { const tx = el.textContent; if (run.css.get(el) === tx) return; const r = rwCss(tx); run.css.set(el, r); if (r !== tx) el.textContent = r; };
    run.mo = new MutationObserver(ms => ms.forEach(m => {
      if (m.type === 'characterData') { const p = m.target.parentNode; if (p && p.nodeName === 'STYLE') fixStyle(p); return; }
      if (m.target.nodeName === 'STYLE') fixStyle(m.target);
      m.addedNodes.forEach(n => { if (n.nodeName === 'STYLE') fixStyle(n); else if (n.querySelectorAll) n.querySelectorAll('style').forEach(fixStyle); });
    }));
    run.mo.observe(root, { childList: true, subtree: true, characterData: true });

    /* téléphone : bandes au-dessus et en dessous du tableau pour les boutons flottants (comme la version HTML) */
    const PHONE_W = 900, BAR = 64;
    const layoutCtl = () => {
      const w = zh.clientWidth, c = card._config; if (!w) return;
      if (run.fs) return;
      if (w < PHONE_W && !c.height && c.aspect_ratio == null) {
        if (!run.phone) { if (zh.clientHeight > w * 9 / 16 + 4) return; run.phone = true; }  // mode panneau : déjà assez haut
        const h = Math.round(w * 9 / 16 + 2 * BAR) + 'px';
        if (zh.style.height !== h) { zh.style.setProperty('height', h, 'important'); zh.style.setProperty('aspect-ratio', 'auto', 'important'); }
      } else if (run.phone) { run.phone = false; card._size(zh); }
    };
    run.ro = new ResizeObserver(() => { layoutCtl(); (run.drag || []).forEach(f => f()); run.resize.forEach(f => { try { f.call(winP, { type: 'resize' }); } catch (e) { fail(e); } }); });
    run.ro.observe(zh);

    // pause quand la carte est hors écran, l'onglet masqué ou la vue Home Assistant changée
    let inView = true;
    const setVis = () => {
      const v = inView && !D.hidden && card.isConnected;
      if (v === run.visible) return;
      run.visible = v; zh.classList.toggle('paused', !v);
      if (v) { const h = [...run.held.values()]; run.held.clear(); h.forEach(f => real.set(++seq, W.requestAnimationFrame(f))); }
    };
    run.io = new IntersectionObserver(es => { inView = es.some(e => e.isIntersecting); setVis(); });
    run.io.observe(zh);
    const onVis = () => setVis();
    D.addEventListener('visibilitychange', onVis); run.listeners.push([D, 'visibilitychange', onVis]);

    const H = i => zb.insertAdjacentHTML('beforeend', HTML[i]);
    try {
      RUN(docP, winP, winP, W, W, sT, sI, cT, cI, rAF, cAF, addL, remL, con, H, card, card._config || {});
    } catch (e) { fail(e); }
    // boutons flottants déplaçables (position mémorisée sur cet appareil)
    this._fullscreen(zh, root, run);
    this._swipe(root, zh, zb);
    run.drag = ['vsw', 'thbtn', 'fsbtn'].map(id => this._draggable(root.getElementById(id), zh, id, run)).filter(Boolean);
  }

  /* bouton plein écran : vrai plein écran si possible, sinon la carte couvre tout l'écran de l'application (iPhone) */
  _fullscreen(zh, root, run) {
    if (this._config.fullscreen_button === false) return;
    const card = this, D = document;
    const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
    const b = D.createElement('button'); b.id = 'fsbtn'; b.type = 'button';
    b.style.cssText = 'position:fixed;z-index:60;width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:10px;cursor:pointer;color:#cfe8ff;background:rgba(10,18,32,.8);border:1px solid rgba(120,180,255,.35);box-shadow:0 2px 10px rgba(0,0,0,.45)';
    const th = root.getElementById('thbtn');            // même allure que le bouton 🎨
    if (th) { const cs = getComputedStyle(th); ['background', 'border', 'borderRadius', 'boxShadow', 'zIndex'].forEach(k => { if (cs[k]) b.style[k] = cs[k]; }); }
    zh.appendChild(b);
    // l'élément en plein écran est dans la carte : le document ne voit que la carte elle-même
    const isFs = () => root.fullscreenElement === zh || (D.fullscreenElement || D.webkitFullscreenElement) === card;
    const upd = () => {
      const on = isFs() || zh.classList.contains('pfs');
      run.fs = on; b.innerHTML = on ? ICON_OFF : ICON_ON; b.title = on ? 'Quitter le plein écran' : 'Plein écran';
      if (!on) { card._size(zh); }
    };
    const pseudo = on => {
      zh.classList.toggle('pfs', on); card.classList.toggle('pfs', on);
      if (on) { run.phone = false; zh.style.removeProperty('height'); zh.style.removeProperty('aspect-ratio'); }
      upd();
    };
    b.addEventListener('click', async e => {
      e.stopPropagation();
      if (isFs()) { try { screen.orientation.unlock(); } catch (er) {} (D.exitFullscreen || D.webkitExitFullscreen).call(D); return; }
      if (zh.classList.contains('pfs')) { pseudo(false); return; }
      const req = zh.requestFullscreen || zh.webkitRequestFullscreen;
      try {
        if (!req) throw new Error('fullscreen indisponible');
        run.fs = true;
        await req.call(zh, { navigationUI: 'hide' });
        if (card._config.fullscreen_landscape !== false) { try { await screen.orientation.lock('landscape'); } catch (er) {} }
      } catch (er) { pseudo(true); }
    });
    const onChange = () => { if (!isFs()) { try { screen.orientation.unlock(); } catch (er) {} } upd(); };
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(t => { D.addEventListener(t, onChange); run.listeners.push([D, t, onChange]); });
    const onKey = e => { if (e.key === 'Escape' && zh.classList.contains('pfs')) pseudo(false); };
    D.addEventListener('keydown', onKey); run.listeners.push([D, 'keydown', onKey]);
    upd();
  }

  /* écran tactile : glisser horizontalement sur le tableau pour passer d'une vue à l'autre */
  _swipe(root, zh, zb) {
    if (this._config.swipe === false) return;
    const SKIP = 'input,textarea,select,canvas,[contenteditable],#vsw,#thbtn,#fsbtn,#hamb,#wbtn,#vdots';
    const OPEN = '#panel.on,#menu.on,#hist.on,#cfm.on,#hmenu.on';
    const scrollsX = el => {
      for (let e = el; e && e !== zh; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 2) return true;
      }
      return false;
    };
    let g = null;
    zh.addEventListener('touchstart', e => {
      g = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0], target = e.composedPath()[0];
      if (!(target instanceof Element) || target.closest(SKIP) || root.querySelector(OPEN) || scrollsX(target)) return;
      g = { x: t.clientX, y: t.clientY, t: Date.now() };
    }, { passive: true });
    zh.addEventListener('touchmove', e => { if (g && e.touches.length !== 1) g = null; }, { passive: true });
    // écran tactile : le bouton Énergie/Réacteur laisse place à deux petits points (● ○) qui indiquent la vue
    const touchOnly = window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (touchOnly) {
      const vsw = root.getElementById('vsw');
      if (vsw) vsw.style.setProperty('display', 'none', 'important');
      const dots = document.createElement('div'); dots.id = 'vdots';
      dots.innerHTML = '<i data-v="0"></i><i data-v="1"></i>';
      zh.appendChild(dots);
      const upd = () => { const l = zb.classList.contains('lum'); dots.children[0].classList.toggle('on', !l); dots.children[1].classList.toggle('on', l); };
      dots.addEventListener('click', e => { const v = e.target.dataset && e.target.dataset.v; const b = v && root.querySelector('#vsw button[data-v="' + v + '"]'); if (b) b.click(); });
      new MutationObserver(upd).observe(zb, { attributes: true, attributeFilter: ['class'] });
      upd();
    }
    zh.addEventListener('touchend', e => {
      if (!g) return;
      const t = e.changedTouches[0], dx = t.clientX - g.x, dy = t.clientY - g.y, dt = Date.now() - g.t; g = null;
      const min = Math.max(60, zh.clientWidth * 0.12);
      if (dt > 800 || Math.abs(dx) < min || Math.abs(dx) < 2 * Math.abs(dy)) return;
      const lum = zb.classList.contains('lum');
      const v = dx < 0 && !lum ? '1' : dx > 0 && lum ? '0' : null;      // ← Réacteur · → Énergie
      const b = v && root.querySelector('#vsw button[data-v="' + v + '"]');
      if (b) b.click();
    }, { passive: true });
  }

  /* glisser-déposer d'un bouton flottant ; un simple appui garde son action habituelle */
  _draggable(el, zh, key, run) {
    if (!el) return null;
    const K = 'energie-card:pos:' + key;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(K)) || {}; } catch (e) {}
    const lay = () => run.phone ? 'p' : 'l';            // téléphone (portrait) / écran large
    const apply = () => {
      const p = saved[lay()], st = el.style;
      if (!p) { ['left', 'top', 'right', 'bottom'].forEach(k => st.removeProperty(k)); return; }
      const w = zh.clientWidth, h = zh.clientHeight, ew = el.offsetWidth, eh = el.offsetHeight; if (!w || !h) return;
      const x = Math.max(0, Math.min(w - ew, p.x * w)), y = Math.max(0, Math.min(h - eh, p.y * h));
      st.setProperty('left', x + 'px', 'important'); st.setProperty('top', y + 'px', 'important');
      st.setProperty('right', 'auto', 'important'); st.setProperty('bottom', 'auto', 'important');
    };
    el.style.touchAction = 'none';
    let g = null;
    el.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      const r = el.getBoundingClientRect(), z = zh.getBoundingClientRect();
      g = { x: e.clientX, y: e.clientY, l: r.left - z.left, t: r.top - z.top, id: e.pointerId, moved: false };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
    });
    const move = e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved) { if (Math.hypot(dx, dy) < 8) return; g.moved = true; el.style.cursor = 'grabbing'; }
      e.preventDefault();
      saved[lay()] = { x: (g.l + dx) / zh.clientWidth, y: (g.t + dy) / zh.clientHeight };
      apply();
    };
    const end = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true);
      if (!g) return;
      if (g.moved) {
        el.style.cursor = '';
        try { localStorage.setItem(K, JSON.stringify(saved)); } catch (e) {}
        const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };   // pas de changement de vue en fin de glissement
        el.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', stop, true), 400);
      }
      g = null;
    };
    apply();
    return apply;
  }

  _teardown() {
    const run = this._run; if (!run) return;
    run.dead = true;
    run.timers.forEach(id => clearTimeout(id)); run.intervals.forEach(id => clearInterval(id)); run.cancelAll && run.cancelAll();
    run.listeners.forEach(([t, ty, f, o]) => { try { t.removeEventListener(ty, f, o); } catch (e) {} });
    try { run.mo.disconnect(); run.ro.disconnect(); run.io && run.io.disconnect(); } catch (e) {}
    run.audio.forEach(a => { try { a.close(); } catch (e) {} });
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    this.classList.remove('pfs');
    if (this.shadowRoot) this.shadowRoot.innerHTML = '';
    this._run = null;
  }
}

customElements.define(TAG, EnergieCard);
/*@@EDITOR@@*/
window.customCards = window.customCards || [];
window.customCards.push({ type: TAG, name: 'Énergie Réacteur (Isypower, Zendure)',
  description: 'Tableau de bord énergie : solaire, réseau, batteries Isypower (Izypower) Titan ou Zendure, voiture, ballon ECS, Watt.', preview: false,
  documentationURL: 'https://github.com/@@REPO@@' });
})();
