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

const STYLES = /*@@STYLES@@*/;
const HTML = /*@@HTML@@*/;

/* événements d'interface : écoutés dans la carte, jamais sur toute la page Home Assistant */
const SCOPED = new Set(['click','dblclick','auxclick','contextmenu','mousedown','mouseup','mousemove','mouseover','mouseout',
  'pointerdown','pointerup','pointermove','pointercancel','pointerover','pointerout','touchstart','touchend','touchmove',
  'touchcancel','keydown','keyup','keypress','input','change','wheel','focusin','focusout','beforeinput']);

const BASE_CSS = `:host{display:block}
.zh{position:relative;display:block;width:100%;aspect-ratio:16/9;overflow:hidden;contain:layout paint style;container-type:inline-size;container-name:zh;transform:translateZ(0);border-radius:var(--ha-card-border-radius,12px)}
.zh.fit{max-height:calc(100dvh - var(--header-height, 56px) - var(--energie-card-offset, 16px))}
.zh:fullscreen{border-radius:0;max-height:none}
.zhead{display:none}`;

function rwCss(css) {
  return css
    .replace(/(^|[\s,>+~(}{\/])(html|body)(?=[\s.#:\[,{>+~)])/g, (_, p, t) => p + (t === 'html' ? '.zh' : '.zb'))
    .replace(/@media\s*\(\s*((?:max|min)-width)\s*:\s*([^)]+)\)\s*\{/g, '@container zh ($1:$2){');
}

/* ════════ code du tableau de bord d'origine (exécuté une fois par carte, dans son propre contexte) ════════ */
function RUN(document, window, self, parent, top, setTimeout, setInterval, clearTimeout, clearInterval,
             requestAnimationFrame, cancelAnimationFrame, addEventListener, removeEventListener, console,
             __H, __card, __C) {
/*@@CODE@@*/
}

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

  _maybeStart(force) {
    if (this._run || !this.isConnected) return;
    if (!this._hass && !force) return;
    clearTimeout(this._demoT);
    this._start();
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

    const run = this._run = { dead: false, timers: new Set(), intervals: new Set(), rafs: new Set(), listeners: [],
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
    const sI = (fn, ms, ...a) => { const id = W.setInterval(() => { if (run.dead) return; try { typeof fn === 'function' && fn(...a); } catch (e) { fail(e); } }, ms); run.intervals.add(id); return id; };
    const cT = id => { run.timers.delete(id); W.clearTimeout(id); };
    const cI = id => { run.intervals.delete(id); W.clearInterval(id); };
    const rAF = fn => { const id = W.requestAnimationFrame(t => { run.rafs.delete(id); if (run.dead) return; try { fn(t); } catch (e) { fail(e); } }); run.rafs.add(id); return id; };
    const cAF = id => { run.rafs.delete(id); W.cancelAnimationFrame(id); };

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
      if (w < PHONE_W && !c.height && c.aspect_ratio == null) {
        if (!run.phone) { if (zh.clientHeight > w * 9 / 16 + 4) return; run.phone = true; }  // mode panneau : déjà assez haut
        const h = Math.round(w * 9 / 16 + 2 * BAR) + 'px';
        if (zh.style.height !== h) { zh.style.setProperty('height', h, 'important'); zh.style.setProperty('aspect-ratio', 'auto', 'important'); }
      } else if (run.phone) { run.phone = false; card._size(zh); }
    };
    run.ro = new ResizeObserver(() => { layoutCtl(); run.resize.forEach(f => { try { f.call(winP, { type: 'resize' }); } catch (e) { fail(e); } }); });
    run.ro.observe(zh);

    const H = i => zb.insertAdjacentHTML('beforeend', HTML[i]);
    try {
      RUN(docP, winP, winP, W, W, sT, sI, cT, cI, rAF, cAF, addL, remL, con, H, card, card._config || {});
    } catch (e) { fail(e); }
  }

  _teardown() {
    const run = this._run; if (!run) return;
    run.dead = true;
    run.timers.forEach(id => clearTimeout(id)); run.intervals.forEach(id => clearInterval(id)); run.rafs.forEach(id => cancelAnimationFrame(id));
    run.listeners.forEach(([t, ty, f, o]) => { try { t.removeEventListener(ty, f, o); } catch (e) {} });
    try { run.mo.disconnect(); run.ro.disconnect(); } catch (e) {}
    run.audio.forEach(a => { try { a.close(); } catch (e) {} });
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    if (this.shadowRoot) this.shadowRoot.innerHTML = '';
    this._run = null;
  }
}

customElements.define(TAG, EnergieCard);
/*@@EDITOR@@*/
window.customCards = window.customCards || [];
window.customCards.push({ type: TAG, name: 'Énergie — réacteur (Izypower Titan)',
  description: 'Tableau de bord énergie : solaire, réseau, batteries Izypower Titan, voiture, ballon ECS, Watt.', preview: false,
  documentationURL: 'https://github.com/@@REPO@@' });
})();
