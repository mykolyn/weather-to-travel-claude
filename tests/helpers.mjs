import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const DIR = new URL('./fixtures/', import.meta.url);
export const META = JSON.parse(readFileSync(new URL('meta.json', DIR)));
const API = /(api\.open-meteo\.com|geocoding-api\.open-meteo\.com|router\.project-osrm\.org|routing\.openstreetmap\.de|photon\.komoot\.io)/;

export const TRIPS = {
  tahoe: '/?from=San+Jose~37.33617~-121.89059~CA&to=South+Lake+Tahoe~38.93324~-119.98435~CA',
  sf: '/?from=San+Jose~37.3382~-121.8863~CA&to=San+Francisco~37.7793~-122.4193~CA',
  noroute: '/?from=Honolulu~21.30694~-157.85833~HI&to=Los+Angeles~34.05223~-118.24368~CA',
};

/** A synthetic NWS alert for every point north of `minLat`, in force for the next two days. */
export function nwsAlert({ minLat = 38.6, event = 'Winter Storm Warning', severity = 'Severe' } = {}) {
  const now = META.now;
  return async route => {
    const lat = Number(new URL(route.request().url()).searchParams.get('point')?.split(',')[0]);
    const features = lat > minLat ? [{
      id: 'test-alert',
      properties: {
        id: 'test-alert', event, severity, headline: `${event} in effect`, areaDesc: 'Sierra Nevada',
        onset: new Date(now - 3600e3).toISOString(), ends: new Date(now + 48 * 3600e3).toISOString(),
      },
    }] : [];
    await route.fulfill({ json: { features } });
  };
}

/** Page with the clock pinned to the recording time and APIs served from the HAR. */
export const test = base.extend({
  alerts: [null, { option: true }],
  page: async ({ page, context, alerts }, use) => {
    await context.routeFromHAR(new URL('api.har', DIR).pathname, { url: API, notFound: 'abort' });
    await context.route(/api\.weather\.gov/, alerts ? nwsAlert(alerts) : (r => r.fulfill({ json: { features: [] } })));
    await page.clock.setFixedTime(META.now);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

export async function openTrip(page, path) {
  await page.goto(path);
  await expect(page.locator('#trip')).toBeVisible();
  await scoreSettled(page);
}

/** The road score counts up; wait until the number matches the ring's target. */
export async function scoreSettled(page) {
  await page.waitForFunction(() => {
    const n = document.querySelector('#scoreNum')?.textContent;
    const off = parseFloat(document.querySelector('#ringFill')?.style.strokeDashoffset);
    return Number.isFinite(off) && String(Math.round(100 - off)) === n;
  });
}

export { expect };
