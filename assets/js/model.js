// Trip model: sample checkpoints along a route, look up the weather at each
// checkpoint's ETA, and turn it into a road score + plain-language advice.

// ---------- WMO weather codes ----------
const WMO = {
  0: ['clear', 'Clear'], 1: ['clear', 'Mostly clear'], 2: ['partly', 'Partly cloudy'], 3: ['cloudy', 'Overcast'],
  45: ['fog', 'Fog'], 48: ['fog', 'Freezing fog'],
  51: ['drizzle', 'Light drizzle'], 53: ['drizzle', 'Drizzle'], 55: ['drizzle', 'Heavy drizzle'],
  56: ['freezing', 'Freezing drizzle'], 57: ['freezing', 'Freezing drizzle'],
  61: ['rain', 'Light rain'], 63: ['rain', 'Rain'], 65: ['rain', 'Heavy rain'],
  66: ['freezing', 'Freezing rain'], 67: ['freezing', 'Heavy freezing rain'],
  71: ['snow', 'Light snow'], 73: ['snow', 'Snow'], 75: ['snow', 'Heavy snow'], 77: ['snow', 'Snow grains'],
  80: ['rain', 'Rain showers'], 81: ['rain', 'Rain showers'], 82: ['rain', 'Violent showers'],
  85: ['snow', 'Snow showers'], 86: ['snow', 'Heavy snow showers'],
  95: ['storm', 'Thunderstorm'], 96: ['storm', 'Thunderstorm, hail'], 99: ['storm', 'Severe thunderstorm'],
};
const HEAVY = new Set([55, 65, 67, 75, 82, 86, 99]);
const BASE = { clear: 0, partly: 0, cloudy: 0.04, fog: 0.4, drizzle: 0.18, rain: 0.42, freezing: 0.9, snow: 0.62, storm: 0.78 };

export function describe(code) {
  const [cat, text] = WMO[code] || ['cloudy', 'Cloudy'];
  return { cat, text };
}

// Colours used on the map / timeline for each category (CSS custom props).
export const CAT_VAR = {
  clear: '--w-clear', partly: '--w-clear', cloudy: '--w-cloud', fog: '--w-fog', drizzle: '--w-rain',
  rain: '--w-rain', freezing: '--w-snow', snow: '--w-snow', storm: '--w-storm',
};

// ---------- Route sampling ----------
function bisect(arr, v) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Evenly spaced checkpoints (by distance) including both ends. */
export function sampleRoute(route) {
  const km = route.distance / 1000;
  const n = Math.max(3, Math.min(15, Math.ceil(km / 35) + 1));
  const pts = [];
  for (let k = 0; k < n; k++) {
    const d = (route.distance * k) / (n - 1);
    let i = bisect(route.cumD, d);
    if (i === 0) {
      pts.push({ lat: route.coords[0][0], lon: route.coords[0][1], t: 0, d: 0, idx: 0 });
      continue;
    }
    const d0 = route.cumD[i - 1], d1 = route.cumD[i];
    const f = d1 > d0 ? (d - d0) / (d1 - d0) : 1;
    const [la0, lo0] = route.coords[i - 1], [la1, lo1] = route.coords[i];
    pts.push({
      lat: la0 + (la1 - la0) * f,
      lon: lo0 + (lo1 - lo0) * f,
      t: route.cumT[i - 1] + (route.cumT[i] - route.cumT[i - 1]) * f,
      d,
      idx: i,
    });
  }
  return pts;
}

// ---------- Conditions at a moment ----------
/** Weather at unix time `ts` from an hourly series (null if out of range). */
export function conditionAt(fc, ts) {
  const times = fc.time;
  if (!times?.length || ts < times[0] - 1800 || ts > times[times.length - 1] + 1800) return null;
  let i = bisect(times, ts);
  if (i > 0 && times[i] > ts) i -= 1;
  const j = Math.min(i + 1, times.length - 1);
  const f = j > i ? Math.min(1, Math.max(0, (ts - times[i]) / (times[j] - times[i]))) : 0;
  const near = f < 0.5 ? i : j;
  const lerp = arr => (arr?.[i] == null ? null : arr[j] == null ? arr[i] : arr[i] + (arr[j] - arr[i]) * f);
  const code = fc.code[near];
  const { cat, text } = describe(code);
  return {
    code, cat, text,
    temp: lerp(fc.temp),
    feels: lerp(fc.feels),
    pop: Math.max(fc.pop?.[i] ?? 0, fc.pop?.[j] ?? 0),
    precip: fc.precip?.[near] ?? 0,
    wind: lerp(fc.wind),
    gust: lerp(fc.gust),
    vis: fc.vis?.[near] ?? null,
    isDay: fc.isDay?.[near] !== 0,
  };
}

/** 0 (fine) … 1 (dangerous), plus the main reason. */
export function hazard(c) {
  if (!c) return { h: 0, why: null };
  const factors = [];
  let base = BASE[c.cat] ?? 0;
  if (HEAVY.has(c.code)) base = Math.min(1, base + 0.15);
  if (['drizzle', 'rain', 'snow', 'freezing', 'storm'].includes(c.cat) && c.pop != null) {
    base *= 0.55 + 0.45 * (c.pop / 100);
  }
  factors.push([base, c.text.toLowerCase()]);

  if (c.cat === 'clear' || c.cat === 'partly' || c.cat === 'cloudy') {
    if (c.pop >= 70) factors.push([0.3, 'a good chance of showers']);
    else if (c.pop >= 45) factors.push([0.16, 'a chance of showers']);
  }
  const g = c.gust ?? 0;
  if (g >= 90) factors.push([0.8, 'damaging gusts']);
  else if (g >= 65) factors.push([0.48, 'strong gusts']);
  else if (g >= 50) factors.push([0.22, 'gusty winds']);

  if (c.vis != null) {
    if (c.vis < 400) factors.push([0.62, 'very low visibility']);
    else if (c.vis < 1500) factors.push([0.36, 'low visibility']);
    else if (c.vis < 4000) factors.push([0.1, 'hazy visibility']);
  }
  const wet = c.precip > 0.1 || c.pop >= 50 || ['drizzle', 'rain', 'snow', 'freezing'].includes(c.cat);
  if (c.temp != null && c.temp <= 0.5 && wet) factors.push([0.88, 'icy roads']);

  factors.sort((a, b) => b[0] - a[0]);
  const significant = factors.filter(f => f[0] >= 0.15).length;
  const h = Math.min(1, factors[0][0] + Math.max(0, significant - 1) * 0.06);
  return { h, why: factors[0][0] >= 0.15 ? factors[0][1] : null };
}

// ---------- Official alerts ----------
const ROAD_EVENT = /winter|blizzard|ice|snow|freez|wind|storm|flood|fog|tornado|hurricane|tropical|dust|thunder|avalanche|squall|whiteout|heat/i;
const SEVERITY = { Extreme: 0.92, Severe: 0.75, Moderate: 0.5, Minor: 0.25 };

/** Alerts in force at a stop when you pass it, plus the hazard they add. */
export function alertsAt(alerts, eta) {
  const live = (alerts || []).filter(a => eta >= a.start - 1800 && eta <= a.end);
  let h = 0, why = null;
  for (const a of live) {
    const v = ROAD_EVENT.test(a.event) ? (SEVERITY[a.severity] ?? 0.4) : 0.15;
    if (v > h) { h = v; why = a.event.toLowerCase(); }
  }
  return { live, h, why };
}

// ---------- Rest stops ----------
export const BREAKS = {
  off: { every: 0, len: 0, label: 'No breaks' },
  short: { every: 2 * 3600, len: 15 * 60, label: '15 min every 2 h' },
  long: { every: 3 * 3600, len: 30 * 60, label: '30 min every 3 h' },
};
const breaksBefore = (t, cfg) => (cfg.every && t > 0 ? Math.floor((t - 1) / cfg.every) : 0);

/** Shift checkpoint times for rest stops; returns adjusted points, total time and break list. */
export function withBreaks(points, driveDuration, cfg = BREAKS.off) {
  const pts = points.map(p => ({ ...p, drive: p.t, t: p.t + breaksBefore(p.t, cfg) * cfg.len }));
  const n = breaksBefore(driveDuration, cfg);
  const stops = Array.from({ length: n }, (_, i) => ({ at: (i + 1) * cfg.every + i * cfg.len, drive: (i + 1) * cfg.every, len: cfg.len }));
  return { points: pts, duration: driveDuration + n * cfg.len, breaks: stops };
}

/** Evaluate the whole trip for a departure time (unix seconds). */
export function evaluate(points, forecasts, depart, alerts = []) {
  const stops = points.map((p, k) => {
    const eta = depart + p.t;
    const c = conditionAt(forecasts[k], eta);
    const hz = hazard(c);
    const al = alertsAt(alerts[k], eta);
    const h = Math.max(hz.h, al.h);
    return { ...p, eta, c, h, why: al.h > hz.h ? al.why : hz.why, alerts: al.live };
  });
  const known = stops.filter(s => s.c);
  if (!known.length) return { stops, score: null, coverage: 0 };
  const hs = known.map(s => s.h);
  const max = Math.max(...hs);
  const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  const score = Math.round(100 * (1 - (0.62 * max + 0.38 * mean)));
  const worst = known.reduce((a, b) => (b.h > a.h ? b : a));
  return { stops, score: Math.max(0, Math.min(100, score)), worst, coverage: known.length / stops.length };
}

export function band(score) {
  if (score == null) return 'none';
  if (score >= 85) return 'good';
  if (score >= 65) return 'fair';
  if (score >= 45) return 'mixed';
  return 'rough';
}

/** Scores for each whole-hour departure from `start` for `hours` hours. */
export function scan(points, forecasts, start, hours, duration, alerts = []) {
  const end = forecasts[0].time[forecasts[0].time.length - 1];
  const out = [];
  for (let k = 0; k < hours; k++) {
    const dep = start + k * 3600;
    if (dep + duration > end) break;
    out.push({ dep, score: evaluate(points, forecasts, dep, alerts).score });
  }
  return out;
}
