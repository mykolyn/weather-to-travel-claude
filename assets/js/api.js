// Data layer. Every service here is free, keyless and CORS-enabled:
//   Photon (OpenStreetMap geocoding) · OSRM (routing) · Open-Meteo (forecast + fallback geocoding)

const PHOTON = 'https://photon.komoot.io';
const OSRM = 'https://router.project-osrm.org';
const METEO = 'https://api.open-meteo.com/v1/forecast';
const METEO_GEO = 'https://geocoding-api.open-meteo.com/v1/search';

export const FORECAST_DAYS = 8;

/** fetch JSON; on a "busy" answer (429/502/503/504) wait a moment and try once more. */
async function getJSON(url, opts = {}) {
  try {
    return await getJSONOnce(url, opts);
  } catch (err) {
    if (![429, 502, 503, 504].includes(err.status) || opts.signal?.aborted) throw err;
    await new Promise(r => setTimeout(r, 1500));
    return getJSONOnce(url, opts);
  }
}

async function getJSONOnce(url, { signal, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
};
const region = p => (p.countrycode === 'US' && STATE_ABBR[p.state]) || p.state || p.country || '';

function photonToPlace(f) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const isPlace = p.osm_key === 'place';
  const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || p.county || 'Unnamed place';
  const locality = isPlace ? '' : (p.city || p.town || p.village || p.district || p.county || '');
  const detail = [locality !== name ? locality : '', region(p), p.countrycode !== 'US' ? p.country : '']
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  return { name, detail, lat, lon, kind: p.osm_value || p.type || '' };
}

/** Free-text place search (cities, addresses, landmarks). */
export async function searchPlaces(q, { signal, near } = {}) {
  const params = new URLSearchParams({ q, limit: '6', lang: 'en' });
  if (near) { params.set('lat', near.lat.toFixed(3)); params.set('lon', near.lon.toFixed(3)); }
  try {
    const data = await getJSON(`${PHOTON}/api/?${params}`, { signal, timeout: 8000 });
    const seen = new Set();
    return data.features.map(photonToPlace).filter(p => {
      const key = `${p.name}|${p.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Fallback: Open-Meteo geocoding (cities only).
    const data = await getJSON(`${METEO_GEO}?${new URLSearchParams({ name: q, count: '6', language: 'en' })}`, { signal });
    return (data.results || []).map(r => ({
      name: r.name,
      detail: [r.country_code === 'US' ? (STATE_ABBR[r.admin1] || r.admin1) : r.admin1, r.country_code !== 'US' ? r.country : '']
        .filter(Boolean).join(', '),
      lat: r.latitude, lon: r.longitude, kind: 'city',
    }));
  }
}

/** Nearest named town/city to a coordinate (searching outward), or null. */
export async function reversePlace(lat, lon, { signal } = {}) {
  const lookup = async radius => {
    const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4), limit: '1', lang: 'en', layer: 'city', radius: String(radius) });
    const data = await getJSON(`${PHOTON}/reverse?${params}`, { signal, timeout: 8000 });
    const p = data.features?.[0]?.properties;
    return p?.name ? { name: p.name, detail: region(p) } : null;
  };
  try {
    return (await lookup(20)) || (await lookup(60));
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return null;
  }
}

// ---------- Routing ----------
const normRef = ref => {
  const first = String(ref).split(';')[0].trim();
  return first.replace(/^(I|US|SR|CA|WA|OR|NV|AZ|UT|CO|TX|NY|FL|[A-Z]{2})\s+(\d+[A-Z]?)$/, '$1-$2');
};

/** Distance driven on each named road, biggest first. */
function roadShares(leg) {
  const by = new Map();
  for (const st of leg.steps || []) {
    const key = st.ref ? normRef(st.ref) : st.name;
    if (!key) continue;
    by.set(key, (by.get(key) || 0) + st.distance);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function toRoute(r) {
  const coords = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const leg = r.legs[0];
  const cumT = [0], cumD = [0];
  const durs = leg.annotation.duration, dists = leg.annotation.distance;
  for (let i = 0; i < durs.length; i++) {
    cumT.push(cumT[i] + durs[i]);
    cumD.push(cumD[i] + dists[i]);
  }
  // Annotation totals can drift a hair from the summary; rescale to the summary.
  const kT = r.duration / (cumT[cumT.length - 1] || 1);
  const kD = r.distance / (cumD[cumD.length - 1] || 1);
  return {
    coords,
    cumT: cumT.map(t => t * kT),
    cumD: cumD.map(d => d * kD),
    duration: r.duration,
    distance: r.distance,
    roads: roadShares(leg),
  };
}

/** Fastest route plus up to two real alternatives, each labelled by its signature road. */
const ROUTERS = [
  `${OSRM}/route/v1/driving`,
  'https://routing.openstreetmap.de/routed-car/route/v1/driving', // FOSSGIS mirror, used if the main server is down
];

export async function getRoutes(a, b, { signal } = {}) {
  const query = `/${a.lon},${a.lat};${b.lon},${b.lat}` +
    '?overview=full&geometries=geojson&annotations=duration,distance&alternatives=2&steps=true';
  let data;
  for (const base of ROUTERS) {
    try {
      data = await getJSON(base + query, { signal, timeout: 15000 });
      break;
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err.body?.code) { data = err.body; break; } // NoRoute / NoSegment: a real answer, don't retry
    }
  }
  if (!data) throw new Error('The routing services didn\'t answer. Please try again in a moment.');
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw Object.assign(new Error('We couldn\'t find a drivable route between those two places. Are they on the same landmass?'), { kind: 'noroute' });
  }
  const routes = data.routes.slice(0, 3).map(toRoute)
    // Drop "alternatives" that are pointless detours.
    .filter((r, i, all) => i === 0 || r.duration <= all[0].duration * 1.6);
  // Label each route by the busiest road the others don't share.
  routes.forEach((r, i) => {
    const others = new Set(routes.filter((_, j) => j !== i).flatMap(o => o.roads.slice(0, 2)));
    const own = r.roads.find(x => !others.has(x)) || r.roads[0] || '';
    r.label = own ? `via ${own}` : (i === 0 ? 'Fastest route' : `Route ${i + 1}`);
  });
  return routes;
}

// ---------- Official alerts (US National Weather Service) ----------
const NWS = 'https://api.weather.gov/alerts/active';

/** Active NWS alerts covering a point. Returns [] outside the US or on failure. */
export async function getAlerts(lat, lon, { signal } = {}) {
  if (lon > -60 || lon < -180 || lat < 17 || lat > 72) return [];
  try {
    const data = await getJSON(`${NWS}?point=${lat.toFixed(3)},${lon.toFixed(3)}`, { signal, timeout: 8000 });
    return (data.features || []).map(f => {
      const p = f.properties;
      return {
        id: p.id || f.id,
        event: p.event,
        severity: p.severity,
        headline: p.headline,
        area: p.areaDesc,
        start: Date.parse(p.onset || p.effective) / 1000 || 0,
        end: Date.parse(p.ends || p.expires) / 1000 || Infinity,
      };
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return [];
  }
}

const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
  'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'visibility', 'is_day',
];

/** Hourly forecasts (metric) for many points in a single request. */
export async function getForecasts(points, { signal } = {}) {
  const params = new URLSearchParams({
    latitude: points.map(p => p.lat.toFixed(4)).join(','),
    longitude: points.map(p => p.lon.toFixed(4)).join(','),
    hourly: HOURLY.join(','),
    daily: 'sunrise,sunset',
    forecast_days: String(FORECAST_DAYS),
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  let data;
  try {
    data = await getJSON(`${METEO}?${params}`, { signal, timeout: 20000 });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(err.status === 429
      ? 'The free forecast service is busy right now. Please try again in a minute.'
      : 'The forecast service didn\'t answer. Please try again in a moment.');
  }
  const list = Array.isArray(data) ? data : [data];
  return list.map(d => {
    const h = d.hourly;
    return {
      time: h.time,
      temp: h.temperature_2m,
      feels: h.apparent_temperature,
      pop: h.precipitation_probability,
      precip: h.precipitation,
      code: h.weather_code,
      wind: h.wind_speed_10m,
      gust: h.wind_gusts_10m,
      vis: h.visibility,
      isDay: h.is_day,
      // Sun events as a flat, time-sorted list.
      sun: d.daily ? [
        ...(d.daily.sunrise || []).map(t => ({ t, kind: 'sunrise' })),
        ...(d.daily.sunset || []).map(t => ({ t, kind: 'sunset' })),
      ].filter(e => e.t).sort((a, b) => a.t - b.t) : [],
    };
  });
}
