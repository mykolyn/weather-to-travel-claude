// Re-records tests/fixtures/api.har from the live APIs.
// Run with the dev server up:  npm run serve  (in another terminal), then  npm run test:record
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4173';
const DIR = new URL('./fixtures/', import.meta.url);
const API = /(api\.open-meteo\.com|geocoding-api\.open-meteo\.com|router\.project-osrm\.org|routing\.openstreetmap\.de|photon\.komoot\.io)/;
export const TRIPS = {
  tahoe: '/?from=San+Jose~37.33617~-121.89059~CA&to=South+Lake+Tahoe~38.93324~-119.98435~CA',
  sf: '/?from=San+Jose~37.3382~-121.8863~CA&to=San+Francisco~37.7793~-122.4193~CA',
  noroute: '/?from=Honolulu~21.30694~-157.85833~HI&to=Los+Angeles~34.05223~-118.24368~CA',
};

mkdirSync(DIR, { recursive: true });
const now = Math.floor(Date.now() / 60000) * 60000;
writeFileSync(new URL('meta.json', DIR), JSON.stringify({ now, recorded: new Date(now).toISOString() }, null, 2));

const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' });
await context.routeFromHAR(new URL('api.har', DIR).pathname, { url: API, update: true, updateContent: 'embed' });
await context.route(/api\.weather\.gov/, r => r.fulfill({ json: { features: [] } }));
const page = await context.newPage();
await page.clock.setFixedTime(now);
const ready = () => page.waitForSelector('#trip:not([hidden]), #errorCard:not([hidden])', { timeout: 60000 });

// Two-route trip, then switch to the alternative so its town names are recorded too.
await page.goto(BASE + TRIPS.tahoe); await ready();
await page.click('.route-card[data-i="1"]'); await page.waitForTimeout(6000);
// Sample trip from the chip.
await page.goto(BASE + '/'); await page.click('.samples .chip[data-sample="0"]'); await ready(); await page.waitForTimeout(1500);
// Place search.
await page.goto(BASE + '/'); await page.fill('#fromInput', 'Moab'); await page.waitForSelector('#fromList [role=option]');
// No-route error.
await page.goto(BASE + TRIPS.noroute); await ready();
// Routing fallback: main OSRM down -> FOSSGIS mirror.
await context.route(/router\.project-osrm\.org/, r => r.abort());
await page.goto(BASE + TRIPS.sf); await ready(); await page.waitForTimeout(1500);

await context.close();
await browser.close();
console.log('fixtures recorded at', new Date(now).toISOString());
