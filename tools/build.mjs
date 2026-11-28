// Construit la carte Lovelace à partir des tableaux de bord HTML d'origine.
//   src/energie.html          → dist/energie-card.js          (style « Nouveau », carte principale)
//   src/energie-classic.html  → dist/energie-card-classic.js  (style « Classique », chargé seulement s'il est choisi)
//   src/energie-tuyaux.html   → dist/energie-card-tuyaux.js   (style « Tuyaux » de tazzdel, chargé seulement s'il est choisi)
// Usage : node tools/build.mjs            (les deux)
//         node tools/build.mjs <html> <sortie.js>   (test d'un seul fichier comme carte principale)
import fs from 'node:fs';

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const VERSION = PKG.version;
const J = s => JSON.stringify(s);

function transform(SRC, profile = 'main') {
const MAIN = profile !== 'tuyaux';
const SUP = profile === 'sup'; /* style Supervision : base Nouveau, mais configuration intégrée différente */
let src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

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
for (const m of body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
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
// <style> placés dans le <body> (ex. bnCss de la v3) : même réécriture html/body → conteneurs
for (let i = 0; i < html.length; i++) html[i] = html[i].replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (m, a, c, b) => a + rwCss(c) + b);

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
if (MAIN) patch("const MODULES={", "const MODULES=Object.assign({", 'MODULES début');
if (MAIN) patch("watt:true         /* assistant Watt 👷 */\n};", "watt:true         /* assistant Watt 👷 */\n},__C.modules||{});", 'MODULES fin');
patchRe(/const E=\{pv:[^\n]*?\};/, "const E=Object.assign({pv:'',grid:'',ev:'',evSoc:'',evRange:'',evLid:'',ecs:'',ecsTotal:''},__C.entities||{});", 'E');
patch("const HOUSE_TEMP='';", "const HOUSE_TEMP=__C.house_temp||'';", 'HOUSE_TEMP');
patch("let WEATHER='';", "let WEATHER=__C.weather||'';", 'WEATHER');
patch("const SOL={today:'',tomorrow:''};", "const SOL=Object.assign({today:'',tomorrow:''},__C.solcast||{});", 'SOL');
if (MAIN) patchRe(/const ECS_TILE=\{[^\n]*?\};/, "const ECS_TILE=Object.assign({haute:'',basse:'',grande:'',desinf:''},__C.ecs_tile||{});", 'ECS_TILE');
const UN_REPL = "const UN=[];\nconst BATSET={};\n" +
  "if(Array.isArray(__C.batteries)){__C.batteries.slice(0,4).forEach((b,i)=>{if(!b||!b.level)return;const id='b'+(UN.length+1);const io=!!(b.power_in||b.power_out);UN.push({id,hp:!!b.hide_power,label:b.label?String(b.label).slice(0,10):'',name:b.name||('Batterie '+(UN.length+1)),lvl:b.level,pw:io?'':(b.power||''),pin:io?(b.power_in||''):'',pout:io?(b.power_out||''):'',tmp:b.temperature||'sensor.aucun',k:(!io&&/bat_in_out/.test(b.power||'')?-1:1)*(b.invert?-1:1)*(__C.invert_bat?-1:1)});if(b.min||b.max)BATSET[id]={min:b.min||'',max:b.max||''}})}";
if (MAIN) patchRe(/const UN=\[[\s\S]*?\];\nconst BATSET=\{[^\n]*\};/, UN_REPL, 'UN/BATSET');
if (SUP) patchRe(/const UN=\[ \/\* LAISSER VIDE[\s\S]*?\*\/\];/, UN_REPL.replace('const BATSET={};\n', ''), 'UN (supervision)');
// portail / garage : entités réglables (portail_entity, garage_entity), sinon reconnus par leur nom (« portail », « gate », « garage »)
patch("else if(id==='cover.all_house_slidymoove')cls='portail';else if(id==='cover.all_house_io_1674235')cls='garage';",
  "else if(id===(__C.portail_entity||'cover.all_house_slidymoove')||(!__C.portail_entity&&/portail|gate/.test(lw)))cls='portail';else if(id===(__C.garage_entity||'cover.all_house_io_1674235')||(!__C.garage_entity&&/garage/.test(lw)))cls='garage';", 'portail/garage réglables');
if (SUP) patch("const PACKS=[1,1,1,1];", "const PACKS=Array.isArray(__C.packs)?__C.packs:[1,1,1,1];", 'PACKS (supervision)');
if (SUP) patchRe(/const TARIF_HP=[\d.]+,TARIF_HC=[\d.]+;/, "const TARIF_HP=__C.tarif_hp!=null?+__C.tarif_hp:0.2941,TARIF_HC=__C.tarif_hc!=null?+__C.tarif_hc:0.2277;", 'TARIFS (supervision)');
if (MAIN) patch("const PACKS=[1,1];", "const PACKS=Array.isArray(__C.packs)?__C.packs:[1,1,1,1];", 'PACKS');
if (MAIN) patch("const KWH_PACK=4.02;", "const KWH_PACK=__C.kwh_pack!=null?+__C.kwh_pack:2.1;", 'KWH_PACK');
// capacité propre à chaque batterie (kWh) : prioritaire sur packs × capacité d'un pack
// Zendure & co : puissance batterie en deux capteurs (entrée = charge, sortie = décharge)
function patchAll(find, repl, label) {
  const n = code.split(find).length - 1;
  if (n < 1) { FAILS.push(`retouche « ${label} » : introuvable`); return; }
  code = code.split(find).join(repl);
}
patch("const okPw=!!st[u.pw]&&", "const __ok=x=>!!x&&!!st[x]&&!['unknown','unavailable','none',''].includes(String(st[x].state))&&!isNaN(parseFloat(st[x].state));const okPw=(u.pin||u.pout)?(__ok(u.pin)||__ok(u.pout)):!!st[u.pw]&&", 'entrée/sortie : capteur ok');
if (MAIN) patch("D.p[i]=okPw?(u.k===undefined?-1:u.k)*rd(st,u.pw):0;", "D.p[i]=okPw?(u.k===undefined?-1:u.k)*((u.pin||u.pout)?(__ok(u.pin)?rd(st,u.pin):0)-(__ok(u.pout)?rd(st,u.pout):0):rd(st,u.pw)):0;", 'entrée/sortie : calcul');
patch("D.battMissing.push({id:u.pw,", "D.battMissing.push({id:u.pw||u.pin||u.pout,", 'entrée/sortie : capteur manquant');
patch("missingPw=(D.battMissing||[]).some(x=>x.id===u.pw)", "missingPw=(D.battMissing||[]).some(x=>x.id===(u.pw||u.pin||u.pout))", 'entrée/sortie : affichage');
patchAll("UN.forEach((u,i)=>put(u.pw,'b'+i));", "UN.forEach((u,i)=>{if(u.pin||u.pout){put(u.pin,'bi'+i);put(u.pout,'bo'+i)}else put(u.pw,'b'+i)});", 'entrée/sortie : historique');
patchAll("(m['b'+i]||0)", "(m['b'+i]!==undefined?m['b'+i]:(m['bi'+i]||0)-(m['bo'+i]||0))", 'entrée/sortie : historique calcul');
patchAll("...UN.map(u=>u.pw)]", "...UN.flatMap(u=>(u.pin||u.pout)?[u.pin,u.pout].filter(Boolean):[u.pw])]", 'entrée/sortie : statistiques');
patch("const unitP=i=>({id:UN[i].pw,", "const unitP=i=>({id:UN[i].pw||UN[i].pin||UN[i].pout,", 'entrée/sortie : graphique');
// détection automatique : ignorer les % de réglage (min_soc, soc_set…), une seule batterie par appareil, Zendure entrée/sortie
if (MAIN) patch("&&!/phone|telephone|tablet|tablette|voiture|car_|_ev|watch|mobile|iphone|pixel|samsung|remote|ups/.test(tx(i)));",
  "&&!/phone|telephone|tablet|tablette|voiture|car_|_ev|watch|mobile|iphone|pixel|samsung|remote|ups/.test(tx(i))&&!/min_?soc|max_?soc|soc_?set|soc_?min|soc_?max|soc_?limit|soc_?target|target|limit|reserve|health|soh|cycle|status|state$/.test(i.replace(/^sensor\\./,'')));", 'détection : réglages exclus');
if (MAIN) patch("if(pre.length<10)return;", "if(pre.length<10||found.some(f=>f._pre===pre)||['charger_type','battery_state','battery_health','is_charging','charging'].some(x=>st[pre+x]&&st[pre+x].state!==undefined&&isNaN(parseFloat(st[pre+x].state))))return;const __bio=sens.some(k=>k.startsWith(pre)&&isW(k)&&/bat_in_out/.test(k));const zin=__bio?null:pick(sens.filter(k=>k.startsWith(pre)&&isW(k)&&/output_pack_power|pack_?charge_?power|battery_?charge_?power/.test(k)),()=>1),zout=__bio?null:pick(sens.filter(k=>k.startsWith(pre)&&isW(k)&&/pack_input_power|pack_?discharge_?power|battery_?discharge_?power/.test(k)),()=>1);", 'détection : doublons + Zendure');
if (MAIN) patch("const pw=pick(sens.filter(k=>k.startsWith(pre)&&isW(k))", "const pw=(zin||zout)?'':pick(sens.filter(k=>k.startsWith(pre)&&isW(k))", 'détection : puissance');
if (MAIN) code = code.replace(/const pw=\(zin\|\|zout\)\?'':pick\(([^\n]*?)\);if\(!pw\)return;/, (m, a) => `const pw=(zin||zout)?'':pick(${a});if(!pw&&!zin&&!zout)return;`);
if (MAIN && !/if\(!pw&&!zin&&!zout\)return;/.test(code)) FAILS.push('retouche « détection : sans puissance » : introuvable');
// détection : les vrais appareils de stockage d'abord (bat_in_out, Titan, Zendure…), puis les autres (packs, appareils divers)
if (MAIN) patch("if(found.length>1){const w=found.map(f=>f.name.split(' '));", "found.sort((a,b)=>(b._sc||0)-(a._sc||0));found.forEach((f,i)=>f.id='b'+i);if(found.length>1){const w=found.map(f=>f.name.split(' '));", 'détection : classement');
// noms : si deux batteries auraient le même nom court, garder « premier mot + dernier mot » (ex. SolarFlow garage)
if (MAIN) patch("found.forEach((f,i)=>{f.name=/pile_average/.test(f.lvl)?'Titan '+(i+1):f.name.slice(0,14)})", "const __on=found.map(g=>g.name);found.forEach((f,i)=>{if(/pile_average/.test(f.lvl)){f.name='Titan '+(i+1);return}const c=f.name.slice(0,14);if(/(^|[\\s/])(de|du|la|charge|batter\\w*|battery|level|niveau|electric)(\\s|$)/i.test(f.name)||__on.some((g,j)=>j!==i&&g.slice(0,14)===c)){const t=String(f._pre||'').replace(/^sensor\\./,'').split('_').filter(Boolean);f.name=(t.length>1?t[0].charAt(0).toUpperCase()+t[0].slice(1)+' '+t[t.length-1]:c).replace(/^Solarflow/,'SolarFlow').slice(0,17);return}f.name=c})", 'détection : noms distincts');
// puissance batterie : jamais un capteur de limite, de maximum, de solaire ou de maison (ex. 8000 W « max »)
if (MAIN) patch("(k,t)=>/ac_input_and_output/.test(k)?5:/bat_in_out|battery_power/.test(k)?3:", "(k,t)=>/max|limit|rated|nominal|target|setpoint|total|today|energy|solar_?input|solar_?power|pv_?power|_pv|panel|home|grid|reseau|house|maison|inverse|mppt/.test(k)?0:/ac_input_and_output/.test(k)?5:/bat_in_out/.test(k)?4:/battery_power|pack_?power|bat_?power/.test(k)?3:", 'détection : puissance plausible');
if (MAIN) patch("found.push({id:'b'+found.length,name:nm,lvl:i,pw,tmp", "found.push({id:'b'+found.length,_pre:pre,_sc:(/pile_average/.test(i)||/ac_input_and_output|bat_in_out/.test(pw||'')?5:(zin||zout)?4:/battery_power|pack_?power|bat_?power|battery_?(charge|discharge)/.test(pw||'')?3:1),name:nm,lvl:i,pw,pin:zin||'',pout:zout||'',tmp", 'détection : entrée/sortie');
if (code.includes("replace(/_(electric_level|pile_average)$/,'')")) patch("replace(/_(electric_level|pile_average)$/,'')", "replace(/_(electric_level|pile_average|soc_level|battery_level|state_of_charge|soc)$/,'')", 'mini/maxi : préfixe');
patch("const capOf=i=>(PACKS.length?", "const capOf=i=>(Array.isArray(__C.batteries)&&__C.batteries.filter(b=>b&&(b.level||b.capacity))[i]&&+__C.batteries.filter(b=>b&&(b.level||b.capacity))[i].capacity>0)?+__C.batteries.filter(b=>b&&(b.level||b.capacity))[i].capacity:(PACKS.length?", 'capacité par batterie');
// performances : le bloc « toutes les secondes » tournait une image sur deux (ca===dt toujours vrai juste après la remise à zéro)
patch("let last=performance.now(),acc=0,ca=0,cs=999,cf=999;", "let last=performance.now(),acc=0,ca=9,cs=999,cf=999;", 'perf : 1er passage');
patch("ca+=dt;if(ca>1||ca===dt){ca=0;", "ca+=dt;if(ca>1){ca=0;", 'perf : mise à jour 1 fois/s');
// performances : les flux de la vue Énergie ne sont plus animés quand la vue Réacteur est affichée
patch("if(!D.live)sim(dt);updFlux(dt);ca+=dt;", "if(!D.live)sim(dt);if(!document.body.classList.contains('lum'))updFlux(dt);ca+=dt;", 'perf : flux Énergie en pause sur Réacteur');
// réserve : une batterie au mini réglé et au repos n'est pas « faible » ; et une lecture basse doit durer 90 s (un capteur qui passe à 0 % une seconde ne déclenche plus d'alerte)
patch("UN.forEach((u,i)=>{const v=D.lvl[i];if(v!==undefined&&v!==null&&v>=0&&v<=ALERT_BAT_PCT)L.push", "UN.forEach((u,i)=>{const v=D.lvl[i];if((function(){var T=window.__lowT||(window.__lowT={});var low=v!==undefined&&v!==null&&v>=0&&v<=ALERT_BAT_PCT&&!(v>=MIN_PCT-1&&v<=MIN_PCT+2&&!((D.p||[])[i]<-80));if(!low){delete T[i];return false}if(!T[i])T[i]=Date.now();return Date.now()-T[i]>=90000})())L.push", 'réserve : pas « batterie faible »');
// détection d'appareils : un appareil à thermostat (fer à lisser, radiateur…) qui s'allume et s'éteint ne fait parler Watt qu'une fois par 10 min
patch("var KEY='zapp',S=[],cool=0,unk=[],wait=null,act={};", "var KEY='zapp',S=[],cool=0,unk=[],wait=null,act={};var __R=[];function __aq(k,w){var t=Date.now(),hit=false;__R=__R.filter(function(r){return t-r.t<600000});__R.forEach(function(r){if(r.k===k&&Math.abs(r.w-Math.abs(w))<=Math.max(80,Math.abs(w)*.18)){hit=true;r.t=t}});if(!hit)__R.push({k:k,w:Math.abs(w),t:t});return hit}", 'appareils : anti-répétition');
patch("var gs=guess(d);WATCH.say('Un appareil de '", "var gs=guess(d);if(__aq('u',d))return;WATCH.say('Un appareil de '", 'appareils : inconnu 1 fois');
patch("if(g.w>=250)WATCH.say(cap(g.name)+' vient de démarrer", "if(g.w>=250&&!__aq('s'+g.name,g.w))WATCH.say(cap(g.name)+' vient de démarrer", 'appareils : démarrage 1 fois');
patch("if(g2.w>=250)WATCH.say(cap(g2.name)+' s’est arrêté(e)", "if(g2.w>=250&&!__aq('e'+g2.name,g2.w))WATCH.say(cap(g2.name)+' s’est arrêté(e)", 'appareils : arrêt 1 fois');
patch("const INVERT_BAT=false;", "const INVERT_BAT=!!__C.invert_bat;", 'INVERT_BAT');
if (MAIN) patch("const TARIF_HP=0.176,TARIF_HC=0.1361;", "const TARIF_HP=__C.tarif_hp!=null?+__C.tarif_hp:0.176,TARIF_HC=__C.tarif_hc!=null?+__C.tarif_hc:0.1361;", 'TARIFS');
if (MAIN) patchRe(/const HC_PLAGES=\[\[[^\n]*?\]\];/, "const HC_PLAGES=Array.isArray(__C.hc_plages)&&__C.hc_plages.length?__C.hc_plages:[['22:00','06:00']];", 'HC_PLAGES');
patch("const PV_MAX=4000,INVERT_GRID=false;", "const PV_MAX=__C.pv_max!=null?+__C.pv_max:4000,INVERT_GRID=!!__C.invert_grid;", 'PV_MAX');
patch("const CO2_KG_KWH=0.052;", "const CO2_KG_KWH=__C.co2_kg_kwh!=null?+__C.co2_kg_kwh:0.052;", 'CO2');
patch("var MIN_PCT=25,MAX_PCT=80;var EV_KWH=60,EV_TARGET=80;", "var MIN_PCT=25,MAX_PCT=80;var EV_KWH=__C.ev_kwh!=null?+__C.ev_kwh:60,EV_TARGET=__C.ev_target!=null?+__C.ev_target:80;", 'EV');
patch("var ALERT_GRID=6000,EV_KWH=60,EV_TARGET=80,", "var ALERT_GRID=6000,EV_KWH=__C.ev_kwh!=null?+__C.ev_kwh:60,EV_TARGET=__C.ev_target!=null?+__C.ev_target:80,", 'EV (lum)');
patchRe(/var AGENT='[^']*';/, "var AGENT=__C.agent||'';", 'AGENT');
patchRe(/var MEM=\[\],AG='[^']*';/, "var MEM=[],AG=__C.agent||undefined;", 'AG');

// rappels : module désactivé = aucune popup ; liste de départ sans les jours de poubelle personnels
if (MAIN && !/if\(!M\.rappels\)hide\('[^']*#rxp/.test(code))   // déjà corrigé dans les versions récentes
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
  if (MAIN && n !== 1) FAILS.push(`retouche « tuile marque » : ${n} occurrence(s) au lieu de 1`);
  for (let i = 0; i < html.length; i++) html[i] = html[i].split(T).join('<span class="zbrand">Batteries</span> · entrée / sortie');
}
code = code.split('batteries Izypower Titan, voiture').join('batteries domestiques, voiture');
code = code.split('izypower|isypower|titan').join('izypower|isypower|titan|zendure|solarflow');
code += `
;/* marque affichée selon les batteries détectées */
(function(){var last='',FIX={isypower:'Isypower',izypower:'Izypower',zendure:'Zendure',none:'Batteries'};function upd(){try{var ids=UN.map(function(u){return String(u.lvl||'')+' '+String(u.pw||'')+' '+String(u.pin||'')}).join(' ').toLowerCase();
 var b=FIX[__C.brand]||(/isypower/.test(ids)?'Isypower':/pile_average|izypower|titan/.test(ids)?'Izypower':/electric_level|bat_in_out|zendure|solarflow|hyper_?2000|hub_?2000|ace_?1500|aio/.test(ids)?'Zendure':'Batteries');
 if(b!==last){last=b;document.querySelectorAll('.zbrand').forEach(function(e){e.textContent=b})}}catch(e){}}
 upd();setInterval(upd,3000)})();
`;

/* ---------- style « Tuyaux » (salle de tazzdel) : son moteur batteries « toutes marques » est gardé ---------- */
if (!MAIN) {
// flux des 4 tuyaux de batteries : suivent l'axe des tuyaux et leurs coudes
patch("['M701.2 331.3 C699.1 331.2 693.5 330.6 688.6 330.4 C683.7 330.2 677.6 330.2 671.8 329.9 C665.9 329.7 659.7 329.3 653.7 329.0 C647.6 328.8 641.5 328.5 635.4 328.6 C629.2 328.6 623.0 328.9 616.9 329.4 C610.8 329.9 604.4 330.2 598.6 331.6 C592.8 333.1 586.9 334.9 581.9 338.1 C577.0 341.3 572.7 345.9 568.9 350.9 C565.2 355.9 562.4 362.2 559.4 368.1 C556.5 374.0 554.2 380.6 551.1 386.5 C548.0 392.4 544.7 398.3 540.7 403.5 C536.8 408.7 532.2 413.4 527.5 417.9 C522.8 422.3 517.5 426.2 512.5 430.1 C507.6 434.0 502.2 438.0 497.9 441.3 C493.6 444.6 488.5 448.3 486.6 449.7','#4dff8a',0]", "['M701.0 331.0 C662.7 330.5 624.3 329.9 586.0 329.4 C569.5 329.2 556.0 342.5 556.0 359.0 C556.0 369.5 556.0 380.0 556.0 390.5 C556.0 406.7 542.7 420.0 526.5 420.0 C526.5 420.0 526.5 420.0 526.5 420.0 C510.3 420.0 497.0 433.3 497.0 449.5 C497.0 449.7 497.0 449.8 497.0 450.0','#4dff8a',0]", "flux batterie 0 : coudes");
patch("['M707.3 392.6 C705.1 392.8 699.6 393.5 694.6 394.1 C689.6 394.7 683.2 395.2 677.2 396.1 C671.1 396.9 664.3 397.6 658.2 399.2 C652.1 400.8 645.8 402.6 640.6 405.6 C635.4 408.7 630.8 412.7 627.2 417.3 C623.7 421.8 621.3 427.8 619.5 432.9 C617.7 438.0 616.8 445.3 616.3 447.7','#4dff8a',1]", "['M707.0 400.0 C692.7 400.0 678.3 400.0 664.0 400.0 C644.2 400.0 628.0 416.2 628.0 436.0 C628.0 440.7 628.0 445.3 628.0 450.0','#4dff8a',1]", "flux batterie 1 : coudes");
patch("['M955.2 393.4 C957.4 393.6 963.0 393.9 968.0 394.5 C973.1 395.1 979.5 395.6 985.5 396.9 C991.5 398.2 998.2 399.6 1004.0 402.0 C1009.9 404.4 1015.9 407.4 1020.5 411.2 C1025.2 415.0 1029.0 419.9 1031.9 424.7 C1034.7 429.6 1036.2 435.7 1037.7 440.4 C1039.3 445.1 1040.6 450.9 1041.1 453.0','#4dff8a',2]", "['M955.0 400.0 C968.0 400.0 981.0 400.0 994.0 400.0 C1013.8 400.0 1030.0 416.2 1030.0 436.0 C1030.0 441.7 1030.0 447.3 1030.0 453.0','#4dff8a',2]", "flux batterie 2 : coudes");
patch("['M959.0 329.0 C961.2 328.9 966.9 328.1 972.0 328.2 C977.0 328.2 983.4 329.0 989.4 329.3 C995.4 329.7 1001.8 330.3 1008.1 330.2 C1014.3 330.2 1020.6 329.3 1026.8 329.0 C1032.9 328.7 1039.1 328.0 1045.0 328.3 C1050.9 328.7 1057.0 328.3 1062.4 330.9 C1067.8 333.6 1073.0 339.7 1077.5 344.2 C1082.0 348.6 1085.8 352.6 1089.3 357.7 C1092.8 362.7 1095.4 368.9 1098.4 374.5 C1101.3 380.1 1103.8 386.1 1107.2 391.4 C1110.6 396.7 1114.5 401.7 1118.7 406.3 C1123.0 411.0 1128.2 415.0 1132.7 419.5 C1137.3 423.9 1141.9 428.6 1146.0 432.9 C1150.2 437.3 1155.7 443.5 1157.6 445.6','#4dff8a',3]", "['M959.0 329.0 C992.7 328.7 1026.3 328.5 1060.0 328.2 C1076.5 328.1 1090.0 341.5 1090.0 358.0 C1090.0 370.7 1090.0 383.3 1090.0 396.0 C1090.0 412.5 1103.5 426.0 1120.0 426.0 C1122.0 426.0 1124.0 426.0 1126.0 426.0 C1139.2 426.0 1150.0 436.8 1150.0 450.0 C1150.0 450.0 1150.0 450.0 1150.0 450.0','#4dff8a',3]", "flux batterie 3 : coudes");
patch("['M833.8 218.7 C833.8 204.7 833.8 149.0 833.8 135.1','#4de1ff','house']", "['M832.0 218.7 C832.0 204.7 832.0 149.0 832.0 135.1','#4de1ff','house']", 'flux maison centré');
// flux des tuyaux du haut (solaire jaune, réseau rouge) recentrés sur l'axe des tuyaux de l'image
patch("['M670.4 135.1 C676.7 142.9 695.7 167.8 708.4 182.2 C721.1 196.6 740.1 215.1 746.4 221.7','#ffd24a','pv']", "['M663.0 134.0 C682.3 163.3 701.7 192.7 721.0 222.0','#ffd24a','pv']", 'flux solaire centré');
patch("['M936.4 224.0 C944.0 217.0 966.5 197.3 982.0 182.2 C997.5 167.1 1021.3 141.7 1029.1 133.6','#4fc3ff','grid']", "['M952.0 224.0 C974.3 194.0 996.7 164.0 1019.0 134.0','#4fc3ff','grid']", 'flux réseau centré');
// vapeur : le 1er pas de temps pouvait être négatif (horodatage de l'image < moment du clic) -> la vapeur s'éteignait aussitôt, « ne marche pas tout le temps »
patch("function frame(now){var dt=Math.min(.05,(now-last)/1000);last=now;T+=dt;\n pw+=((on?1:0)-pw)*Math.min(1,dt*1.6);", "function frame(now){var dt=Math.max(0,Math.min(.05,(now-last)/1000));last=now;T+=dt;\n pw+=((on?1:0)-pw)*Math.min(1,dt*1.6);", 'vapeur : pas de temps négatif');
patch(" if(pw>.02||P.length){requestAnimationFrame(frame)}else{run=false;cv.style.display='none'}}", " if(on||pw>.02||P.length){requestAnimationFrame(frame)}else{run=false;cv.style.display='none'}}", 'vapeur : ne pas s’arrêter tant qu’elle est demandée');
// mode cinéma : Cerveau, trophées, visite guidée, simulateur et histoire ouvrent des panneaux -> on sort d'abord du mode cinéma (sinon panneau coupé sur un réacteur zoomé et flou)
patch("think('Mode cinéma — Échap (ou 🎬) pour revenir.',1)", "think('Mode cinéma — Échap (ou 🎬) pour revenir.',1);if(!window.__cnBtn){window.__cnBtn=1;document.addEventListener('click',function(e){try{if(!document.body.classList.contains('bn-cine'))return;var t=e.target&&e.target.closest&&e.target.closest('#bnB,#bnTrb,#bnTb,#bnSmB,#bnStB');if(!t)return;var c=document.getElementById('bnC');c&&c.click()}catch(_){}},true)}", 'cinéma : sortir avant un panneau');
// boutons ajoutés par tazzdel (sirène, Noël, simulateur, histoire) : « this » n'était pas le bouton -> erreur rouge « reading 'style' »
patch("b.addEventListener('click',function(ev){try{fn(ev)}catch(e){console.error(e)}});dock&&dock.appendChild(b);return b}", "b.addEventListener('click',function(ev){try{fn.call(b,ev)}catch(e){console.error(e)}});dock&&dock.appendChild(b);return b}", 'dock : boutons sirène/Noël');
// un seul seuil de surcharge : le cerveau (bulles des techniciens, alertes) lit la pastille du réacteur et regarde maison OU réseau
patch("window.__sur=function(){return SUR};", "window.__sur=function(){return SUR};window.__thrR=function(){return CFG.thr};", 'seuil unique : export');
patch("function msgsL(){var M=[],d=dv(),h=new Date().getHours(),T=thr();\n if(D.grid>T)M.push(['⚠️ Surconsommation ! '+fk(D.grid)+' kW, le réseau dépasse le seuil !',2]);\n else if(D.grid>T*.85)M.push(['😬 Attention, je frôle le seuil réseau ('+fk(D.grid)+' kW)…',1]);", "function msgsL(){var M=[],d=dv(),h=new Date().getHours(),T=thr(),G=Math.max(D.grid,d.house||0);\n if(G>T)M.push(['⚠️ Surcharge ! '+fk(G)+' kW, ça dépasse le seuil !',2]);\n else if(G>T*.85)M.push(['😬 Attention, je frôle le seuil ('+fk(G)+' kW)…',1]);", 'seuil unique : bulles');
patch("function rules(){var A=[],g=D.grid,T=thr(),h=new Date().getHours();\n if(g>T)A.push({l:2,m:'SURCHARGE RÉSEAU '", "function rules(){var A=[],g=Math.max(D.grid,(dv().house)||0),T=thr(),h=new Date().getHours();\n if(g>T)A.push({l:2,m:'SURCHARGE '", 'seuil unique : règles');
// réserve atteinte (au mini réglé, batteries au repos) : pas d'alerte « vides avant le matin », Watt reste calme
patch("low=avg<MIN_PCT+4;", "low=avg<MIN_PCT+4&&!(avg<=MIN_PCT+2&&D.p.every(function(p){return !(p<-80)}));", 'réserve : Watt calme');
// mode cinéma : sur téléphone/tablette, pas de zoom lent continu (trop lourd pour la puce graphique, les cadres batteries clignotaient)
patch("try{CN.an=L.animate([{transform:'translate(-461px,-139px) scale(1.512)'}", "try{if(window.matchMedia&&matchMedia('(pointer:coarse)').matches)throw 0;CN.an=L.animate([{transform:'translate(-461px,-139px) scale(1.512)'}", 'cinéma : pas de zoom sur tactile');
// mode cinéma : sur téléphone (pas de touche Échap), on en sort en touchant l'écran
patch("think('Mode cinéma — Échap (ou 🎬) pour revenir.',1)", "think('Mode cinéma — touchez l’écran (ou Échap) pour revenir.',1);window.__cnT0=Date.now();if(!window.__cnTap){window.__cnTap=1;document.addEventListener('pointerup',function(e){try{if(!document.body.classList.contains('bn-cine'))return;var t=e.target;if(t&&t.closest&&t.closest('#bnDock,#bnPanel,#bnC'))return;if(Date.now()-(window.__cnT0||0)<800)return;var b=document.getElementById('bnC');b&&b.click()}catch(_){}},true)}", 'cinéma : sortie au toucher');
// cerveau : dans la carte, les réglages (tarifs, mini %, kWh par pack) ne sont pas globaux -> « économie ≈ NaN € »
patch(`var G=function(n,d){try{return (new Function('return typeof '+n+'!=="undefined"?'+n+':undefined'))()}catch(e){}return d};`, `var G=function(n,d){var v;try{v={TARIF_HC:typeof TARIF_HC!=='undefined'?TARIF_HC:void 0,TARIF_HP:typeof TARIF_HP!=='undefined'?TARIF_HP:void 0,KWH_PACK:typeof KWH_PACK!=='undefined'?KWH_PACK:void 0,MIN_PCT:typeof MIN_PCT!=='undefined'?MIN_PCT:void 0}[n]}catch(e){}if(v===void 0)try{v=(new Function('return typeof '+n+'!=="undefined"?'+n+':undefined'))()}catch(e){}return (typeof v==='number'&&isFinite(v))?v:d};`, 'cerveau : réglages');
patch("B.kwh.saved+=Math.max(0,x-Math.max(0,D.grid))*dt/1000*pr;", "if(!isFinite(B.kwh.saved))B.kwh.saved=0;B.kwh.saved+=Math.max(0,x-Math.max(0,D.grid))*dt/1000*pr;", 'cerveau : économie NaN');
// bandeau : « Réserve atteinte » au lieu de « Batteries faibles » quand on est au mini réglé (même message que le conseil de Watt)
patch("else if(tot<MIN_PCT+8)al={c:'#ff3b3b',t:'⚠ Batteries faibles '+Math.round(tot)+' %',f:2.2};", "else if(tot<MIN_PCT+8)al=tot<=MIN_PCT+2?{c:'#ffb04a',t:'🔋 Réserve atteinte '+Math.round(tot)+' % (mini '+MIN_PCT+' %)',f:1.2}:{c:'#ff8a3b',t:'⚠ Proche de la réserve '+Math.round(tot)+' %',f:1.6};", 'bandeau réserve');
  // batteries de l'éditeur : prioritaires sur la détection automatique (pw2 = capteur de décharge séparé)
  patchRe(/const UN=\[\n \{id:'b1'[\s\S]*?\];/, "const UN=Array.isArray(__C.batteries)&&__C.batteries.some(b=>b&&b.level)?__C.batteries.filter(b=>b&&b.level).slice(0,4).map((b,i)=>{const io=!!(b.power_in||b.power_out);return{id:'b'+(i+1),hp:!!b.hide_power,label:b.label?String(b.label).slice(0,10):'',slot:__C.batteries.indexOf(b),name:b.name||('Batterie '+(__C.batteries.indexOf(b)+1)),lvl:b.level,pw:io?(b.power_in||b.power_out):(b.power||''),pw2:io&&b.power_in?(b.power_out||''):'',k:(io&&!b.power_in?-1:(!io&&/bat_in_out/.test(b.power||'')?-1:1))*(b.invert?-1:1)*(__C.invert_bat?-1:1),tmp:b.temperature||'sensor.aucun'}}):[\n {id:'b1',name:'Batterie 1',lvl:'sensor.batterie_1_niveau',pw:'sensor.batterie_1_puissance',tmp:'sensor.batterie_1_temp'},\n {id:'b2',name:'Batterie 2',lvl:'sensor.batterie_2_niveau',pw:'sensor.batterie_2_puissance',tmp:'sensor.batterie_2_temp'},\n {id:'b3',name:'Batterie 3',lvl:'sensor.batterie_3_niveau',pw:'sensor.batterie_3_puissance',tmp:'sensor.batterie_3_temp'},\n {id:'b4',name:'Batterie 4',lvl:'sensor.batterie_4_niveau',pw:'sensor.batterie_4_puissance',tmp:'sensor.batterie_4_temp'}];", 'tuyaux : batteries');
  patch("const BATSET={};", "const BATSET={};(Array.isArray(__C.batteries)?__C.batteries.filter(b=>b&&b.level).slice(0,4):[]).forEach((b,i)=>{if(b.min||b.max)BATSET['b'+(i+1)]={min:b.min||'',max:b.max||''}});", 'tuyaux : mini/maxi');
  patchRe(/const PACKS=\[[^\]]*\];/, "const PACKS=Array.isArray(__C.packs)?__C.packs:[1,1,1,1];", 'tuyaux : PACKS');
  patchRe(/const KWH_PACK=[\d.]+;/, "const KWH_PACK=__C.kwh_pack!=null?+__C.kwh_pack:2.1;", 'tuyaux : KWH_PACK');
  patchRe(/const TARIF_HP=[\d.]+,TARIF_HC=[\d.]+;/, "const TARIF_HP=__C.tarif_hp!=null?+__C.tarif_hp:0.176,TARIF_HC=__C.tarif_hc!=null?+__C.tarif_hc:0.1361;", 'tuyaux : tarifs');
  patchRe(/const HC_DEBUT=\d+,HC_FIN=\d+;/, "const HC_PLAGES=Array.isArray(__C.hc_plages)&&__C.hc_plages.length?__C.hc_plages:[['22:00','06:00']];const HC_MIN=HC_PLAGES.map(p=>p.map(x=>{const a=String(x).split(':');return (+a[0])*60+(+a[1]||0)}));function isHC(d){d=d||new Date();const m=d.getHours()*60+d.getMinutes();return HC_MIN.some(p=>p[0]>p[1]?(m>=p[0]||m<p[1]):(m>=p[0]&&m<p[1]))}const HC_TXT=HC_PLAGES.map(p=>String(p[0]).replace(':','h')+'-'+String(p[1]).replace(':','h')).join(' et ');const HC_DEBUT=parseInt(HC_PLAGES[0][0],10)||0,HC_FIN=parseInt(HC_PLAGES[0][1],10)||0;", 'tuyaux : heures creuses');
  patch("var pr=(hr>=HC_DEBUT||hr<HC_FIN)?.2277:.2941;", "var pr=isHC()?TARIF_HC:TARIF_HP;", 'tuyaux : coût');
  // détection : Izypower/Isypower Titan (pile_average, ac_input_and_output) et Zendure (output_pack_power / pack_input_power)
  patch("const LV=/electric_level|", "const LV=/pile_average|electric_level|", 'tuyaux : niveau Titan');
  patch("let pre=base.replace(/_?(electric_level|", "let pre=base.replace(/_?(pile_average|electric_level|", 'tuyaux : préfixe Titan');
  patch("const BP=/bat|akku|storage|stockage|charge|discharg|d[ée]charge|in_out|stor/;", "const BP=/bat|akku|storage|stockage|charge|discharg|d[ée]charge|in_out|stor|pack|input_and_output/;", 'tuyaux : puissance batterie');
  patch("|in_out|inout/.test(T(k));", "|in_out|inout|input_and_output/.test(T(k));", 'tuyaux : sens Titan (1)');
  patch("&&!/in_out|inout|charge_discharge/.test(T(k));", "&&!/in_out|inout|charge_discharge|input_and_output/.test(T(k));", 'tuyaux : sens Titan (2)');
  patch("&&!/charge_discharge|charging_discharging/.test(pw)?-1:1}", "&&!/charge_discharge|charging_discharging|input_and_output/.test(pw)?-1:1}", 'tuyaux : sens Titan (3)');
  patch("   let pw,pw2,k;", "   let pw,pw2,k;const __zi=cand.find(x=>/output_pack_power/.test(x)),__zo=cand.find(x=>/pack_input_power/.test(x));if(__zi&&__zo&&!cand.some(x=>/bat_in_out/.test(x))){pw=__zi;pw2=__zo;k=1}else", 'tuyaux : Zendure entrée/sortie');
  patch("found.forEach((f,i)=>{if(!f.name||f.name.length<3)", "found.forEach((f,i)=>{if(/pile_average/.test(f.lvl))f.name='Titan '+(i+1)});found.forEach((f,i)=>{if(!f.name||f.name.length<3)", 'tuyaux : noms Titan');
  // fond illustré absent du paquet : pas de requête vers un fichier inexistant
  stylesOut.forEach(st => { st.css = st.css.split('url("commande-reacteur-fond.jpg")').join('none'); });
  for (let i = 0; i < html.length; i++) html[i] = html[i].split('url("commande-reacteur-fond.jpg")').join('none');
  // bilan du jour : nombre réel de batteries (et non 4 fixes)
  patch("let chg=0,dis=0;for(let k=2;k<6;k++){const v=g[k][i];", "let chg=0,dis=0;for(let k=2;k<2+UN.length&&k<6;k++){const v=g[k][i];", 'tuyaux : bilan du jour');
  // noms : comme les autres styles, « SolarFlow garage », « Hyper 3 » quand le nom est flou ou en double
  patch("f.name=f.name.slice(0,16)});", "f.name=f.name.slice(0,16)});{const __on=found.map(g=>g.name);found.forEach((f,i)=>{if(/pile_average/.test(f.lvl))return;const c=f.name.slice(0,14);if(/(^|[\\s/])(de|du|la|charge|batter\\w*|battery|level|niveau|electric)(\\s|$)/i.test(f.name)||__on.some((g,j)=>j!==i&&g.slice(0,14)===c)){const t=f.lvl.replace(/^sensor\\./,'').replace(/_?(electric_level|battery_level|state_of_charge|soc|level|niveau)[a-z_0-9]*$/,'').split('_').filter(Boolean);if(t.length>1)f.name=(t[0].charAt(0).toUpperCase()+t[0].slice(1)+' '+t[t.length-1]).replace(/^Solarflow/,'SolarFlow').slice(0,17)}})}", 'tuyaux : noms');
  // voiture : même détection que les autres styles (pas de capteur de batterie, de max ou de consigne ; borne Isypower prioritaire)
  patch("const r=pick(sens.filter(isW),(i,t)=>/charging_power|charge_power|puissance_charge|wallbox|borne|evse|charger/.test(t)?1+(/charging_power/.test(t)?2:0):0);", "const r=pick(sens.filter(isW),(i,t)=>/charging_power|charge_power|puissance_charge|wallbox|borne|evse|charger/.test(t)&&!/titan|pile|batter|bat_|cluster|max|limit|consigne|setpoint|rated|nominal|target|schedul|planif|pack|solarflow|hyper/.test(t)?1+(/charging_power/.test(t)?2:0)+(/ev_charger|evse|wallbox|borne/.test(t)?3:0)+(/ev_charger_(puissance|power)/.test(t)?4:0):0);", 'tuyaux : voiture');
  // vue Réacteur : 2 batteries → emplacements 2 et 3 (de part et d'autre du réacteur)
  patch("var BX=[[423,128],[555,128],[982,128],[1105,128]]", "var __SK,BX=(function(){var S=[[420,124],[548,124],[980,124],[1108,124]],K=UN.every(function(u){return u.slot>=0&&u.slot<4})?UN.map(function(u){return u.slot}):UN.length===1?[1]:UN.length===2?[1,2]:UN.length===3?[0,1,2]:[0,1,2,3];__SK=K;return K.map(function(k){return S[k]})})()", 'tuyaux : emplacements batteries');
  // v3 : icônes 🧠/🎬 passées à la place de la classe (boutons vides) ; boutons seulement sur la vue Réacteur
  if (code.includes("el('button','bnB','🧠',null,dock)")) { code = code.split("el('button','bnB','🧠',null,dock)").join("el('button','bnB',null,'🧠',dock)").split("el('button','bnC','🎬',null,dock)").join("el('button','bnC',null,'🎬',dock)"); }
  // double-clic sur l'horloge : plein écran de la carte (bouton ⛶), pas de la page Home Assistant
  code = code.split("addEventListener('dblclick',function(){try{document.documentElement.requestFullscreen()}catch(e){}})").join("addEventListener('dblclick',function(){try{var f=__card.shadowRoot&&__card.shadowRoot.getElementById('fsbtn');f&&f.click()}catch(e){}})");
  for (let i = 0; i < html.length; i++) html[i] = html[i].replace('<style id="bnCss">', '<style id="bnCss">\n.zb:not(.lum) #bnDock{display:none}\n#lum .plate svg.seg{display:block;width:calc(100% - 6px)!important;height:auto!important;margin:0 auto}#pFx .rxgrid{top:52px!important;left:310px!important;width:214px!important}#pFx .rxev{top:52px!important}body:not(.lum) #menuBtn{left:1010px!important;width:150px!important;height:46px!important;line-height:42px!important;font-size:18px!important;letter-spacing:2px!important}body:not(.lum) #hdt{transform:none!important;right:108px!important;gap:14px!important}body:not(.lum) #hDate{width:150px!important}body:not(.lum) #ctlb,body:not(.lum) #rxtemp,body:not(.lum) #rxpalb,body:not(.lum) #rxbigb{top:62px!important;height:26px!important;transform:none!important}body:not(.lum) #ctlb{left:1043px!important}body:not(.lum) #rxtemp{left:1230px!important}body:not(.lum) #rxpalb{left:1434px!important}body:not(.lum) #rxbigb{left:1518px!important}');
  // plaques batteries : même taille que le bloc orange de la photo
  patch("d.style.cssText='left:'+BX[i][0]+'px;top:462px;width:'+BX[i][1]+'px;height:120px'", "d.style.cssText='left:'+BX[i][0]+'px;top:442px;width:'+BX[i][1]+'px;height:148px'", 'tuyaux : taille plaques');
  // Maison · commandes : tuiles selon « Éléments affichés » + tuile Chauffe-eau (comme le style Nouveau)
  patch("mkTile('ctV',3,'VOLETS',IC.blinds,[['vup','▲'],['vdn','▼'],['vgo','RÉGLER',1.5]]);", "mkTile('ctV',3,'VOLETS',IC.blinds,[['vup','▲'],['vdn','▼'],['vgo','RÉGLER',1.5]]);" + `(function(){try{
const M=Object.assign({portail:false,garage:false,chauffage:true,volets:false,chauffeeau:true},__C.modules||{}),EC=Object.assign({haute:'',basse:'',grande:'',desinf:''},__C.ecs_tile||{}),EF={found:false};
function layout(){const L=[['ctP',M.portail],['ctG',M.garage],['ctC',M.chauffage],['ctV',M.volets],['ctE',M.chauffeeau&&EF.found]].filter(t=>{const e=document.getElementById(t[0]);if(!e)return false;e.style.display=t[1]?'':'none';return t[1]});
 const w=Math.floor((4*241-11)/Math.max(1,L.length))-11;L.forEach((t,i)=>{const e=document.getElementById(t[0]);e.style.left=(14+i*(w+11))+'px';e.style.width=w+'px'});pCt.style.display=L.length?'':'none'}
if(M.chauffeeau){const te=document.createElement('div');te.className='tile';te.id='ctE';te.style.display='none';
 const rs='position:absolute;left:10px;right:8px;font:600 11.5px Inter,Roboto,sans-serif;color:#9fd0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
 te.innerHTML=IC.ecs.replace('class="ic"','class="ti ic"')+'<div class="tn">CHAUFFE-EAU</div><div class="ts" id="eT" style="font-size:18px;letter-spacing:.5px;color:#ffb13b">--</div><div id="eG" style="'+rs+';top:60px"></div><div id="eD" style="'+rs+';top:80px"></div>';pCt.appendChild(te);
 let rl=null;const mkRl=()=>{const lz=document.getElementById('lZd');if(lz&&lz.parentNode){rl=document.createElement('div');rl.id='lEcs';rl.style.cssText='display:none;margin-top:12px;padding:8px 14px;border-radius:12px;border:1px solid rgba(255,177,59,.35);background:rgba(255,140,40,.08);font:600 18px Inter,Roboto,sans-serif;color:#ffd9a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';lz.parentNode.appendChild(rl)}};
 let last=null;
 const upd=()=>{try{const h=__card._hass;if(!h||!h.states)return;const S=h.states,ids=Object.keys(S);
  const nm=id=>(id+' '+((S[id].attributes&&S[id].attributes.friendly_name)||'')).toLowerCase();
  const ctx=/ecs|ballon|cumulus|chauffe.?eau|eau.?chaude|water.?heater|dhw|acs/,dom=/^(sensor|number|binary_sensor|switch|input_datetime|input_boolean|input_text|datetime|select|text)\\./;
  const pick=(cfg,re,need,temp)=>{if(cfg&&S[cfg])return cfg;for(const id of ids){if(!dom.test(id))continue;const n=nm(id);if(!re.test(n))continue;if(need&&!ctx.test(n))continue;if(temp){if(!/^(sensor|number)\\./.test(id))continue;const sv=S[id].state;if(isNaN(parseFloat(sv))&&sv!=='unknown'&&sv!=='unavailable')continue;if(!(/temp|sonde|°/.test(n)||(S[id].attributes&&S[id].attributes.unit_of_measurement==='°C')))continue}return id}return ''};
  EF.haute=pick(EC.haute,/haute|high|\\btop\\b|\\bhaut\\b/,true,true);EF.basse=pick(EC.basse,/basse|\\blow\\b|bottom|\\bbas\\b/,true,true);
  EF.grande=pick(EC.grande,/grande.?chauffe|grand.?chauffe|boost|forc[eé]/,false,false);EF.desinf=pick(EC.desinf,/d[eé]sinfect|desinfect|l[eé]gionel|anti.?legio/,false,false);
  EF.found=!!(EF.haute||EF.basse||EF.grande||EF.desinf);
  const val=id=>{const s=id&&S[id];if(!s)return null;const v=s.state;return(v==='unknown'||v==='unavailable'||v==='')?null:v};
  const fdate=v=>{if(v==null)return '--';if(/^\\d{4}-\\d\\d-\\d\\d/.test(v)){const d=new Date(v);if(!isNaN(d))return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})+(/\\d\\d:\\d\\d/.test(v)?' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'')}return v};
  const fst=v=>v==null?'--':({on:'EN COURS',off:'non',true:'EN COURS',false:'non'}[v]||fdate(v));
  const fn=v=>{if(v==null)return '--';const n=parseFloat(v);return isNaN(n)?v:(Math.round(n*10)/10)+'°'};
  const t=[];if(EF.haute)t.push('H '+fn(val(EF.haute)));if(EF.basse)t.push('B '+fn(val(EF.basse)));
  document.getElementById('eT').textContent=t.join(' · ')||'--';
  if(!rl||!rl.isConnected)mkRl();if(rl){const pw=(typeof D!=='undefined'&&D.ecs)||0;rl.style.display=EF.found?'':'none';rl.textContent='🔥 Chauffe-eau · '+(t.join(' · ')||'--')+(pw>20?' · chauffe '+Math.round(pw)+' W':' · veille')}
  document.getElementById('eG').textContent=EF.grande?'Grande chauffe : '+fst(val(EF.grande)):'';
  document.getElementById('eD').textContent=EF.desinf?'Dernière désinfection : '+fdate(val(EF.desinf)):'';
  const k=String(EF.found);if(k!==last){last=k;layout()}}catch(e){console.error('ecs-tile',e)}};
 setInterval(upd,3000);setTimeout(upd,800)}
layout()}catch(e){console.error('tuiles',e)}})();`, 'tuyaux : tuiles commandes');
  // vue Énergie : mêmes emplacements que la vue Réacteur, libellés T1…T4 comme les autres styles
  patch("const BX=[298,446,594,742],fBat=[];", "const BX=(()=>{const B=[298,446,594,742],K=UN.every(u=>u.slot>=0&&u.slot<4)?UN.map(u=>u.slot):UN.length===1?[1]:UN.length===2?[1,2]:UN.length===3?[0,1,2]:[0,1,2,3];return K.map(k=>B[k])})(),fBat=[];", 'tuyaux : emplacements vue Énergie');
  patch('<div class="zt">Z${i+1}</div>', '<div class="zt">${(UN[i]&&UN[i].label)||\'T\'+(i+1)}</div>', 'tuyaux : libellés T');
  // tuyaux lumineux et halos des machines : par emplacement → la batterie qui l'occupe (rien si emplacement vide)
  patch("else{var p=D.p[x.k]||0;", "else{var __i=__SK.indexOf(x.k),p=__i<0?0:(D.p[__i]||0);", 'tuyaux : flux par emplacement');
  patch("MG.forEach(function(c,i){var p=D.p[i]||0,", "MG.forEach(function(c,i){var __j=__SK.indexOf(i),p=__j<0?0:(D.p[__j]||0),", 'tuyaux : halos par emplacement');
  patch("SPK.forEach(function(a,i){var p=D.p[i]||0,", "SPK.forEach(function(a,i){var __j=__SK.indexOf(i),p=__j<0?0:(D.p[__j]||0),", 'tuyaux : étincelles par emplacement');
  patch("ANT.forEach(function(g,i){var p=D.p[i]||0,", "ANT.forEach(function(g,i){var __j=__SK.indexOf(i),p=__j<0?0:(D.p[__j]||0),", 'tuyaux : fourmis par emplacement');
  patch("INS.forEach(function(I,j){var p=D.p[j]||0,", "INS.forEach(function(I,j){var __k=__SK.indexOf(j),p=__k<0?0:(D.p[__k]||0),", 'tuyaux : isolateurs par emplacement');
  // reprises de la version HTML patchée : plusieurs plages HC, tarifs, sens des flux, min/maxi Titan, chauffage…
  patch("hc=HC_DEBUT>HC_FIN?(h>=HC_DEBUT||h<HC_FIN):(h>=HC_DEBUT&&h<HC_FIN),price", "hc=isHC(new Date(grid[i])),price", 'tuyaux : HC (historique)');
  patchAll("const h=new Date().getHours(),hc=HC_DEBUT>HC_FIN?(h>=HC_DEBUT||h<HC_FIN):(h>=HC_DEBUT&&h<HC_FIN);", "const h=new Date().getHours(),hc=isHC();", 'tuyaux : HC (bandeau)');
  patch("hc=HC_DEBUT>HC_FIN?(hh>=HC_DEBUT||hh<HC_FIN):(hh>=HC_DEBUT&&hh<HC_FIN)", "hc=isHC(t)", 'tuyaux : HC (jour)');
  patch("function hcNow(){var h=new Date().getHours();return HC_DEBUT>HC_FIN?(h>=HC_DEBUT||h<HC_FIN):(h>=HC_DEBUT&&h<HC_FIN)}", "function hcNow(){return isHC()}", 'tuyaux : HC (maintenant)');
  patch("try{hc=HC_DEBUT>HC_FIN?(h>=HC_DEBUT||h<HC_FIN):(h>=HC_DEBUT&&h<HC_FIN)}", "try{hc=HC_MIN.some(p=>{const m=h*60;return p[0]>p[1]?(m>=p[0]||m<p[1]):(m>=p[0]&&m<p[1])})}", 'tuyaux : HC (heure)');
  patch("('+HC_DEBUT+'h-'+HC_FIN+'h)", "('+HC_TXT+')", 'tuyaux : HC (texte)');
  patch("*.2941))+' €');", "*TARIF_HP))+' €');", 'tuyaux : économie solaire');
  patch("w>=0?'#2dff8a':'#ffb13b',w>=0?-1:1,sp(Math.abs(w)))}", "w>=0?'#2dff8a':'#ffb13b',w>=0?1:-1,sp(Math.abs(w)))}", 'tuyaux : sens flux batteries');
  patch("/zendure|solarflow|hyper|shelly|solcast|marstek", "/zendure|solarflow|hyper|izypower|isypower|titan|shelly|solcast|marstek", 'tuyaux : capteurs hors ligne');
  patch("if(s.state==='unavailable'&&off.length<30&&", "if(s.state==='unavailable'&&off.length<30&&!/solcast.*(day_?[3-7]|jour_?[3-7]|damp|amort|precis|hard_limit|limite)/i.test(id)&&", 'tuyaux : Solcast secondaires');
  patch("if(!id.startsWith('number.')||!id.includes(pre))return;", "if(!id.startsWith('number.')||!(id.includes(pre)||/(^|[._])cluster_/.test(id)))return;", 'tuyaux : mini/maxi cluster');
  patch("|reserve|minimum/.test(k))o.min=mk(id);", "|reserve|minimum|soc.?security/.test(k))o.min=mk(id);", 'tuyaux : mini Titan');
  patch("else if(id.startsWith('climate.'))cli.push(", "else if(id.startsWith('climate.')&&!/room.?temperature/.test(low))cli.push(", 'tuyaux : chauffage sans doublons');
  patch("if(/ballon|ecs|eau|ext|hyper|batt|zendure|solar|voiture|cong|frigo/i.test(n)", "if(/ballon|ecs|eau|ext|hyper|batt|izypower|isypower|titan|zendure|solar|voiture|cong|frigo/i.test(n)", 'tuyaux : température maison (1)');
  patch("if(/ext|outdoor|dehors|ballon|ecs|eau|batt|hyper|zendure|solarflow|marstek", "if(/ext|outdoor|dehors|ballon|ecs|eau|batt|hyper|izypower|isypower|titan|zendure|solarflow|marstek", 'tuyaux : température maison (2)');
  patch("D.ev=rd(st,E.ev);D.ecs=rd(st,E.ecs);", "D.ev=(__C.modules&&__C.modules.voiture===false)?0:rd(st,E.ev);D.ecs=(__C.modules&&__C.modules.ballon===false)?0:rd(st,E.ecs);D.p.length=D.lvl.length=D.tmp.length=UN.length;", 'tuyaux : voiture / ballon masqués');
  // « Performance du jour » plus lisible : cadran plus petit et centré, libellés sous le chiffre, 6 valeurs en grille, halos atténués
  patch("g.style.cssText+=';position:absolute;left:22px;top:26px';", "g.style.cssText+=';position:absolute;left:52px;top:58px';g.setAttribute('width',196);g.setAttribute('height',196);", 'perf : cadran');
  patch("var R=el('left:0;width:300px;top:212px;text-align:center;font:700 46px '+FM+';color:#fff;text-shadow:0 0 6px #000,0 0 12px #000,0 0 22px #2dff8a;", "var R=el('left:0;width:300px;top:258px;text-align:center;font:700 38px '+FM+';color:#fff;text-shadow:0 0 8px #000;", 'perf : chiffre');
  patch("var U=el('left:0;width:300px;top:260px;text-align:center;font:600 15px '+FM+';", "var U=el('left:0;width:300px;top:300px;line-height:1.25;text-align:center;font:600 13px '+FM+';", 'perf : libellé');
  patch("var row=el('left:0;width:300px;top:282px;display:flex;justify-content:center;gap:6px;z-index:3');", "var row=el('left:0;width:300px;top:344px;display:flex;justify-content:center;gap:6px;z-index:3');", 'perf : boutons');
  patch("b.style.cssText='padding:5px 9px;text-align:center;font:700 13px Inter,sans-serif;", "b.style.cssText='padding:4px 8px;text-align:center;font:700 11.5px Inter,sans-serif;", 'perf : bouton');
  patch("ob.style.cssText='padding:5px 9px;font:700 13px Inter,sans-serif;", "ob.style.cssText='padding:4px 8px;font:700 11.5px Inter,sans-serif;", 'perf : objectif');
  patch("var st=el('left:14px;width:272px;top:318px;text-align:center;font:600 13px '+FM+';color:#9fb4cc;", "var st=el('left:14px;width:272px;top:378px;text-align:center;font:600 11.5px '+FM+';color:#7d96b3;", 'perf : reste');
  patch("U.textContent=sv.m===0?'autarcie du jour':sv.m===1?'autarcie en ce moment':'autoconsommation du jour';", "U.innerHTML=(sv.m===0?'autarcie du jour':sv.m===1?'autarcie en ce moment':'autoconsommation du jour')+'<div style=\"font:500 10.5px Inter,sans-serif;color:#7d96b3;letter-spacing:.02em\">'+(sv.m===2?'solaire consommé sur place':'maison couverte sans le réseau')+'</div>';", 'perf : explication');
  patch("[ex2,im2].forEach(function(e){if(e&&e.parentNode)e.parentNode.style.top='346px';e.style.fontSize='26px'});", "(function(){var gr=document.createElement('div');gr.style.cssText='position:absolute;left:296px;top:80px;width:246px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:14px;row-gap:40px;z-index:2';var H={sAC:'solaire utilisé sur place'};['sAC','sEU','sCO','sFC','sEX','sIM'].forEach(function(id){var v=document.getElementById(id);if(!v)return;var l=v.previousElementSibling;var c=document.createElement('div');if(l&&l.classList.contains('sl')){if(id==='sFC')l.textContent='Prévu auj.';if(id==='sAC')l.textContent='Autoconso.';l.style.setProperty('margin','0','important');l.style.setProperty('font-size','10px','important');l.style.setProperty('letter-spacing','.07em','important');l.style.setProperty('white-space','nowrap','important');l.style.setProperty('overflow','hidden','important');l.style.setProperty('text-overflow','ellipsis','important');c.appendChild(l)}v.classList.remove('gl');v.style.setProperty('font-size','30px','important');v.style.setProperty('text-shadow','none','important');v.style.setProperty('filter','none','important');v.style.setProperty('white-space','nowrap','important');v.style.setProperty('line-height','1.15','important');c.appendChild(v);if(H[id]){var h=document.createElement('div');h.textContent=H[id];h.style.cssText='font:500 10px Inter,sans-serif;color:#7d96b3;margin-top:1px';c.appendChild(h)}gr.appendChild(c)});pf.appendChild(gr);pf.querySelectorAll(':scope > div[style*=\"left:300px\"],:scope > div[style*=\"left:26px\"],:scope > div[style*=\"left:150px\"]').forEach(function(d){if(!d.textContent.trim())d.style.display='none'})})();", 'perf : grille');
  // panneau « Cerveau de Watt » : mise en forme absente du fichier d'origine
  { const has = src.includes('#bnPanel{');   // la v3.1 de tazzdel met en forme son panneau elle-même
    const bp = has ? '' : fs.readFileSync(new URL('./brain-panel.css', import.meta.url), 'utf8').split('`').join('');
    for (let i = 0; i < html.length; i++) html[i] = html[i].replace('<style id="bnCss">', '<style id="bnCss">\n' + bp + '\nbody.bn-cine #lum .lp,body.bn-cine #lCine{display:none!important}\n'); }
  // batteries à leur réserve mini : « réserve atteinte » au lieu de « vides vers HH:MM » (Titan, Zendure : la décharge s'arrête au mini réglé)
  patch("if(f&&f.emptyBeforeSun)L.push({k:'vide',lvl:2,t:'Batteries vides avant le matin',v:'vers '+hhmm(f.empty)})", "if(f&&(f.stock<0.3||(function(){var a=(D.lvl||[]).filter(function(v){return v>=0});return a.length&&a.reduce(function(x,y){return x+y},0)/a.length<=MIN_PCT+2&&(D.p||[]).every(function(p){return !(p<-80)})})()))L.push({k:'vide',lvl:1,t:'Réserve des batteries atteinte',v:'mini '+MIN_PCT+' % · réseau en relais'});else if(f&&f.emptyBeforeSun)L.push({k:'vide',lvl:2,t:'Batteries vides avant le matin',v:'vers '+hhmm(f.empty)})", 'réserve : alerte');
  patch("else if(f&&f.emptyBeforeSun)t='⚠ Batteries vides avant le soleil : économisez';", "else if(f&&f.stock<0.3)t='🔋 Réserve atteinte (mini '+MIN_PCT+' %) : le réseau prend le relais';else if(f&&f.emptyBeforeSun)t='⚠ Batteries vides avant le soleil : économisez';", 'réserve : conseil');
  patch("let t,c;if(f.emptyBeforeSun){t='⚠ VIDES VERS '", "let t,c;if(f.stock<0.3){t='🔋 RÉSERVE ATTEINTE';c='#ffb13b'}else if(f.emptyBeforeSun){t='⚠ VIDES VERS '", 'réserve : bloc batteries');
  patch("var au='--';if(f){if(f.empty){", "var au='--';if(f){if(f.stock<0.3)au='réserve';else if(f.empty){", 'réserve : autonomie');
  patch("var du=st.kwh*1000/hs;r.push(['Autonomie des batteries',", "var du=st.kwh*1000/hs;if(st.kwh<0.3)r.push(['Autonomie des batteries','Les batteries ont atteint leur réserve (mini '+MIN_PCT+' %) : le réseau prend le relais.']);else r.push(['Autonomie des batteries',", 'réserve : astuces');
  // son bouton plein écran : remplacé par celui de la carte (⛶ déplaçable)
  patch("if(!st||document.getElementById('fsb'))return;", "return;", 'tuyaux : plein écran');
  code = code.split("vr.textContent='VERSION_TAG'").join("vr.textContent='tuyaux'").replace(/vr\.textContent='Énergie Réacteur · v\d+'/g,"vr.textContent='tuyaux'");
}

// vue « GROS » : UN n'est pas sur window → toujours 4 zones sans nom ; libellés T1… comme la vue Énergie
if (code.includes("var n=Math.min((window.UN&&UN.length)||4,4)")) {
  code = code.split("var n=Math.min((window.UN&&UN.length)||4,4)").join("var n=Math.min((typeof UN!=='undefined'&&UN.length)||4,4)");
  code = code.split("'Z'+(i+1)+((window.UN&&UN[i]&&UN[i].name)?' · '+String(UN[i].name).slice(0,14):'')").join("((typeof UN!=='undefined'&&UN[i]&&UN[i].label)||'T'+(i+1))+((typeof UN!=='undefined'&&UN[i]&&UN[i].name)?' · '+String(UN[i].name).slice(0,14):'')");
}

if (MAIN) {
  // batteries à leur réserve mini : « réserve atteinte » au lieu de « vides vers HH:MM » (Titan, Zendure : la décharge s'arrête au mini réglé)
  patch("if(f&&f.emptyBeforeSun)L.push({k:'vide',lvl:2,t:'Batteries vides avant le matin',v:'vers '+hhmm(f.empty)})", "if(f&&(f.stock<0.3||(function(){var a=(D.lvl||[]).filter(function(v){return v>=0});return a.length&&a.reduce(function(x,y){return x+y},0)/a.length<=MIN_PCT+2&&(D.p||[]).every(function(p){return !(p<-80)})})()))L.push({k:'vide',lvl:1,t:'Réserve des batteries atteinte',v:'mini '+MIN_PCT+' % · réseau en relais'});else if(f&&f.emptyBeforeSun)L.push({k:'vide',lvl:2,t:'Batteries vides avant le matin',v:'vers '+hhmm(f.empty)})", 'réserve : alerte');
  patch("else if(f&&f.emptyBeforeSun)t='⚠ Batteries vides avant le soleil : économisez';", "else if(f&&f.stock<0.3)t='🔋 Réserve atteinte (mini '+MIN_PCT+' %) : le réseau prend le relais';else if(f&&f.emptyBeforeSun)t='⚠ Batteries vides avant le soleil : économisez';", 'réserve : conseil');
  patch("let t,c;if(f.emptyBeforeSun){t='⚠ VIDES VERS '", "let t,c;if(f.stock<0.3){t='🔋 RÉSERVE ATTEINTE';c='#ffb13b'}else if(f.emptyBeforeSun){t='⚠ VIDES VERS '", 'réserve : bloc batteries');
  patch("var au='--';if(f){if(f.empty){", "var au='--';if(f){if(f.stock<0.3)au='réserve';else if(f.empty){", 'réserve : autonomie');
  patch("var du=st.kwh*1000/hs;r.push(['Autonomie des batteries',", "var du=st.kwh*1000/hs;if(st.kwh<0.3)r.push(['Autonomie des batteries','Les batteries ont atteint leur réserve (mini '+MIN_PCT+' %) : le réseau prend le relais.']);else r.push(['Autonomie des batteries',", 'réserve : astuces');
}
// libellés courts des batteries (vue Énergie) : option « label » de chaque batterie, sinon T1…T4
if (MAIN) patchAll('<div class="zt">T${i+1}</div>', '<div class="zt">${(UN[i]&&UN[i].label)||\'T\'+(i+1)}</div>', 'libellés courts');
// vue Énergie (Nouveau / Classique) : la 4ᵉ batterie ne passe plus sous la tuile « Total »
if (MAIN) code = code.replace(/const BX=\[0,1,2,3\]\.map\(i=>\{const n=Math\.max\(1,Math\.min\(4,UN\.length\)\);return Math\.round\(([^;]*?)\)\}\),fBat=\[\];/, (m, e) => `const BX=(()=>{const a=[0,1,2,3].map(i=>{const n=Math.max(1,Math.min(4,UN.length));return Math.round(${e})}),n=Math.max(1,Math.min(4,UN.length)),w=a[1]-a[0],last=a[n-1]+w-6,sh=Math.min(0,884-last);return a.map(x=>x+sh)})(),fBat=[];`);

// option « Masquer les watts » par batterie (extensions LINK sans capteur de puissance) : tous les styles
patch("const cBt=card('rxbt'", "try{const __hp=UN.map((u,i)=>u.hp?i:-1).filter(i=>i>=0);if(__hp.length){const __s=document.createElement('style');__s.textContent=__hp.map(i=>'#bw'+i+',#lbw'+i+'{visibility:hidden!important}#lZd>div:nth-child('+(i+1)+'){display:none!important}').join('');document.head.appendChild(__s);__hp.forEach(i=>{if(cZ[i]&&cZ[i].zw)cZ[i].zw.style.visibility='hidden'})}}catch(e){}\nconst cBt=card('rxbt'", 'masquer les watts');

if (SUP) { /* fonctions absentes de ce style : on ignore leurs retouches */
  const OPT = ['MODULES début', 'MODULES fin', 'ECS_TILE', 'UN/BATSET', 'PACKS', 'TARIFS', 'rappels masqués', 'tuile marque', 'libellés courts', 'masquer les watts'];
  for (let i = FAILS.length - 1; i >= 0; i--) if (OPT.some((o) => FAILS[i].indexOf('« ' + o + ' »') >= 0)) FAILS.splice(i, 1);
}
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
function buildClassic(SRC, OUT, key = 'classic', label = 'Classique (v2)', profile = 'main') {
  const t = transform(SRC, profile);
  const out = t.header + `
/* Style « ${label} » de la carte energie-card ${VERSION}.
   Chargé automatiquement par energie-card.js quand ce style est choisi :
   NE PAS l'ajouter comme ressource. */
(window.__ENERGIE_CARD_DASH = window.__ENERGIE_CARD_DASH || {})[${J(key)}] = ` + t.dash + ';\n';
  fs.writeFileSync(OUT, out);
  console.log(`OK : ${t.info} → ${String(OUT).split("/").slice(-2).join("/")} (${(out.length / 1024).toFixed(0)} Ko)`);
}

const [, , SRC, OUT] = process.argv;
try {
  if (SRC) buildMain(SRC, OUT);
  else {
    buildMain(new URL('../src/energie.html', import.meta.url), new URL('../dist/energie-card.js', import.meta.url));
    buildClassic(new URL('../src/energie-classic.html', import.meta.url), new URL('../dist/energie-card-classic.js', import.meta.url));
    buildClassic(new URL('../src/energie-tuyaux.html', import.meta.url), new URL('../dist/energie-card-tuyaux.js', import.meta.url), 'tuyaux', 'Tuyaux (salle de tazzdel)', 'tuyaux');
    buildClassic(new URL('../src/energie-supervision.html', import.meta.url), new URL('../dist/energie-card-supervision.js', import.meta.url), 'supervision', 'Supervision', 'sup');
  }
} catch (e) { console.error(e.message); process.exit(1); }
