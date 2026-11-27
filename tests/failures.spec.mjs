import { test, expect, TRIPS } from './helpers.mjs';

// Regression: on iOS Safari a slow forecast used to leave the spinner up forever, because Safari
// reports a fetch timeout as an AbortError and the app mistook it for a cancelled plan.

test('a forecast that never answers ends in a clear error, not an endless spinner', async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.route(/api\.open-meteo\.com/, () => { /* never respond */ });
  await page.goto(TRIPS.sf);
  await expect(page.locator('#loading')).toBeVisible();
  await expect(page.locator('#errorCard')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#errorText')).toContainText(/too long|slow/i);
  await expect(page.locator('#errorRetry')).toBeVisible();
});

test('a quota message from the forecast service is explained', async ({ page, context }) => {
  await context.route(/api\.open-meteo\.com/, r => r.fulfill({ json: { error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' } }));
  await page.goto(TRIPS.sf);
  await expect(page.locator('#errorCard')).toBeVisible();
  await expect(page.locator('#errorText')).toContainText('usage limit');
});

test('"Try again" re-plans after a failure', async ({ page, context }) => {
  let calls = 0;
  await context.route(/api\.open-meteo\.com/, r => (calls++ === 0 ? r.fulfill({ status: 500, body: 'oops' }) : r.fallback()));
  await page.goto(TRIPS.sf);
  await expect(page.locator('#errorCard')).toBeVisible();
  await page.locator('#errorRetry').click();
  await expect(page.locator('#trip')).toBeVisible();
  await expect(page.locator('#timeline button.stop-btn')).toHaveCount(4);
});
