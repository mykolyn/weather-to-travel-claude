import { test, expect, TRIPS } from './helpers.mjs';

// Stand-in for GoatCounter's count.js: follows its documented settings (window.goatcounter.path)
// and records what it would send instead of sending it.
const STUB = `
  (function () {
    var s = window.goatcounter || {};
    var sent = window.__gcSent = [];
    function path() { return typeof s.path === 'function' ? s.path(location.pathname + location.search) : location.pathname + location.search; }
    window.goatcounter = Object.assign(s, { count: function (v) { sent.push(Object.assign({ path: path() }, v || {})); } });
    window.goatcounter.count();
  })();`;

async function enableAnalytics(context) {
  await context.route(/localhost:4173\/(\?.*)?$/, async route => {
    const res = await route.fetch();
    const html = (await res.text()).replace('name="wtt-goatcounter" content=""', 'name="wtt-goatcounter" content="test-site"');
    await route.fulfill({ response: res, body: html });
  });
  await context.route(/gc\.zgo\.at\/count\.js/, r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
}

test('analytics stay off until a GoatCounter code is set', async ({ page }) => {
  const calls = [];
  page.on('request', r => { if (/goatcounter|zgo\.at/.test(r.url())) calls.push(r.url()); });
  await page.goto('/');
  await page.waitForTimeout(1000);
  expect(calls).toEqual([]);
});

test('visits are counted by page only — trip details never leave the browser', async ({ page, context }) => {
  await enableAnalytics(context);
  await page.goto(TRIPS.sf);
  await expect(page.locator('#trip')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__gcSent || []).map(e => e.path))).toEqual(
    expect.arrayContaining(['/', 'event/opened-shared-link', 'event/plan']),
  );
  const sent = await page.evaluate(() => JSON.stringify(window.__gcSent));
  expect(sent).not.toMatch(/San|Jose|Francisco|from=|~/);
});
