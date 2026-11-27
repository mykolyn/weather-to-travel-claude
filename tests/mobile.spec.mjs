import { test, expect, openTrip, TRIPS } from './helpers.mjs';

test('phone layout: swipe strip, no sideways scroll', async ({ page }) => {
  await openTrip(page, TRIPS.tahoe);
  await expect(page.locator('#strip')).toBeVisible();
  await expect(page.locator('.strip-card')).toHaveCount(await page.locator('#timeline button.stop-btn').count());
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
});
