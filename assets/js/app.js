import { searchPlaces, reversePlace, getRoutes, getForecasts, getAlerts } from './api.js';
import { sampleRoute, evaluate, scan, band, CAT_VAR, BREAKS, withBreaks } from './model.js';
import { weatherIcon, icon } from './icons.js';
import { drawPoster } from './poster.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
// ---------- Optional analytics (GoatCounter: no cookies, no personal data) ----------
const GC_CODE = document.querySelector('meta[name="wtt-goatcounter"]')?.content.trim();
if (GC_CODE && /^[a-z0-9-]+$/i.test(GC_CODE)) {
  const sc = document.createElement('script');
  sc.async = true;
  sc.src = 'https://gc.zgo.at/count.js';
  sc.dataset.goatcounter = `https://${GC_CODE}.goatcounter.com/count`;
  document.head.appendChild(sc);
}
/** Count a product event (no-op unless analytics is configured). */
function track(name) {
  try { window.goatcounter?.count?.({ path: `event/${name}`, title: name, event: true }); } catch { /* ignore */ }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ===================================================================
// Units & formatting
// ===================================================================
const defaultUnits = /^(en-US|en-LR|my)/.test(navigator.language || 'en-US') ? 'imperial' : 'metric';
let units = store.get('wtt-units', defaultUnits);

const fmt = {
  temp: c => (c == null ? '—' : `${Math.round(units === 'imperial' ? c * 9 / 5 + 32 : c)}°`),
  tempDelta: c => Math.round(units === 'imperial' ? c * 9 / 5 : c),
  speed: k => (k == null ? '—' : units === 'imperial' ? `${Math.round(k * 0.621371)} mph` : `${Math.round(k)} km/h`),
  dist: m => {
    const v = units === 'imperial' ? m / 1609.344 : m / 1000;
    return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} ${units === 'imperial' ? 'mi' : 'km'}`;
  },
  distShort: m => `${Math.round(units === 'imperial' ? m / 1609.344 : m / 1000)}`,
  distUnit: () => (units === 'imperial' ? 'mi' : 'km'),
  duration: s => {
    const m = Math.round(s / 60);
    const h = Math.floor(m / 60);
    return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
  },
  time: ts => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ts * 1000),
  hour: ts => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(ts * 1000),
  day: ts => {
    const d = new Date(ts * 1000), now = new Date();
    const diff = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d);
  },
  dayTime: ts => `${fmt.day(ts)} ${fmt.time(ts)}`,
  dayHour: ts => `${fmt.day(ts)} ${fmt.hour(ts)}`,
};
const splitTime = ts => {
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(ts * 1000);
  const main = parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim();
  const period = parts.find(p => p.type === 'dayPeriod')?.value || '';
  return { main, period };
};

// ===================================================================
// Theme, units toggles
// ===================================================================
const root = document.documentElement;
const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;

$('#themeToggle').addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('wtt-theme', root.dataset.theme); } catch { /* ignore */ }
  map.setTiles();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => map.setTiles());

function syncUnitButtons() {
  $$('.seg-btn[data-units]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.units === units)));
}
$$('.seg-btn[data-units]').forEach(b => b.addEventListener('click', () => {
  units = b.dataset.units;
  store.set('wtt-units', units);
  syncUnitButtons();
  if (trip) render({ animate: false });
}));
syncUnitButtons();

// ===================================================================
// Toast
// ===================================================================
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ===================================================================
// Place combobox
// ===================================================================
class Combo {
  constructor(input, list) {
    this.input = input;
    this.list = list;
    this.place = null;
    this.items = [];
    this.active = -1;
    this.timer = null;
    this.ctrl = null;
    input.addEventListener('input', () => this.onInput());
    input.addEventListener('keydown', e => this.onKey(e));
    input.addEventListener('focus', () => { if (this.items.length && !this.place) this.open(); });
    input.addEventListener('blur', () => setTimeout(() => this.close(), 150));
    list.addEventListener('mousedown', e => e.preventDefault());
    list.addEventListener('click', e => {
      const li = e.target.closest('[role="option"]');
      if (li) this.pick(Number(li.dataset.i));
    });
  }
  set(place) {
    this.place = place;
    this.input.value = place ? place.name + (place.detail ? `, ${place.detail}` : '') : '';
    this.input.closest('.field').classList.toggle('has-place', !!place);
    this.close();
  }
  onInput() {
    this.place = null;
    this.input.closest('.field').classList.remove('has-place');
    clearError();
    clearTimeout(this.timer);
    const q = this.input.value.trim();
    if (q.length < 2) { this.items = []; this.close(); return; }
    this.timer = setTimeout(() => this.search(q), 220);
  }
  async search(q) {
    this.ctrl?.abort();
    this.ctrl = new AbortController();
    this.list.innerHTML = `<li class="suggest-state">${icon('spark', 'spin')}Searching…</li>`;
    this.open();
    try {
      const other = this === combos.from ? combos.to.place : combos.from.place;
      this.items = await searchPlaces(q, { signal: this.ctrl.signal, near: other });
      this.active = this.items.length ? 0 : -1;
      this.renderList();
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.list.innerHTML = '<li class="suggest-state">Search is unavailable right now.</li>';
    }
  }
  renderList() {
    if (!this.items.length) {
      this.list.innerHTML = '<li class="suggest-state">No matches. Try a city name.</li>';
      return;
    }
    const id = this.list.id;
    this.list.innerHTML = this.items.map((p, i) => `
      <li role="option" id="${id}-${i}" data-i="${i}" aria-selected="${i === this.active}">
        ${icon(this === combos.from ? 'pin' : 'flag')}
        <span><strong>${esc(p.name)}</strong>${p.detail ? `<small>${esc(p.detail)}</small>` : ''}</span>
      </li>`).join('');
    this.input.setAttribute('aria-activedescendant', this.active >= 0 ? `${id}-${this.active}` : '');
    this.open();
  }
  onKey(e) {
    const openNow = this.list.classList.contains('open') && this.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!openNow) return;
      e.preventDefault();
      const n = this.items.length;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.renderList();
    } else if (e.key === 'Enter' && openNow && this.active >= 0 && !this.place) {
      e.preventDefault();
      this.pick(this.active);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }
  pick(i) {
    const p = this.items[i];
    if (!p) return;
    this.set(p);
    if (this === combos.from && !combos.to.place) combos.to.input.focus();
  }
  open() { this.list.classList.add('open'); this.input.setAttribute('aria-expanded', 'true'); }
  close() { this.list.classList.remove('open'); this.input.setAttribute('aria-expanded', 'false'); }
  /** Resolve the typed text to a place if the user never picked one. */
  async resolve() {
    if (this.place) return this.place;
    const q = this.input.value.trim();
    if (!q) return null;
    const res = await searchPlaces(q);
    if (!res.length) throw Object.assign(new Error(`We couldn't find "${q}". Try a nearby city.`), { kind: 'input' });
    this.set(res[0]);
    return res[0];
  }
}

const combos = {};
combos.from = new Combo($('#fromInput'), $('#fromList'));
combos.to = new Combo($('#toInput'), $('#toList'));

$('#swapBtn').addEventListener('click', e => {
  const a = combos.from.place, b = combos.to.place;
  const at = combos.from.input.value, bt = combos.to.input.value;
  if (b) combos.from.set(b); else { combos.from.set(null); combos.from.input.value = bt; }
  if (a) combos.to.set(a); else { combos.to.set(null); combos.to.input.value = at; }
  e.currentTarget.classList.remove('spun');
  void e.currentTarget.offsetWidth;
  e.currentTarget.classList.add('spun');
});

$('#locateBtn').addEventListener('click', () => {
  const btn = $('#locateBtn');
  if (!navigator.geolocation) { toast('Location isn\'t available in this browser.'); return; }
  btn.classList.add('busy');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const named = await reversePlace(lat, lon).catch(() => null);
    combos.from.set({ name: named?.name || 'My location', detail: named?.detail || '', lat, lon });
    btn.classList.remove('busy');
    if (!combos.to.place) combos.to.input.focus();
  }, () => {
    btn.classList.remove('busy');
    toast('Couldn\'t get your location — type a place instead.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
});

// ===================================================================
// Departure time
// ===================================================================
const departInput = $('#departInput');
const pad = n => String(n).padStart(2, '0');
const toLocalInput = ts => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = v => Math.floor(new Date(v).getTime() / 1000);
const nowRounded = () => { const t = Math.floor(Date.now() / 1000); return t - (t % 900) + 900; };

function setDepart(ts) {
  departInput.value = toLocalInput(ts);
  $$('.quick .chip').forEach(c => c.classList.remove('on'));
}
function refreshDepartBounds() {
  const now = Math.floor(Date.now() / 1000);
  departInput.min = toLocalInput(now - (now % 3600));
  departInput.max = toLocalInput(now + 7 * 86400);
}
refreshDepartBounds();
setDepart(nowRounded());
$('.chip[data-quick="now"]').classList.add('on');

$$('.quick .chip').forEach(chip => chip.addEventListener('click', () => {
  let ts;
  if (chip.dataset.quick === 'now') ts = nowRounded();
  else if (chip.dataset.quick === '1h') ts = nowRounded() + 3600;
  else { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); ts = d.getTime() / 1000; }
  setDepart(ts);
  chip.classList.add('on');
}));
departInput.addEventListener('input', () => $$('.quick .chip').forEach(c => c.classList.remove('on')));

// ===================================================================
// Samples & recents
// ===================================================================
const SAMPLES = [
  { label: 'San Jose → San Francisco', from: { name: 'San Jose', detail: 'CA', lat: 37.3382, lon: -121.8863 }, to: { name: 'San Francisco', detail: 'CA', lat: 37.7793, lon: -122.4193 } },
  { label: 'Denver → Moab', from: { name: 'Denver', detail: 'CO', lat: 39.7392, lon: -104.9903 }, to: { name: 'Moab', detail: 'UT', lat: 38.5733, lon: -109.5498 } },
  { label: 'Seattle → Portland', from: { name: 'Seattle', detail: 'WA', lat: 47.6062, lon: -122.3321 }, to: { name: 'Portland', detail: 'OR', lat: 45.5152, lon: -122.6784 } },
  { label: 'Apple Park → Disneyland', from: { name: 'Apple Park', detail: 'Cupertino, CA', lat: 37.3349, lon: -122.009 }, to: { name: 'Disneyland', detail: 'Anaheim, CA', lat: 33.8121, lon: -117.919 } },
];

function renderSamples() {
  const recents = store.get('wtt-recent', []).slice(0, 3);
  const chips = [
    ...recents.map((r, i) => `<button type="button" class="chip chip-recent" data-recent="${i}" title="Recent trip">${icon('history')}${esc(r.from.name)} → ${esc(r.to.name)}</button>`),
    ...SAMPLES.filter(s => !recents.some(r => r.from.name === s.from.name && r.to.name === s.to.name))
      .map((s) => `<button type="button" class="chip" data-sample="${SAMPLES.indexOf(s)}">${esc(s.label)}</button>`),
  ];
  $('#samplesList').innerHTML = chips.slice(0, 5).join('');
}
$('#samplesList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const t = b.dataset.recent != null ? store.get('wtt-recent', [])[b.dataset.recent] : SAMPLES[b.dataset.sample];
  if (!t) return;
  combos.from.set(t.from);
  combos.to.set(t.to);
  $('#planner').requestSubmit();
});
function rememberTrip(from, to) {
  const list = store.get('wtt-recent', []).filter(r => !(r.from.name === from.name && r.to.name === to.name));
  list.unshift({ from, to });
  store.set('wtt-recent', list.slice(0, 5));
  renderSamples();
}
renderSamples();

// ===================================================================
// Form submit → plan
// ===================================================================
const formError = $('#formError');
function showError(msg) { formError.textContent = msg; formError.hidden = false; }
function clearError() { formError.hidden = true; }

$('#planner').addEventListener('submit', async e => {
  e.preventDefault();
  clearError();
  const btn = $('#submitBtn');
  btn.classList.add('busy');
  try {
    const [from, to] = await Promise.all([combos.from.resolve(), combos.to.resolve()]);
    if (!from || !to) {
      showError(!from ? 'Where are you starting from?' : 'Where are you headed?');
      (!from ? combos.from : combos.to).input.focus();
      return;
    }
    if (Math.abs(from.lat - to.lat) + Math.abs(from.lon - to.lon) < 0.005) {
      showError('Start and destination are the same place.');
      return;
    }
    let depart = fromLocalInput(departInput.value);
    if (!Number.isFinite(depart)) depart = nowRounded();
    const now = Date.now() / 1000;
    if (depart < now - 3600) { depart = nowRounded(); setDepart(depart); toast('Departure was in the past — using now.'); }
    if (depart > now + 7 * 86400) { showError('Forecasts reach about a week out. Pick a departure within 7 days.'); return; }
    plan(from, to, depart);
  } catch (err) {
    showError(err.kind === 'input' ? err.message : 'Place search is unavailable right now. Please try again.');
  } finally {
    btn.classList.remove('busy');
  }
});

// ===================================================================
// Planning pipeline
// ===================================================================
let trip = null;       // { from, to, options: [{ route, points, forecasts, alerts, names }], active, depart, breaks }
let runCtrl = null;

const els = {
  results: $('#results'), loading: $('#loading'), error: $('#errorCard'), trip: $('#trip'),
};

function setPhase(phase) {
  els.loading.hidden = phase !== 'loading';
  els.error.hidden = phase !== 'error';
  els.trip.hidden = phase !== 'trip';
  els.results.dataset.phase = phase;
}
function setStep(step) {
  const order = ['route', 'sky', 'names'];
  const at = order.indexOf(step);
  $$('#loadingSteps li').forEach((li, i) => {
    li.classList.toggle('done', i < at);
    li.classList.toggle('active', i === at);
  });
}

let breaksPref = store.get('wtt-breaks', 'off');
if (!BREAKS[breaksPref]) breaksPref = 'off';

let lastPlan = null;

function showPlanError(title, text) {
  $('#errorTitle').textContent = title;
  $('#errorText').textContent = text;
  setPhase('error');
}

async function plan(from, to, depart, { route = 0, breaks = breaksPref } = {}) {
  runCtrl?.abort();
  const ctrl = new AbortController();
  runCtrl = ctrl;
  const { signal } = ctrl;
  lastPlan = [from, to, depart, { route, breaks }];
  // Safety net: never leave the spinner up indefinitely.
  const watchdog = setTimeout(() => {
    if (runCtrl === ctrl && els.results.dataset.phase === 'loading') {
      ctrl.abort();
      showPlanError('This is taking too long', 'The weather or routing service is slow right now. Please try again.');
    }
  }, 45000);

  els.results.hidden = false;
  setPhase('loading');
  setStep('route');
  map.ensure();
  map.clear();
  map.preview(from, to);
  requestAnimationFrame(() => els.results.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }));

  try {
    const routes = await getRoutes(from, to, { signal });
    const options = routes.map(r => ({ route: r, points: sampleRoute(r), names: null, alerts: [] }));

    // One forecast request covers every checkpoint on every route.
    setStep('sky');
    const all = options.flatMap(o => o.points);
    const fcs = await getForecasts(all, { signal });
    let k = 0;
    options.forEach(o => { o.forecasts = fcs.slice(k, k + o.points.length); k += o.points.length; });

    // Town names for the chosen route + official alerts for all routes, in parallel.
    setStep('names');
    const active = Math.min(Math.max(0, route | 0), options.length - 1);
    const [names] = await Promise.all([
      nameStops(options[active].points, from, to, signal),
      fetchAlerts(options, signal),
    ]);
    options[active].names = names;
    if (signal.aborted) return;

    trip = { from, to, options, active, depart, breaks: BREAKS[breaks] ? breaks : 'off' };
    track('plan');
    rememberTrip(from, to);
    writeURL();
    setPhase('trip');
    render({ animate: true, fresh: true });
    setTimeout(() => {
      const top = els.results.getBoundingClientRect().top;
      if (Math.abs(top - topbar.offsetHeight) > 12) {
        window.scrollTo({ top: scrollY + top - topbar.offsetHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    }, 450);
  } catch (err) {
    if (signal.aborted) return; // replaced by a newer plan (or the watchdog already reported)
    if (err.kind !== 'noroute' && navigator.onLine) console.error(err);
    const offline = !navigator.onLine;
    showPlanError(
      err.kind === 'noroute' ? 'No road between those two' : offline ? 'You\'re offline' : 'Something went sideways',
      offline
        ? 'This trip hasn\'t been saved on this device yet. Trips you\'ve already opened work without a signal.'
        : (err.message || 'Please try again.'),
    );
  } finally {
    clearTimeout(watchdog);
  }
}

/** Run async jobs with limited concurrency, giving up (keeping partial results) after `ms`. */
async function pool(jobs, size, ms) {
  const queue = [...jobs];
  const worker = async () => { while (queue.length) await queue.shift()(); };
  await Promise.race([
    Promise.all(Array.from({ length: size }, worker)),
    new Promise(r => setTimeout(r, ms)),
  ]);
}

async function nameStops(points, from, to, signal) {
  const names = new Array(points.length).fill(null);
  names[0] = from;
  names[points.length - 1] = to;
  await pool(points.slice(1, -1).map((p, j) => async () => {
    names[j + 1] = await reversePlace(p.lat, p.lon, { signal }).catch(() => null);
  }), 4, 9000);
  return names;
}

/** NWS alerts for every checkpoint (deduplicated by ~10 km grid cell). */
async function fetchAlerts(options, signal) {
  const cells = new Map();
  options.forEach(o => {
    o.alerts = o.points.map(() => []);
    o.points.forEach((p, i) => {
      const key = `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;
      if (!cells.has(key)) cells.set(key, { p, hits: [] });
      cells.get(key).hits.push([o, i]);
    });
  });
  await pool([...cells.values()].map(cell => async () => {
    const list = await getAlerts(cell.p.lat, cell.p.lon, { signal }).catch(() => []);
    cell.hits.forEach(([o, i]) => { o.alerts[i] = list; });
  }), 5, 10000);
}

/** Everything the UI needs for one route option at the current departure + breaks. */
function view(i = trip.active) {
  const o = trip.options[i];
  const b = withBreaks(o.points, o.route.duration, BREAKS[trip.breaks]);
  const evald = evaluate(b.points, o.forecasts, trip.depart, o.alerts);
  return { o, ...b, evald };
}

async function switchRoute(i) {
  if (!trip || i === trip.active || !trip.options[i]) return;
  const o = trip.options[i];
  if (!o.names) {
    $(`#routeCards [data-i="${i}"]`)?.classList.add('busy');
    o.names = await nameStops(o.points, trip.from, trip.to);
  }
  trip.active = i;
  track('switch-route');
  writeURL();
  render({ animate: true, fresh: true });
}

function setBreaks(key) {
  if (!BREAKS[key] || !trip) return;
  trip.breaks = breaksPref = key;
  track(`breaks-${key}`);
  store.set('wtt-breaks', key);
  writeURL();
  render({ animate: false });
}

// ===================================================================
// Rendering
// ===================================================================
function render({ animate = false, fresh = false } = {}) {
  const { from, to, depart } = trip;
  const v = view();
  const { o, evald } = v;
  const stops = evald.stops.map((s, k) => ({ ...s, place: o.names?.[k] }));
  const nowHour = Math.floor(Date.now() / 3600000) * 3600;
  const options = scan(v.points, o.forecasts, nowHour, 72, v.duration, o.alerts);
  const best = options.reduce((a, b) => (b.score != null && (a == null || b.score > a.score) ? b : a), null);

  // Header + stats
  $('#tripFrom').textContent = from.name;
  $('#tripTo').textContent = to.name;
  const [dv, du] = fmt.dist(o.route.distance).split(' ');
  $('#statDist').innerHTML = `${dv}<small>${du === 'mi' ? 'miles' : 'kilometres'}</small>`;
  const mins = Math.round(v.duration / 60);
  const nb = v.breaks.length;
  $('#statTime').innerHTML = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}<small>${nb ? `incl. ${nb} break${nb > 1 ? 's' : ''}` : 'hrs : min'}</small>`;
  $('#statLeave').innerHTML = `${esc(fmt.time(depart))}<small>${esc(fmt.day(depart))}</small>`;
  $('#statArrive').innerHTML = `${esc(fmt.time(depart + v.duration))}<small>${esc(fmt.day(depart + v.duration))}</small>`;
  $$('#breaksSeg .seg-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.breaks === trip.breaks)));

  const alts = renderRoutes();
  renderVerdict(evald, stops, best, animate, alts);
  renderOptimizer(options, best, depart);
  renderAdvice(stops, evald, sunEvents(stops, o.forecasts));
  renderTimeline(stops, animate, v.breaks, o.route, sunEvents(stops, o.forecasts));
  renderStrip(stops);
  updateHero(stops);
  lastRender = { stops, evald, v };
  map.drawTrip(o.route, stops, {
    animate: fresh,
    alts: trip.options.map((x, i) => ({ i, coords: x.route.coords })).filter(x => x.i !== trip.active),
  });
}

let lastRender = null;

/** Mobile: a swipeable strip of stop cards (CSS hides it on wide screens). */
function renderStrip(stops) {
  $('#strip').innerHTML = stops.map((s, k) => `
    <button type="button" class="strip-card" data-k="${k}" style="--c:var(${s.c ? CAT_VAR[s.c.cat] : '--ink-3'})">
      <span class="sc-time">${esc(fmt.time(s.eta))}</span>
      <span class="sc-icon">${s.c ? weatherIcon(s.c.cat, s.c.isDay, { size: 40 }) : ''}</span>
      <span class="sc-temp">${s.c ? fmt.temp(s.c.temp) : '—'}</span>
      <span class="sc-name">${esc(placeLabel(s))}</span>
      <span class="sc-cond">${s.c ? esc(s.c.text) : ''}</span>
    </button>`).join('');
}

/** The hero drawing redraws its three skies (start / middle / end of the drive) from the real forecast. */
const HERO_KIND = c => ({
  clear: c.isDay ? 'sun' : 'moon', partly: c.isDay ? 'sun' : 'moon', cloudy: 'cloud', fog: 'fog',
  drizzle: 'rain', rain: 'rain', freezing: 'snow', snow: 'snow', storm: 'storm',
}[c.cat] || 'cloud');

function updateHero(stops) {
  const svg = $('#sceneSvg');
  const known = stops.filter(s => s.c);
  if (!svg || known.length < 2) return;
  const D = known[known.length - 1].d || 1;
  const thirds = [[], [], []];
  known.forEach(s => thirds[Math.max(0, Math.min(2, Math.floor((s.d / D) * 3 - 1e-9)))].push(s));
  // A third with no checkpoint borrows its neighbour's.
  for (let i = 0; i < 3; i++) if (!thirds[i].length) thirds[i] = thirds[i - 1]?.length ? thirds[i - 1] : thirds[i + 1] || known;
  // Each zone shows its roughest stop (or, if all calm, its middle stop).
  const reps = thirds.map(list => {
    const worst = list.reduce((a, b) => (b.h > a.h ? b : a));
    return worst.h >= 0.15 ? worst : list[Math.floor(list.length / 2)];
  });
  ['a', 'b', 'c'].forEach((zone, i) => {
    const kind = HERO_KIND(reps[i].c);
    svg.querySelectorAll(`.wx-v[data-zone="${zone}"]`).forEach(g => g.classList.toggle('on', g.dataset.kind === kind));
  });
  const shortName = s => { const n = placeLabel(s); return n.length > 13 ? `${n.slice(0, 12)}…` : n; };
  svg.querySelectorAll('.tag').forEach((g, i) => {
    const s = reps[i];
    const text = g.querySelector('text'), rect = g.querySelector('rect');
    const what = s.h >= 0.3 && s.why ? s.why : fmt.temp(s.c.temp);
    text.textContent = `${fmt.time(s.eta)} · ${shortName(s)} · ${what}`;
    const w = Math.max(88, text.getComputedTextLength() + 30);
    const cx = Number(text.getAttribute('x'));
    rect.setAttribute('width', w.toFixed(0));
    rect.setAttribute('x', (cx - w / 2).toFixed(1));
    g.classList.toggle('tag-warn', s.h >= 0.3);
  });
  const cap = $('#sceneCap');
  cap.textContent = `Your drive: ${trip.from.name} → ${trip.to.name} · ${fmt.dayTime(trip.depart)}`;
  cap.hidden = false;
  svg.setAttribute('aria-label', `Your drive from ${trip.from.name} to ${trip.to.name}: ` +
    reps.map(s => `${s.c.text.toLowerCase()} near ${placeLabel(s)}`).join(', then ') + '.');
}

function renderRoutes() {
  const block = $('#routesBlock');
  if (trip.options.length < 2) { block.hidden = true; return []; }
  block.hidden = false;
  const rows = trip.options.map((o, i) => {
    const v = view(i);
    return { i, o, score: v.evald.score, dur: v.duration };
  });
  const fastest = rows.reduce((a, b) => (b.dur < a.dur ? b : a)).i;
  const top = rows.reduce((a, b) => ((b.score ?? -1) > (a.score ?? -1) ? b : a)).i;
  $('#routeCards').innerHTML = rows.map(r => {
    const extra = Math.round((r.dur - rows[fastest].dur) / 60);
    const tags = (r.i === fastest ? '<em>Fastest</em>' : `<em class="muted">+${extra} min</em>`) +
      (r.i === top && top !== fastest ? '<em class="good">Best weather</em>' : '');
    return `
    <button type="button" class="route-card ${r.i === trip.active ? 'on' : ''}" data-i="${r.i}" aria-pressed="${r.i === trip.active}" data-band="${band(r.score)}">
      <span class="rc-top">
        <span class="rc-label">${esc(r.o.route.label)}</span>
        <span class="rc-score" title="Road score">${r.score ?? '—'}</span>
      </span>
      <span class="rc-meta">${esc(fmt.duration(r.dur))} · ${esc(fmt.dist(r.o.route.distance))}</span>
      <span class="rc-tags">${tags}</span>
    </button>`;
  }).join('');
  return rows;
}

/** Sunrises/sunsets that happen while you're on the road, located at the stretch you'll be on. */
function sunEvents(stops, forecasts) {
  const out = [];
  for (let k = 0; k < stops.length - 1; k++) {
    const a = stops[k], b = stops[k + 1];
    (forecasts[k]?.sun || []).forEach(e => {
      if (e.t >= a.eta && e.t < b.eta) out.push({ ...e, near: a, next: b });
    });
  }
  return out;
}

function placeLabel(s) {
  return s.place?.name || `mile ${fmt.distShort(s.d)}`;
}

function renderVerdict(evald, stops, best, animate, alts = []) {
  const score = evald.score;
  const b = band(score);
  const v = $('#verdict');
  v.dataset.band = b;
  const ring = $('#ringFill');
  const num = $('#scoreNum');

  const titles = { good: 'Clear run', fair: 'Mostly smooth', mixed: 'Mixed bag', rough: 'Rough ride', none: 'Beyond the forecast' };
  $('#verdictTitle').textContent = titles[b];

  let text;
  const known = stops.filter(s => s.c);
  const w = known.length ? known.reduce((a, b) => (b.h > a.h ? b : a)) : null;
  const where = w ? `near ${placeLabel(w)} around ${fmt.time(w.eta)}` : '';
  if (score == null) {
    text = 'This trip runs past the edge of the available forecast. Try an earlier departure.';
  } else if (b === 'good') {
    text = w?.why ? `Easy going — just a touch of ${w.why} ${where}.` : 'Dry roads and easy skies the whole way. Enjoy the drive.';
  } else if (b === 'fair') {
    text = `Watch for ${w.why || 'changing conditions'} ${where}. Nothing that should stop you.`;
  } else if (b === 'mixed') {
    text = `Expect ${w.why || 'unsettled weather'} ${where}. Build in extra time.`;
  } else {
    text = `${cap(w.why || 'rough weather')} ${where}. Consider a different departure.`;
  }
  if (best && score != null && best.score - score >= 8 && Math.abs(best.dep - trip.depart) >= 3600) {
    text += ` Leaving ${fmt.dayHour(best.dep).replace('Today ', 'today at ').replace('Tomorrow ', 'tomorrow at ')} scores ${best.score}.`;
  }
  const better = alts.filter(r => r.i !== trip.active && r.score != null && score != null && r.score - score >= 8)
    .sort((a, b) => b.score - a.score)[0];
  if (better) text += ` Going ${better.o.route.label} scores ${better.score}.`;
  if (evald.coverage < 1 && score != null) text += ' (Later stops are past the forecast horizon.)';
  $('#verdictText').textContent = text;

  const target = score ?? 0;
  ring.style.strokeDashoffset = String(100 - target);
  countUp(num, target, animate && !reduceMotion ? 900 : 0);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function countUp(el, to, ms) {
  cancelAnimationFrame(el._raf);
  const from = ms ? 0 : to;
  const t0 = performance.now();
  const tick = now => {
    const p = ms ? Math.min(1, (now - t0) / ms) : 1;
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (to - from) * e));
    if (p < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

// ---------- Departure optimizer ----------
function renderOptimizer(options, best, depart) {
  const bars = $('#optBars');
  const axis = $('#optAxis');
  if (!options.length) {
    bars.innerHTML = '<p class="opt-empty">This drive is too long to compare departures within the forecast window.</p>';
    axis.innerHTML = '';
    $('#bestBtn').hidden = true;
    $('#optNote').textContent = '';
    return;
  }
  const depHour = Math.floor(depart / 3600) * 3600;
  bars.innerHTML = options.map((o, i) => {
    const b = band(o.score);
    const sel = o.dep === depHour;
    const isBest = best && o.dep === best.dep;
    const h = o.score == null ? 4 : Math.max(6, o.score);
    const d = new Date(o.dep * 1000);
    const night = d.getHours() < 6 || d.getHours() >= 21;
    return `<button type="button" role="option" class="bar ${sel ? 'sel' : ''} ${isBest ? 'best' : ''} ${night ? 'night' : ''}" data-i="${i}" data-band="${b}"
      aria-selected="${sel}" tabindex="${sel || (i === 0 && !options.some(x => x.dep === depHour)) ? 0 : -1}"
      aria-label="Leave ${fmt.dayHour(o.dep)}, road score ${o.score ?? 'unknown'}${isBest ? ', best' : ''}"
      style="--h:${h}%"><span></span></button>`;
  }).join('') + '<div class="opt-tip" id="optTip" hidden></div>';

  // Axis labels: each midnight + every 6 h.
  const n = options.length;
  axis.innerHTML = options.map((o, i) => {
    const d = new Date(o.dep * 1000);
    const hr = d.getHours();
    if (hr % 12 !== 0 || i === 0 || i > n - 3) return '';
    const left = ((i + 0.5) / n) * 100;
    const label = hr === 0 ? fmt.day(o.dep) : 'Noon';
    return `<span class="${hr === 0 ? 'day' : ''}" style="left:${left}%">${label}</span>`;
  }).join('');

  $('#optNote').textContent = 'Next 72 hours · tap a bar to re-plan';
  const bestBtn = $('#bestBtn');
  if (best && best.dep !== depHour) {
    bestBtn.hidden = false;
    $('#bestLabel').textContent = `Best: ${fmt.dayHour(best.dep)} · ${best.score}`;
    bestBtn.onclick = () => changeDeparture(best.dep);
  } else if (best) {
    bestBtn.hidden = false;
    $('#bestLabel').textContent = 'You picked the best hour';
    bestBtn.onclick = null;
  } else bestBtn.hidden = true;

  const tip = $('#optTip');
  const showTip = btn => {
    const o = options[btn.dataset.i];
    tip.innerHTML = `<strong>${o.score ?? '—'}</strong>${esc(fmt.dayHour(o.dep))}`;
    tip.hidden = false;
    const r = btn.getBoundingClientRect(), pr = bars.getBoundingClientRect();
    const x = Math.min(Math.max(r.left - pr.left + r.width / 2 + bars.scrollLeft, 44), bars.scrollWidth - 44);
    tip.style.left = `${x}px`;
  };
  bars.onpointerover = e => { const btn = e.target.closest('.bar'); if (btn) showTip(btn); };
  bars.onpointerleave = () => { tip.hidden = true; };
  bars.onfocusin = e => { const btn = e.target.closest('.bar'); if (btn) showTip(btn); };
  bars.onfocusout = () => { tip.hidden = true; };
  bars.onclick = e => {
    const btn = e.target.closest('.bar');
    if (btn) changeDeparture(options[btn.dataset.i].dep, btn.dataset.i);
  };
  bars.onkeydown = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = Number(document.activeElement?.dataset?.i ?? 0);
    const next = Math.max(0, Math.min(options.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
    changeDeparture(options[next].dep, next);
  };

  // Keep the selected bar in view.
  const selBtn = bars.querySelector('.bar.sel');
  if (selBtn && bars.scrollWidth > bars.clientWidth) {
    bars.scrollLeft = selBtn.offsetLeft - bars.clientWidth / 2;
  }
}

function changeDeparture(dep, focusIndex) {
  trip.depart = dep;
  setDepart(dep);
  writeURL();
  render({ animate: false });
  if (focusIndex != null) $(`#optBars .bar[data-i="${focusIndex}"]`)?.focus({ preventScroll: true });
}

// ---------- Advice ----------
function renderAdvice(stops, evald, sun = []) {
  const known = stops.filter(s => s.c);
  const items = [];
  if (!known.length) { $('#advice').innerHTML = ''; return; }
  const temps = known.map(s => s.c.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const feelsLo = Math.min(...known.map(s => s.c.feels ?? s.c.temp));
  const loStop = known.find(s => s.c.temp === lo), hiStop = known.find(s => s.c.temp === hi);
  const find = pred => known.find(pred);

  // Official NWS alerts in force when you pass through.
  // Same event in several forecast zones -> one card listing every town it touches.
  const byEvent = new Map();
  stops.forEach(s => (s.alerts || []).forEach(a => {
    const e = byEvent.get(a.event) || { a, places: [], end: 0 };
    const name = placeLabel(s);
    if (!e.places.includes(name)) e.places.push(name);
    e.end = Math.max(e.end, a.end);
    byEvent.set(a.event, e);
  }));
  const rank = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
  const list = names => (names.length <= 2 ? names.join(' and ') : names.length === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);
  [...byEvent.values()].sort((x, y) => (rank[x.a.severity] ?? 4) - (rank[y.a.severity] ?? 4)).slice(0, 3).forEach(({ a, places, end }) => {
    const tone = a.severity === 'Extreme' || a.severity === 'Severe' ? 'danger' : a.severity === 'Moderate' ? 'warn' : 'info';
    const until = Number.isFinite(end) ? ` · in effect until ${fmt.dayTime(end)}` : '';
    items.push(['alert', tone, a.event, `Official NWS alert near ${list(places)}${until}.`, 'nws']);
  });

  const icy = find(s => s.why === 'icy roads' || s.c.cat === 'freezing');
  if (icy) items.push(['snowflake', 'danger', 'Ice risk', `Freezing temps with moisture near ${placeLabel(icy)} around ${fmt.time(icy.eta)}. Slow down on bridges and overpasses.`]);
  const snow = find(s => s.c.cat === 'snow');
  if (snow && !icy) items.push(['snowflake', 'warn', 'Snow on the route', `${snow.c.text} near ${placeLabel(snow)}. Check chain controls before you go.`]);
  const storm = find(s => s.c.cat === 'storm');
  if (storm) items.push(['bolt', 'danger', 'Thunderstorms', `Storms near ${placeLabel(storm)} around ${fmt.time(storm.eta)}. If you can, wait it out.`]);
  const wet = find(s => ['rain', 'drizzle'].includes(s.c.cat) || s.c.pop >= 50);
  if (wet) items.push(['umbrella', 'info', 'Bring an umbrella', `${wet.c.pop >= 50 && !['rain', 'drizzle'].includes(wet.c.cat) ? `${wet.c.pop}% chance of rain` : wet.c.text} near ${placeLabel(wet)}.`]);
  const fog = find(s => s.c.cat === 'fog' || (s.c.vis != null && s.c.vis < 1500));
  if (fog) items.push(['fog', 'warn', 'Low visibility', `Fog or haze near ${placeLabel(fog)} — headlights on, extra following distance.`]);
  const gust = known.reduce((a, b) => ((b.c.gust ?? 0) > (a.c.gust ?? 0) ? b : a));
  if ((gust.c.gust ?? 0) >= 50) items.push(['wind', 'warn', 'Gusty crosswinds', `Gusts to ${fmt.speed(gust.c.gust)} near ${placeLabel(gust)}. Keep both hands on the wheel.`]);
  if (fmt.tempDelta(hi - lo) >= (units === 'imperial' ? 15 : 8)) {
    items.push(['thermo', 'info', 'Dress in layers', `Temperatures swing from ${fmt.temp(lo)} in ${placeLabel(loStop)} to ${fmt.temp(hi)} in ${placeLabel(hiStop)}.`]);
  }
  if (feelsLo <= 12) items.push(['jacket', 'info', 'Grab a jacket', `It'll feel as cold as ${fmt.temp(feelsLo)} at points along the way.`]);
  if (hi >= 33) items.push(['heat', 'warn', 'Hot stretch', `Up to ${fmt.temp(hi)} near ${placeLabel(hiStop)}. Pack water; check your coolant.`]);
  const sunset = sun.find(e => e.kind === 'sunset');
  const sunrise = sun.find(e => e.kind === 'sunrise');
  if (sunset) items.push(['moon', 'info', `Sunset at ${fmt.time(sunset.t)}`, `You'll lose the light between ${placeLabel(sunset.near)} and ${placeLabel(sunset.next)}. Headlights on, watch for wildlife.`]);
  if (sunrise) items.push(['sun', 'info', `Sunrise at ${fmt.time(sunrise.t)}`, `Daylight returns between ${placeLabel(sunrise.near)} and ${placeLabel(sunrise.next)}${sunrise.t - trip.depart > 3600 ? ' — the early stretch is in the dark' : ''}.`]);
  const dark = sunset || sunrise ? 0 : known.filter(s => !s.c.isDay).length;
  if (dark) items.push(['moon', 'info', dark === known.length ? 'Night drive' : 'Part of it\'s after dark', dark === known.length ? 'The whole drive is after dark. Stay alert and take breaks.' : `About ${Math.round((dark / known.length) * 100)}% of the drive is in the dark.`]);
  const sunny = known.filter(s => s.c.cat === 'clear' && s.c.isDay).length;
  if (sunny >= Math.max(1, known.length / 3)) items.push(['glasses', 'info', 'Sunglasses', 'Plenty of bright sky on this drive.']);
  if (!items.length) items.push(['check', 'good', 'Nothing to flag', 'No weather worth worrying about on this route. Just snacks.']);
  if (evald.coverage < 1) items.push(['alert', 'warn', 'Partial forecast', 'Part of this trip is beyond the forecast horizon, so it isn\'t scored.']);

  $('#advice').innerHTML = items.slice(0, 7).map(([ic, tone, title, text, kind]) => `
    <li class="tip tone-${tone} ${kind === 'nws' ? 'tip-nws' : ''}">
      <span class="tip-icon">${icon(ic)}</span>
      <span><strong>${esc(title)}</strong><span>${esc(text)}</span></span>
    </li>`).join('');
}

// ---------- Timeline ----------
function renderTimeline(stops, animate, breaks = [], route = null, sun = []) {
  const last = stops.length - 1;
  // Place each rest stop between the checkpoints it falls between (by driving time).
  const distAt = drive => {
    if (!route) return 0;
    const i = route.cumT.findIndex(t => t >= drive);
    return route.cumD[i < 0 ? route.cumD.length - 1 : i];
  };
  const sunRow = (e, idx) => {
    const t = splitTime(e.t);
    const up = e.kind === 'sunrise';
    return `<li class="stop stop-break stop-sun ${up ? 'is-rise' : 'is-set'} ${animate ? 'enter' : ''}" style="--i:${idx}">
      <div class="stop-btn" role="note">
        <span class="stop-time"><b>${esc(t.main)}</b><small>${esc(t.period)}</small></span>
        <span class="stop-node" aria-hidden="true"></span>
        <span class="stop-icon">${icon(up ? 'sun' : 'moon')}</span>
        <span class="stop-main"><span class="stop-name">${up ? 'Sunrise' : 'Sunset'}</span>
        <span class="stop-sub">between ${esc(placeLabel(e.near))} and ${esc(placeLabel(e.next))}</span></span>
      </div></li>`;
  };
  const breakRow = (b, idx) => {
    const t = splitTime(trip.depart + b.at);
    return `<li class="stop stop-break ${animate ? 'enter' : ''}" style="--i:${idx}">
      <div class="stop-btn" role="note">
        <span class="stop-time"><b>${esc(t.main)}</b><small>${esc(t.period)}</small></span>
        <span class="stop-node" aria-hidden="true"></span>
        <span class="stop-icon">${icon('cup')}</span>
        <span class="stop-main"><span class="stop-name">${Math.round(b.len / 60)}-min break</span>
        <span class="stop-sub">around ${fmt.distShort(distAt(b.drive))} ${fmt.distUnit()} · stretch, refuel, snack</span></span>
      </div></li>`;
  };
  // Merge checkpoints, breaks and sun events into one time-ordered list.
  const rows = [
    ...stops.map((s, k) => ({ at: s.eta, rank: 0, draw: i => stopRow(s, k, i) })),
    ...breaks.map(b => ({ at: trip.depart + b.at, rank: 1, draw: i => breakRow(b, i) })),
    ...sun.map(e => ({ at: e.t, rank: 2, draw: i => sunRow(e, i) })),
  ].sort((a, b) => a.at - b.at || a.rank - b.rank);
  $('#timeline').innerHTML = rows.map((r, i) => r.draw(i)).join('');
  function stopRow(s, k, rowIndex) {
    const t = splitTime(s.eta);
    const c = s.c;
    const role = k === 0 ? 'Start' : k === last ? 'Arrive' : `${fmt.distShort(s.d)} ${fmt.distUnit()}`;
    const sub = [s.place?.detail, role].filter(Boolean).join(' · ');
    const colorVar = c ? CAT_VAR[c.cat] : '--ink-3';
    const flag = s.h >= 0.35 && s.why ? `<span class="stop-flag">${icon('alert')}${esc(s.why)}</span>` : '';
    return `<li class="stop ${k === 0 ? 'is-start' : ''} ${k === last ? 'is-end' : ''} ${animate ? 'enter' : ''}" style="--i:${rowIndex};--c:var(${colorVar})">
      <button type="button" class="stop-btn" data-k="${k}" aria-label="${esc(placeLabel(s))}, ${esc(fmt.dayTime(s.eta))}${c ? `, ${esc(c.text)}, ${fmt.temp(c.temp)}` : ''}">
        <span class="stop-time"><b>${esc(t.main)}</b><small>${esc(t.period)}</small></span>
        <span class="stop-node" aria-hidden="true"></span>
        <span class="stop-icon">${c ? weatherIcon(c.cat, c.isDay, { size: 40 }) : ''}</span>
        <span class="stop-main">
          <span class="stop-name">${esc(placeLabel(s))}</span>
          <span class="stop-sub">${esc(sub)}</span>
          <span class="stop-cond">${c ? esc(c.text) : 'Beyond forecast'}${flag}</span>
        </span>
        <span class="stop-nums">
          <span class="stop-temp">${c ? fmt.temp(c.temp) : '—'}</span>
          ${c ? `<span class="stop-meta"><span title="Chance of precipitation">${icon('drop')}${c.pop ?? 0}%</span><span title="Wind">${icon('wind')}${fmt.speed(c.wind)}</span></span>` : ''}
        </span>
      </button>
    </li>`;
  }

  $$('#timeline button.stop-btn').forEach(btn => {
    const k = Number(btn.dataset.k);
    btn.addEventListener('click', () => map.focus(k));
    btn.addEventListener('pointerenter', () => map.highlight(k, true));
    btn.addEventListener('pointerleave', () => map.highlight(k, false));
    btn.addEventListener('focus', () => map.highlight(k, true));
    btn.addEventListener('blur', () => map.highlight(k, false));
  });
}

// ===================================================================
// Map (MapLibre GL + OpenFreeMap vector tiles — free, no key)
// ===================================================================
const cssVar = name => getComputedStyle(root).getPropertyValue(name).trim();
const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
const TRANSPARENT = 'rgba(0,0,0,0)';

const map = {
  m: null, markers: [], stops: [], route: null, colorStops: [], progress: 1, endpoints: [],
  ensure() {
    if (this.m || !window.maplibregl) return;
    this.theme = isDark() ? 'dark' : 'light';
    this.m = new maplibregl.Map({
      container: 'map',
      style: STYLE[this.theme],
      center: [-98.35, 39.5],
      zoom: 3,
      attributionControl: { compact: true },
      cooperativeGestures: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    this.m.scrollZoom.disable();
    this.m.touchZoomRotate.disableRotation();
    this.m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    // Wheel zoom only after the user engages the map, so the page still scrolls.
    this.m.on('click', () => this.m.scrollZoom.enable());
    this.m.getContainer().addEventListener('mouseleave', () => this.m.scrollZoom.disable());
    this.m.on('style.load', () => { this.tintStyle(); this.addLayers(); });
    // Click a dashed alternative to switch to it.
    this.m.on('click', 'alts-hit', e => { const i = e.features?.[0]?.properties?.i; if (i != null) switchRoute(Number(i)); });
    this.m.on('mouseenter', 'alts-hit', () => { this.m.getCanvas().style.cursor = 'pointer'; });
    this.m.on('mouseleave', 'alts-hit', () => { this.m.getCanvas().style.cursor = ''; });
    // The basemap references a few POI sprites we don't need; stub them quietly.
    this.m.on('styleimagemissing', e => {
      if (!this.m.hasImage(e.id)) this.m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
  },
  setTiles() {
    if (!this.m) return;
    const theme = isDark() ? 'dark' : 'light';
    if (theme === this.theme) return;
    this.theme = theme;
    this.m.setStyle(STYLE[theme]);
  },
  tintStyle() {
    // Nudge the basemap toward the app's warm paper palette.
    const set = (id, prop, val) => { if (this.m.getLayer(id)) try { this.m.setPaintProperty(id, prop, val); } catch { /* ignore */ } };
    if (this.theme === 'light') {
      set('background', 'background-color', '#F1EDE4');
      set('water', 'fill-color', '#CBD8E3');
      set('park', 'fill-color', '#E3E6D3');
      set('landcover_wood', 'fill-color', '#E5E5D5');
    } else {
      set('background', 'background-color', '#11151C');
    }
  },
  addLayers() {
    if (!this.route || !this.m.isStyleLoaded()) return;
    const data = {
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: this.route.coords.map(([la, lo]) => [lo, la]) },
    };
    if (this.m.getSource('route')) this.m.getSource('route').setData(data);
    else this.m.addSource('route', { type: 'geojson', data, lineMetrics: true });
    const firstLabel = this.m.getStyle().layers.find(l => l.type === 'symbol')?.id;
    const altData = {
      type: 'FeatureCollection',
      features: (this.alts || []).map(a => ({ type: 'Feature', properties: { i: a.i }, geometry: { type: 'LineString', coordinates: a.coords.map(([la, lo]) => [lo, la]) } })),
    };
    if (this.m.getSource('alts')) this.m.getSource('alts').setData(altData);
    else this.m.addSource('alts', { type: 'geojson', data: altData });
    if (!this.m.getLayer('alts-line')) {
      this.m.addLayer({
        id: 'alts-line', type: 'line', source: 'alts',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': cssVar('--ink-3'), 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 5], 'line-dasharray': [1.2, 1.6], 'line-opacity': 0.85 },
      }, firstLabel);
      this.m.addLayer({
        id: 'alts-hit', type: 'line', source: 'alts',
        paint: { 'line-color': TRANSPARENT, 'line-width': 18 },
      }, firstLabel);
    }
    if (!this.m.getLayer('route-casing')) {
      this.m.addLayer({
        id: 'route-casing', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 7, 10, 12], 'line-gradient': cssVar('--map-casing') },
      }, firstLabel);
      this.m.addLayer({
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 10, 7], 'line-gradient': cssVar('--ink-3') },
      }, firstLabel);
    }
    this.paint();
  },
  paint() {
    if (!this.m?.getLayer('route-line')) return;
    const p = this.progress;
    // step expression: colour by checkpoint ownership, transparent beyond the draw-in progress.
    const stops = this.colorStops;
    const expr = ['step', ['line-progress'], stops[0]?.color || cssVar('--ink-3')];
    for (let i = 1; i < stops.length; i++) {
      if (stops[i].at >= p) break;
      expr.push(stops[i].at, stops[i].color);
    }
    if (p < 1) expr.push(Math.max(p, 1e-6), TRANSPARENT);
    const casing = p < 1 ? ['step', ['line-progress'], cssVar('--map-casing'), Math.max(p, 1e-6), TRANSPARENT] : cssVar('--map-casing');
    this.m.setPaintProperty('route-line', 'line-gradient', expr.length > 3 ? expr : expr[2]);
    this.m.setPaintProperty('route-casing', 'line-gradient', casing);
  },
  clear() {
    this.markers.forEach(m => m.remove());
    this.endpoints.forEach(m => m.remove());
    this.markers = []; this.endpoints = [];
    this.route = null;
    if (this.m?.getLayer('route-line')) { this.m.removeLayer('route-line'); this.m.removeLayer('route-casing'); this.m.removeSource('route'); }
    if (this.m?.getLayer('alts-line')) { this.m.removeLayer('alts-hit'); this.m.removeLayer('alts-line'); this.m.removeSource('alts'); }
    this.alts = [];
  },
  preview(a, b) {
    if (!this.m) return;
    // Build the box with extend(): passing [a, b] directly treats a start east of the
    // destination as a box wrapping the whole planet (the "world map" bug).
    const box = new maplibregl.LngLatBounds([a.lon, a.lat], [a.lon, a.lat]).extend([b.lon, b.lat]);
    this.m.resize();
    this.m.fitBounds(box, { padding: 80, duration: reduceMotion ? 0 : 900, maxZoom: 10 });
    const mk = (p, cls, letter) => {
      const el = document.createElement('div');
      el.innerHTML = `<div class="end-pin ${cls} pulse"><span>${letter}</span></div>`;
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(this.m);
    };
    this.endpoints = [mk(a, 'a', 'A'), mk(b, 'b', 'B')];
  },
  drawTrip(route, stops, { animate, alts = [] }) {
    if (!this.m) return;
    this.alts = alts;
    this.markers.forEach(m => m.remove());
    this.endpoints.forEach(m => m.remove());
    this.markers = []; this.endpoints = [];
    const newRoute = this.route !== route;
    this.route = route;
    this.stops = stops;

    // Each checkpoint owns the stretch of road halfway to its neighbours.
    const D = route.distance || 1;
    this.colorStops = stops.map((s, k) => ({
      at: k === 0 ? 0 : (stops[k - 1].d + s.d) / 2 / D,
      color: s.c ? cssVar(CAT_VAR[s.c.cat]) : cssVar('--ink-3'),
    }));

    if (newRoute) this.progress = animate && !reduceMotion ? 0 : 1;
    if (this.m.isStyleLoaded()) this.addLayers(); else this.m.once('idle', () => this.addLayers());

    const last = stops.length - 1;
    stops.forEach((s, k) => {
      const c = s.c;
      const isEnd = k === 0 || k === last;
      const el = document.createElement('div');
      el.className = 'mk';
      el.innerHTML = isEnd
        ? `<div class="end-pin ${k === 0 ? 'a' : 'b'}"><span>${k === 0 ? 'A' : 'B'}</span>${c ? `<em>${fmt.temp(c.temp)}</em>` : ''}</div>`
        : `<div class="wx-pin" style="--c:var(${c ? CAT_VAR[c.cat] : '--ink-3'})">${c ? weatherIcon(c.cat, c.isDay, { size: 26 }) : ''}<b>${c ? fmt.temp(c.temp) : '—'}</b></div>`;
      el.setAttribute('aria-label', placeLabel(s));
      if (animate && !reduceMotion) {
        el.firstElementChild.classList.add('pop-in');
        el.firstElementChild.style.animationDelay = `${250 + (s.d / D) * 1200}ms`;
      }
      const popup = new maplibregl.Popup({ closeButton: false, offset: 20, maxWidth: '340px' }).setHTML(`
        <div class="pop">
          <div class="pop-icon">${c ? weatherIcon(c.cat, c.isDay, { size: 40 }) : ''}</div>
          <div>
            <strong>${esc(placeLabel(s))}</strong>
            <span>${esc(fmt.dayTime(s.eta))}</span>
            <span>${c ? `${esc(c.text)} · ${fmt.temp(c.temp)} · ${icon('drop')}${c.pop ?? 0}%` : 'Beyond forecast'}</span>
          </div>
        </div>`);
      const marker = new maplibregl.Marker({ element: el, anchor: isEnd ? 'center' : 'left', offset: isEnd ? [0, 0] : [-16, 0] })
        .setLngLat([s.lon, s.lat]).setPopup(popup).addTo(this.m);
      el.style.zIndex = isEnd ? '3' : '1';
      el.addEventListener('mouseenter', () => { this.timelineHighlight(k, true); el.style.zIndex = '5'; });
      el.addEventListener('mouseleave', () => { this.timelineHighlight(k, false); el.style.zIndex = isEnd ? '3' : '1'; });
      el.addEventListener('click', () => this.timelineScroll(k));
      this.markers[k] = marker;
    });

    if (animate) {
      const b = new maplibregl.LngLatBounds();
      route.coords.forEach(([la, lo]) => b.extend([lo, la]));
      alts.forEach(a => a.coords.forEach(([la, lo]) => b.extend([lo, la])));
      this.m.resize();
      this.m.stop(); // cancel any preview move still in flight so the route view always wins
      const wide = matchMedia('(min-width: 961px)').matches;
      this.m.fitBounds(b, { padding: wide ? { top: 70, bottom: 90, left: 70, right: 110 } : 50, duration: reduceMotion ? 0 : 1000, maxZoom: 11 });
      if (!reduceMotion) {
        cancelAnimationFrame(this._raf);
        const t0 = performance.now() + 250, dur = 1300;
        const tick = now => {
          const t = Math.min(1, Math.max(0, (now - t0) / dur));
          this.progress = t < 1 ? 1 - Math.pow(1 - t, 2.2) : 1;
          this.paint();
          if (t < 1) this._raf = requestAnimationFrame(tick);
        };
        this._raf = requestAnimationFrame(tick);
      }
    }
  },
  highlight(k, on) {
    this.markers[k]?.getElement()?.classList.toggle('is-active', on);
  },
  focus(k) {
    const s = this.stops[k];
    if (!s || !this.m) return;
    if (matchMedia('(max-width: 960px)').matches) $('.map-wrap').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    this.markers.forEach(m => m.getPopup()?.isOpen() && m.togglePopup());
    this.m.flyTo({ center: [s.lon, s.lat], zoom: Math.max(this.m.getZoom(), 9), duration: reduceMotion ? 0 : 900 });
    this.markers[k]?.togglePopup();
  },
  timelineHighlight(k, on) {
    $$('#timeline .stop:not(.stop-break)')[k]?.classList.toggle('is-active', on);
  },
  timelineScroll(k) {
    const li = $$('#timeline .stop:not(.stop-break)')[k];
    if (!li || matchMedia('(max-width: 960px)').matches) return;
    li.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1200);
  },
};

// ===================================================================
// Share / edit / URL state
// ===================================================================
const encPlace = p => [p.name, p.lat.toFixed(5), p.lon.toFixed(5), p.detail || ''].join('~');
const decPlace = s => {
  const [name, lat, lon, detail] = (s || '').split('~');
  const la = parseFloat(lat), lo = parseFloat(lon);
  return name && Number.isFinite(la) && Number.isFinite(lo) ? { name, lat: la, lon: lo, detail: detail || '' } : null;
};
function writeURL() {
  if (!trip) return;
  const p = new URLSearchParams({ from: encPlace(trip.from), to: encPlace(trip.to), leave: String(trip.depart) });
  if (trip.active) p.set('route', String(trip.active));
  if (trip.breaks !== 'off') p.set('breaks', trip.breaks);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

$('#shareBtn').addEventListener('click', async () => {
  const url = location.href;
  const title = trip ? `${trip.from.name} → ${trip.to.name} · Weather to Travel` : 'Weather to Travel';
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied — send it to your co-pilot.'); }
  catch { prompt('Copy this link:', url); }
});

$('#strip').addEventListener('click', e => {
  const c = e.target.closest('.strip-card');
  if (c) map.focus(Number(c.dataset.k));
});

// ---------- Trip poster ----------
const posterDialog = $('#posterDialog');
let posterBlobUrl = null;
$('#posterBtn').addEventListener('click', async () => {
  if (!trip || !lastRender) return;
  const btn = $('#posterBtn');
  btn.classList.add('busy');
  try {
    const { stops, evald, v } = lastRender;
    const D = v.o.route.distance || 1;
    const name = s => placeLabel(s);
    const canvas = await drawPoster({
      from: trip.from.name, to: trip.to.name,
      leaveText: fmt.dayTime(trip.depart),
      arriveText: fmt.dayTime(trip.depart + v.duration),
      distanceText: fmt.dist(v.o.route.distance),
      durationText: fmt.duration(v.duration),
      score: evald.score, band: band(evald.score),
      title: $('#verdictTitle').textContent, text: $('#verdictText').textContent,
      coords: v.o.route.coords,
      colorStops: stops.map((s, k) => ({ at: k === 0 ? 0 : (stops[k - 1].d + s.d) / 2 / D, color: s.c ? cssVar(CAT_VAR[s.c.cat]) : '#8B8F98' })),
      stops: stops.map(s => ({ lat: s.lat, lon: s.lon, h: s.h, label: `${fmt.time(s.eta)} ${name(s)}`, temp: s.c ? (s.h >= 0.35 && s.why ? s.why : fmt.temp(s.c.temp)) : '—', color: s.c ? cssVar(CAT_VAR[s.c.cat]) : '#8B8F98', warn: s.h >= 0.35 })),
      url: 'mykolyn.github.io/weather-to-travel-claude',
    });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (posterBlobUrl) URL.revokeObjectURL(posterBlobUrl);
    posterBlobUrl = URL.createObjectURL(blob);
    $('#posterImg').src = posterBlobUrl;
    const file = `${trip.from.name}-to-${trip.to.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
    const dl = $('#posterDownload');
    dl.href = posterBlobUrl;
    dl.download = file;
    const share = $('#posterShare');
    const shareFile = new File([blob], file, { type: 'image/png' });
    share.hidden = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
    share.onclick = () => navigator.share({ files: [shareFile], title: `${trip.from.name} → ${trip.to.name}` }).catch(() => {});
    posterDialog.showModal();
    track('poster');
  } finally {
    btn.classList.remove('busy');
  }
});
$('#posterClose').addEventListener('click', () => posterDialog.close());
posterDialog.addEventListener('click', e => { if (e.target === posterDialog) posterDialog.close(); });

$('#routeCards').addEventListener('click', e => {
  const card = e.target.closest('.route-card');
  if (card) switchRoute(Number(card.dataset.i));
});
$('#breaksSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-breaks]');
  if (b) setBreaks(b.dataset.breaks);
});

const backToPlanner = () => {
  $('#planner').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  setTimeout(() => combos.to.input.focus({ preventScroll: true }), reduceMotion ? 0 : 500);
};
$('#editBtn').addEventListener('click', backToPlanner);
$('#errorBack').addEventListener('click', backToPlanner);
$('#errorRetry').addEventListener('click', () => { if (lastPlan) plan(...lastPlan); });

// Installable + works offline (see sw.js).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
addEventListener('offline', () => toast('You\'re offline — trips you\'ve opened before still work.'));
addEventListener('online', () => toast('Back online.'));

const topbar = $('.topbar');
const onScroll = () => topbar.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ===================================================================
// Decorative: feature icons, reveal-on-scroll, scene motion
// ===================================================================
$$('.f-icon[data-wx]').forEach(el => { el.innerHTML = weatherIcon(el.dataset.wx, true, { size: 56 }); });

if ('IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el, i) => { el.style.setProperty('--d', `${(i % 4) * 70}ms`); io.observe(el); });
} else {
  $$('.reveal').forEach(el => el.classList.add('in'));
}
// Hero drawing: animate only while visible (and never with reduced motion).
{
  const stack = $('#sceneSvg');
  const svgs = stack ? [...stack.querySelectorAll('svg')] : [];
  let onScreen = true;
  const sync = () => {
    const run = onScreen && !document.hidden && !reduceMotion;
    stack?.classList.toggle('is-paused', !run);
    svgs.forEach(s => (run ? s.unpauseAnimations?.() : s.pauseAnimations?.()));
  };
  // Ambient detail (rain, clouds, sun, tags) plays on arrival and while you're over the drawing,
  // then settles after a while; the car (compositor-only, ~free) keeps driving.
  let restTimer;
  const wake = () => {
    stack?.classList.remove('is-resting');
    clearTimeout(restTimer);
    restTimer = setTimeout(() => stack?.classList.add('is-resting'), 12000);
  };
  stack?.addEventListener('pointermove', wake, { passive: true });
  stack?.addEventListener('pointerenter', wake, { passive: true });
  wake();
  if (stack && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }).observe(stack);
  }
  document.addEventListener('visibilitychange', sync);
  sync();
}

// ===================================================================
// Boot from a shared link
// ===================================================================
(function boot() {
  const q = new URLSearchParams(location.search);
  const from = decPlace(q.get('from')), to = decPlace(q.get('to'));
  if (!from || !to) return;
  combos.from.set(from);
  combos.to.set(to);
  let dep = parseInt(q.get('leave'), 10);
  const now = Date.now() / 1000;
  if (!Number.isFinite(dep) || dep < now - 3600 || dep > now + 7 * 86400) dep = nowRounded();
  setDepart(dep);
  plan(from, to, dep, { route: parseInt(q.get('route'), 10) || 0, breaks: q.get('breaks') || breaksPref });
})();
