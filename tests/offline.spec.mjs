import { test, expect, openTrip, TRIPS } from './helpers.mjs';

test.use({ serviceWorkers: 'allow' });

test('a trip you have opened still works with no signal', async ({ page, context }) => {
  await openTrip(page, TRIPS.sf);
  // Wait for the service worker to take control, then load once more so it caches the trip's data.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('#trip')).toBeVisible();
  const score = await page.locator('#scoreNum').innerText();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#trip')).toBeVisible();
  await expect(page.locator('#scoreNum')).toHaveText(score);
  await expect(page.locator('#timeline button.stop-btn')).toHaveCount(4);
});

test('case study page passes a basic check', async ({ page }) => {
  await page.goto('/case-study.html');
  await expect(page.locator('h1')).toContainText('forecast for the whole drive');
  await expect(page.locator('a.cs-cta')).toHaveAttribute('href', './');
});
