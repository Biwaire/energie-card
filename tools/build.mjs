// Construit la carte Lovelace à partir des tableaux de bord HTML d'origine.
//   src/energie.html          → dist/energie-card.js          (style « Nouveau », carte principale)
//   src/energie-classic.html  → dist/energie-card-classic.js  (style « Classique », chargé seulement s'il est choisi)
// Usage : node tools/build.mjs            (les deux)
//         node tools/build.mjs <html> <sortie.js>   (test d'un seul fichier comme carte principale)
import fs from 'node:fs';

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const VERSION = PKG.version;
const J = s => JSON.stringify(s);

function transform(SRC) {
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

/* ---------- 1. découpage du fichier ---------- */
const headEnd = src.indexOf('</head>');
const bodyStart = src.indexOf('<body>', headEnd);
const bodyEnd = src.lastIndexOf('</body>');
if (headEnd < 0 || bodyStart < 0 || bodyEnd < 0) throw new Error('structure HTML inattendue');

// commentaires d'en-tête (crédits) — conservés tels quels
const comments = [...src.slice(0, src.indexOf('<!doctype')).matchAll(/<!--([\s\S]*?)-->/g)].map(m => m[1]);

// feuilles de style du <head>
const head = src.slice(0, headEnd);
const styles = [...head.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map(m => {
  const id = (/id="([^"]+)"/.exec(m[1]) || [])[1] || '';
  return { id, css: m[2] };
});

// corps : alternance HTML / <script>
const body = src.slice(bodyStart + '<body>'.length, bodyEnd);
const html = [], scripts = [];
let last = 0;
for (const m of body.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  html.push(body.slice(last, m.index));
  scripts.push(m[1]);
  last = m.index + m[0].length;
}
html.push(body.slice(last));

/* ---------- 2. CSS : html/body → conteneurs de la carte ---------- */
function rwCss(css) {
  return css
    .replace(/(^|[\s,>+~(}{\/])(html|body)(?=[\s.#:\[,{>+~)])/g, (_, p, t) => p + (t === 'html' ? '.zh' : '.zb'))
    .replace(/@media\s*\(\s*((?:max|min)-width)\s*:\s*([^)]+)\)\s*\{/g, '@container zh ($1:$2){');
}
const stylesOut = styles.map(s => ({ id: s.id, css: rwCss(s.css) }));

/* ---------- 3. scripts : retouches ciblées (chacune doit trouver exactement 1 occurrence) ---------- */
let code = scripts.map((s, i) => `/* ── script ${i + 1}/${scripts.length} ── */\n__H(${i});\n${s}\n;`).join('\n') + `\n__H(${scripts.length});\n`;

const FAILS = [];
function patch(find, repl, label) {
  const n = code.split(find).length - 1;
  if (n !== 1) { FAILS.push(`retouche « ${label} » : ${n} occurrence(s) au lieu de 1`); return; }
  code = code.replace(find, () => repl);
}

// Home Assistant : l'objet hass vient de la carte (plus de recherche dans la page parente)
patch("function getHass(){try{for(const w of [window.parent,window.top,window]){try{const e=w.document.querySelector('home-assistant');if(e&&e.hass&&e.hass.states)return e.hass}catch(_){}}}catch(_){}return null}",
  "function getHass(){const h=__card._hass;return h&&h.states?h:null}", 'getHass');

// veille anti-marquage : ne doit jamais créer d'élément dans la page Home Assistant
patch("var P=window.parent;if(!P||P===window)return;", "var P=window.parent;return;", 'veille SVP');

// Réglages : valeurs par défaut NEUTRES (détection automatique) pour la version publique.
// Chaque utilisateur règle ses capteurs dans l'éditeur visuel de la carte (ou en YAML).
function patchRe(re, repl, label) {
  const m = code.match(new RegExp(re.source, re.flags.replace('g', '') + 'g'));
  if (!m || m.length !== 1) { FAILS.push(`retouche « ${label} » : ${m ? m.length : 0} occurrence(s) au lieu de 1`); return; }
  code = code.replace(re, () => repl);
}
patch("const MODULES={", "const MODULES=Object.assign({", 'MODULES début');
patch("watt:true         /* assistant Watt 👷 */\n};", "watt:true         /* assistant Watt 👷 */\n},__C.modules||{});", 'MODULES fin');
patchRe(/const E=\{pv:[^\n]*?\};/, "const E=Object.assign({pv:'',grid:'',ev:'',evSoc:'',evRange:'',evLid:'',ecs:'',ecsTotal:''},__C.entities||{});", 'E');
patch("const HOUSE_TEMP='';", "const HOUSE_TEMP=__C.house_temp||'';", 'HOUSE_TEMP');
patch("let WEATHER='';", "let WEATHER=__C.weather||'';", 'WEATHER');
patch("const SOL={today:'',tomorrow:''};", "const SOL=Object.assign({today:'',tomorrow:''},__C.solcast||{});", 'SOL');
patchRe(/const ECS_TILE=\{[^\n]*?\};/, "const ECS_TILE=Object.assign({haute:'',basse:'',grande:'',desinf:''},__C.ecs_tile||{});", 'ECS_TILE');
patchRe(/const UN=\[[\s\S]*?\];\nconst BATSET=\{[^\n]*\};/,
  "const UN=[];\nconst BATSET={};\n" +
  "if(Array.isArray(__C.batteries)){__C.batteries.slice(0,4).forEach((b,i)=>{if(!b||!b.level)return;const id='b'+(UN.length+1);UN.push({id,name:b.name||('Batterie '+(UN.length+1)),lvl:b.level,pw:b.power||'',tmp:b.temperature||'sensor.aucun',k:b.invert?-1:1});if(b.min||b.max)BATSET[id]={min:b.min||'',max:b.max||''}})}", 'UN/BATSET');
patch("const PACKS=[1,1];", "const PACKS=Array.isArray(__C.packs)?__C.packs:[1,1,1,1];", 'PACKS');
patch("const KWH_PACK=4.02;", "const KWH_PACK=__C.kwh_pack!=null?+__C.kwh_pack:4.02;", 'KWH_PACK');
patch("const INVERT_BAT=false;", "const INVERT_BAT=!!__C.invert_bat;", 'INVERT_BAT');
patch("const TARIF_HP=0.176,TARIF_HC=0.1361;", "const TARIF_HP=__C.tarif_hp!=null?+__C.tarif_hp:0.176,TARIF_HC=__C.tarif_hc!=null?+__C.tarif_hc:0.1361;", 'TARIFS');
patchRe(/const HC_PLAGES=\[\[[^\n]*?\]\];/, "const HC_PLAGES=Array.isArray(__C.hc_plages)&&__C.hc_plages.length?__C.hc_plages:[['22:00','06:00']];", 'HC_PLAGES');
patch("const PV_MAX=4000,INVERT_GRID=false;", "const PV_MAX=__C.pv_max!=null?+__C.pv_max:4000,INVERT_GRID=!!__C.invert_grid;", 'PV_MAX');
patch("const CO2_KG_KWH=0.052;", "const CO2_KG_KWH=__C.co2_kg_kwh!=null?+__C.co2_kg_kwh:0.052;", 'CO2');
patch("var MIN_PCT=25,MAX_PCT=80;var EV_KWH=60,EV_TARGET=80;", "var MIN_PCT=25,MAX_PCT=80;var EV_KWH=__C.ev_kwh!=null?+__C.ev_kwh:60,EV_TARGET=__C.ev_target!=null?+__C.ev_target:80;", 'EV');
patch("var ALERT_GRID=6000,EV_KWH=60,EV_TARGET=80,", "var ALERT_GRID=6000,EV_KWH=__C.ev_kwh!=null?+__C.ev_kwh:60,EV_TARGET=__C.ev_target!=null?+__C.ev_target:80,", 'EV (lum)');
patchRe(/var AGENT='[^']*';/, "var AGENT=__C.agent||'';", 'AGENT');
patchRe(/var MEM=\[\],AG='[^']*';/, "var MEM=[],AG=__C.agent||undefined;", 'AG');

// rappels : module désactivé = aucune popup ; liste de départ sans les jours de poubelle personnels
if (!/if\(!M\.rappels\)hide\('[^']*#rxp/.test(code))   // déjà corrigé dans les versions récentes
  patch("if(!M.rappels)hide('#rxbell,#rxm');", "if(!M.rappels)hide('#rxbell,#rxm,#rxp');", 'rappels masqués');
patchRe(/function seed\(\)\{return\[[\s\S]*?\]\}/, "function seed(){return[\n{id:'car',t:'Voiture à charger',ic:'🔌',col:'#4de1ff',k:'car',thr:30}]}", 'rappels seed');


// appels « nus » à des fonctions posées sur window (window est propre à chaque carte)
code = code.replace(/(?<![.\w$'"])(WATT_(?:ACT|INSTR|CTX2|APPS|PARSE))\(/g, 'window.$1(');
// dimensions de la « fenêtre » = dimensions de la carte
code = code.replace(/(?<![.\w$'"])(innerWidth|innerHeight)(?![\w$])/g, 'window.$1');

// marques : titre de tuile selon les batteries détectées (Izypower / Zendure / Batteries), Watt neutre
{
  const T = 'Izypower · entrée / sortie';
  const n = html.reduce((k, h) => k + h.split(T).length - 1, 0);
  if (n !== 1) FAILS.push(`retouche « tuile marque » : ${n} occurrence(s) au lieu de 1`);
  for (let i = 0; i < html.length; i++) html[i] = html[i].split(T).join('<span class="zbrand">Batteries</span> · entrée / sortie');
}
code = code.split('batteries Izypower Titan, voiture').join('batteries domestiques, voiture');
code = code.split('izypower|isypower|titan').join('izypower|isypower|titan|zendure|solarflow');
code += `
;/* marque affichée selon les batteries détectées */
(function(){var last='',FIX={isypower:'Isypower',izypower:'Izypower',zendure:'Zendure',none:'Batteries'};function upd(){try{var ids=UN.map(function(u){return String(u.lvl||'')+' '+String(u.pw||'')}).join(' ').toLowerCase();
 var b=FIX[__C.brand]||(/isypower/.test(ids)?'Isypower':/pile_average|izypower|titan/.test(ids)?'Izypower':/electric_level|bat_in_out|zendure|solarflow|hyper_?2000|hub_?2000|ace_?1500|aio/.test(ids)?'Zendure':'Batteries');
 if(b!==last){last=b;document.querySelectorAll('.zbrand').forEach(function(e){e.textContent=b})}}catch(e){}}
 upd();setInterval(upd,3000)})();
`;

if (FAILS.length) throw new Error(SRC + ' :\n' + FAILS.join('\n'));
const header = comments.map(c => '/*' + c.replace(/\*\//g, '* /') + '*/').join('\n');
const dash = '{\nSTYLES: [\n' + stylesOut.map(s => `{id:${J(s.id)},css:${J(s.css)}}`).join(',\n') + '\n],\nHTML: [\n' + html.map(J).join(',\n') +
  '\n],\nRUN: function (document, window, self, parent, top, setTimeout, setInterval, clearTimeout, clearInterval,\n' +
  '             requestAnimationFrame, cancelAnimationFrame, addEventListener, removeEventListener, console,\n             __H, __card, __C) {\n' + code + '\n}\n}';
return { header, dash, info: `${styles.length} feuilles de style, ${scripts.length} scripts, ${html.length} morceaux HTML` };
}

/* ---------- 4. assemblage ---------- */
const tpl = fs.readFileSync(new URL('./runtime.js', import.meta.url), 'utf8');
function buildMain(SRC, OUT) {
  const t = transform(SRC);
  const out = tpl
    .replace(/@@VERSION@@/g, VERSION)
    .replace(/@@REPO@@/g, PKG.repository)
    .replace('/*@@EDITOR@@*/', () => fs.readFileSync(new URL('./editor.js', import.meta.url), 'utf8'))
    .replace('/*@@HEADER@@*/', () => t.header)
    .replace('/*@@DASH@@*/', () => t.dash);
  fs.writeFileSync(OUT, out);
  console.log(`OK : ${t.info} → ${String(OUT).split("/").slice(-2).join("/")} (${(out.length / 1024).toFixed(0)} Ko)`);
}
function buildClassic(SRC, OUT) {
  const t = transform(SRC);
  const out = t.header + `
/* Style « Classique » (v2) de la carte energie-card ${VERSION}.
   Chargé automatiquement par energie-card.js quand le style Classique est choisi :
   NE PAS l'ajouter comme ressource. */
(window.__ENERGIE_CARD_DASH = window.__ENERGIE_CARD_DASH || {}).classic = ` + t.dash + ';\n';
  fs.writeFileSync(OUT, out);
  console.log(`OK : ${t.info} → ${String(OUT).split("/").slice(-2).join("/")} (${(out.length / 1024).toFixed(0)} Ko)`);
}

const [, , SRC, OUT] = process.argv;
try {
  if (SRC) buildMain(SRC, OUT);
  else {
    buildMain(new URL('../src/energie.html', import.meta.url), new URL('../dist/energie-card.js', import.meta.url));
    buildClassic(new URL('../src/energie-classic.html', import.meta.url), new URL('../dist/energie-card-classic.js', import.meta.url));
  }
} catch (e) { console.error(e.message); process.exit(1); }
