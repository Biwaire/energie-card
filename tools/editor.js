/* ════════ éditeur visuel (Paramètres de la carte dans Home Assistant) ════════ */
const ENT = (domain, extra) => ({ entity: Object.assign({ domain }, extra || {}) });
const SENSOR = ENT('sensor');
const LABELS = {
  fit_screen: 'Adapter à la hauteur de l’écran',
  aspect_ratio: 'Proportions (ex. 16/9 ou 56%)', height: 'Hauteur fixe (ex. calc(100vh - 56px))',
  pv: 'Puissance solaire (W)', grid: 'Puissance réseau (W, + = soutirage)', ev: 'Puissance borne voiture (W)',
  evSoc: 'Niveau batterie voiture (%)', evRange: 'Autonomie voiture (km)', evLid: 'Trappe de charge',
  ecs: 'Puissance ballon ECS (W)', ecsTotal: 'Énergie ballon ECS (kWh)',
  weather: 'Météo', house_temp: 'Température de la maison',
  today: 'Prévision Solcast aujourd’hui', tomorrow: 'Prévision Solcast demain',
  haute: 'Sonde haute', basse: 'Sonde basse', grande: 'Grande chauffe', desinf: 'Dernière désinfection',
  name: 'Nom affiché', level: 'Niveau (%)', power: 'Puissance charge/décharge (W)', temperature: 'Température',
  min: 'Réglage du mini (number.*)', max: 'Réglage du maxi (number.*)', invert: 'Charge/décharge inversée',
  portail: 'Portail', garage: 'Porte de garage', volets: 'Volets', chauffage: 'Chauffage', scenarios: 'Scénarios',
  voiture: 'Voiture électrique', ballon: 'Ballon d’eau chaude', rappels: 'Rappels 🔔', chauffeeau: 'Tuile chauffe-eau', watt: 'Assistant Watt 👷',
  tarif_hp: 'Prix heures pleines (€/kWh)', tarif_hc: 'Prix heures creuses (€/kWh)', hc_text: 'Heures creuses',
  pv_max: 'Puissance crête des panneaux (W)', kwh_pack: 'Capacité d’un pack (kWh)', packs_text: 'Packs par batterie',
  invert_grid: 'Réseau inversé', invert_bat: 'Toutes les batteries inversées', ev_kwh: 'Capacité utile voiture (kWh)',
  ev_target: 'Charge visée voiture (%)', co2_kg_kwh: 'CO₂ du réseau (kg/kWh)', agent: 'Assistant de conversation pour Watt',
};
const HELPERS = {
  hc_text: 'Une ou plusieurs plages, ex. 22:00-06:00 ou 01:04-06:34, 14:34-17:04',
  packs_text: 'Dans l’ordre des batteries, ex. 1, 2',
  fit_screen: 'La carte entière reste visible sans défiler',
  agent: 'Vide = assistant par défaut de Home Assistant',
  level: 'Laissez toutes les batteries vides pour la détection automatique',
};
const bat = i => ({ type: 'expandable', name: 'bat' + i, title: 'Batterie ' + i, icon: 'mdi:battery-high', schema: [
  { name: 'name', selector: { text: {} } }, { name: 'level', selector: SENSOR }, { name: 'power', selector: SENSOR },
  { name: 'temperature', selector: SENSOR },
  { type: 'grid', name: '', schema: [{ name: 'min', selector: ENT('number') }, { name: 'max', selector: ENT('number') }] },
  { name: 'invert', selector: { boolean: {} } }] });
const NUM = (step, unit) => ({ number: { mode: 'box', step, unit_of_measurement: unit } });
const SCHEMA = [
  { type: 'expandable', name: 'entities', title: 'Capteurs principaux', icon: 'mdi:solar-power', schema: [
    { name: 'pv', selector: SENSOR }, { name: 'grid', selector: SENSOR }, { name: 'ev', selector: SENSOR },
    { name: 'evSoc', selector: SENSOR }, { name: 'evRange', selector: SENSOR }, { name: 'evLid', selector: { entity: {} } },
    { name: 'ecs', selector: SENSOR }, { name: 'ecsTotal', selector: SENSOR }] },
  { type: 'expandable', name: '', flatten: true, title: 'Météo, température, prévisions', icon: 'mdi:weather-partly-cloudy', schema: [
    { name: 'weather', selector: ENT('weather') }, { name: 'house_temp', selector: SENSOR },
    { type: 'expandable', name: 'solcast', title: 'Solcast', schema: [{ name: 'today', selector: SENSOR }, { name: 'tomorrow', selector: SENSOR }] }] },
  { type: 'expandable', name: '', flatten: true, title: 'Batteries (4 maximum)', icon: 'mdi:home-battery', schema: [
    bat(1), bat(2), bat(3), bat(4),
    { type: 'grid', name: '', schema: [{ name: 'packs_text', selector: { text: {} } }, { name: 'kwh_pack', selector: NUM(0.01, 'kWh') }] },
    { name: 'invert_bat', selector: { boolean: {} } }] },
  { type: 'expandable', name: 'modules', title: 'Éléments affichés', icon: 'mdi:view-dashboard-edit', schema: [
    { type: 'grid', name: '', schema: ['voiture', 'ballon', 'chauffeeau', 'chauffage', 'scenarios', 'volets', 'portail', 'garage', 'rappels', 'watt']
      .map(n => ({ name: n, selector: { boolean: {} } })) }] },
  { type: 'expandable', name: '', flatten: true, title: 'Tarifs et heures creuses', icon: 'mdi:currency-eur', schema: [
    { type: 'grid', name: '', schema: [{ name: 'tarif_hp', selector: NUM(0.0001, '€/kWh') }, { name: 'tarif_hc', selector: NUM(0.0001, '€/kWh') }] },
    { name: 'hc_text', selector: { text: {} } }] },
  { type: 'expandable', name: 'ecs_tile', title: 'Tuile chauffe-eau', icon: 'mdi:water-boiler', schema: [
    { name: 'haute', selector: SENSOR }, { name: 'basse', selector: SENSOR }, { name: 'grande', selector: { entity: {} } }, { name: 'desinf', selector: { entity: {} } }] },
  { type: 'expandable', name: '', flatten: true, title: 'Avancé', icon: 'mdi:tune', schema: [
    { type: 'grid', name: '', schema: [
      { name: 'pv_max', selector: NUM(100, 'W') }, { name: 'co2_kg_kwh', selector: NUM(0.001, 'kg') },
      { name: 'ev_kwh', selector: NUM(1, 'kWh') }, { name: 'ev_target', selector: NUM(5, '%') }] },
    { name: 'invert_grid', selector: { boolean: {} } },
    { name: 'fit_screen', selector: { boolean: {} } },
    { name: 'agent', selector: { conversation_agent: {} } },
    { type: 'grid', name: '', schema: [{ name: 'aspect_ratio', selector: { text: {} } }, { name: 'height', selector: { text: {} } }] }] },
];
const MOD_DEFAULTS = { portail: false, garage: false, volets: false, chauffage: true, scenarios: true, voiture: true, ballon: true, rappels: false, chauffeeau: true, watt: true };

/* config ⇄ données du formulaire */
function toForm(c) {
  const d = Object.assign({}, c);
  d.fit_screen = c.fit_screen !== false;
  d.modules = Object.assign({}, MOD_DEFAULTS, c.modules || {});
  (c.batteries || []).slice(0, 4).forEach((b, i) => { d['bat' + (i + 1)] = Object.assign({}, b); });
  delete d.batteries;
  if (Array.isArray(c.hc_plages)) d.hc_text = c.hc_plages.map(p => p[0] + '-' + p[1]).join(', ');
  if (Array.isArray(c.packs)) d.packs_text = c.packs.join(', ');
  delete d.hc_plages; delete d.packs;
  return d;
}
const empty = v => v === undefined || v === null || v === '' || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
function clean(o) {
  if (Array.isArray(o)) return o;
  if (!o || typeof o !== 'object') return o;
  const r = {};
  Object.keys(o).forEach(k => { const v = clean(o[k]); if (!empty(v)) r[k] = v; });
  return r;
}
function fromForm(d, type) {
  const c = { type };
  const bats = [];
  Object.keys(d).forEach(k => {
    if (/^bat[1-4]$/.test(k)) { const b = clean(d[k]); if (!empty(b)) bats[+k.slice(3) - 1] = b; return; }
    if (k === 'hc_text') {
      const p = String(d[k] || '').split(/[,;]/).map(x => x.trim().match(/^(\d{1,2}[:h]\d{2})\s*[-–à]+\s*(\d{1,2}[:h]\d{2})$/)).filter(Boolean)
        .map(m => [m[1].replace('h', ':').padStart(5, '0'), m[2].replace('h', ':').padStart(5, '0')]);
      if (p.length) c.hc_plages = p;
      return;
    }
    if (k === 'packs_text') { const p = String(d[k] || '').split(/[,; ]+/).map(Number).filter(n => n > 0); if (p.length) c.packs = p; return; }
    if (k === 'modules') {
      const m = {}; Object.keys(d.modules || {}).forEach(n => { if (d.modules[n] !== MOD_DEFAULTS[n]) m[n] = !!d.modules[n]; });
      if (Object.keys(m).length) c.modules = m;
      return;
    }
    if (k === 'fit_screen') { if (d[k] === false) c.fit_screen = false; return; }
    if (k !== 'type') c[k] = d[k];
  });
  const list = bats.filter(Boolean);
  if (list.length) c.batteries = list;
  return clean(c);
}

class EnergieCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    // garder le texte en cours de saisie (ex. « 22:0 ») si la config correspond déjà au formulaire
    if (this._data && JSON.stringify(fromForm(this._data, this._config.type)) !== JSON.stringify(clean(this._config))) this._data = null;
    this._render();
  }
  set hass(h) { this._hass = h; if (this._form) this._form.hass = h; else this._render(); }
  async _ensureForm() {
    if (customElements.get('ha-form') && customElements.get('ha-entity-picker')) return;
    // charge les composants de formulaire de Home Assistant (sélecteurs d'entités)
    try { const h = await window.loadCardHelpers(); const c = await h.createCardElement({ type: 'entities', entities: [] }); if (c && c.constructor.getConfigElement) await c.constructor.getConfigElement(); } catch (e) {}
    await customElements.whenDefined('ha-form');
  }
  async _render() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      await this._ensureForm();
      if (this._form) return;
      const intro = document.createElement('div');
      intro.style.cssText = 'padding:4px 0 12px;color:var(--secondary-text-color);font-size:14px;line-height:1.4';
      intro.textContent = 'Les champs laissés vides sont détectés automatiquement (solaire, réseau, batteries Izypower, Solcast, météo…). Renseignez seulement ce qui est mal détecté.';
      this.appendChild(intro);
      this._form = document.createElement('ha-form');
      this._form.schema = SCHEMA;
      this._form.computeLabel = s => LABELS[s.name] || s.title || s.name;
      this._form.computeHelper = s => HELPERS[s.name] || '';
      this._form.addEventListener('value-changed', e => {
        e.stopPropagation();
        this._data = e.detail.value;
        const cfg = fromForm(this._data, this._config.type || 'custom:' + TAG);
        this._config = cfg;
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: cfg }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._data || toForm(this._config);
  }
}
customElements.define(TAG + '-editor', EnergieCardEditor);
EnergieCardEditor.toForm = toForm; EnergieCardEditor.fromForm = fromForm;
