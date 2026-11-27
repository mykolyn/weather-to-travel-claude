import AxeBuilder from '@axe-core/playwright';
import { test, expect, openTrip, TRIPS } from './helpers.mjs';

test.describe('planning a trip', () => {
  test('sample chip plans a drive with a score, timeline and map', async ({ page }) => {
    await page.goto('/');
    await page.locator('.samples .chip[data-sample="0"]').click();
    await expect(page.locator('#trip')).toBeVisible();
    await expect(page.locator('#tripFrom')).toHaveText('San Jose');
    await expect(page.locator('#tripTo')).toHaveText('San Francisco');
    await expect(page.locator('#scoreNum')).toHaveText(/^\d{1,3}$/);
    await expect(page.locator('#verdictTitle')).not.toHaveText('—');
    await expect(page.locator('#timeline button.stop-btn')).toHaveCount(4);
    await expect(page.locator('#optBars .bar').first()).toBeVisible();
    await expect(page).toHaveURL(/from=San\+Jose/);
  });

  test('place search suggests matches', async ({ page }) => {
    await page.goto('/');
    await page.fill('#fromInput', 'Moab');
    const first = page.locator('#fromList [role=option]').first();
    await expect(first).toContainText('Moab');
    await first.click();
    await expect(page.locator('#fromInput')).toHaveValue(/Moab/);
  });

  test('no road between two places shows a clear error', async ({ page }) => {
    await page.goto(TRIPS.noroute);
    await expect(page.locator('#errorCard')).toBeVisible();
    await expect(page.locator('#errorTitle')).toHaveText('No road between those two');
  });

  test('falls back to the backup router when OSRM is down', async ({ page, context }) => {
    await context.route(/router\.project-osrm\.org/, r => r.abort());
    await openTrip(page, TRIPS.sf);
    await expect(page.locator('#timeline button.stop-btn')).toHaveCount(4);
  });
});

test.describe('trip controls', () => {
  test('compares routes and switches between them', async ({ page }) => {
    await openTrip(page, TRIPS.tahoe);
    const cards = page.locator('.route-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveClass(/\bon\b/);
    await expect(page.locator('.route-card em', { hasText: 'Fastest' })).toHaveCount(1);
    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveClass(/\bon\b/);
    await expect(page).toHaveURL(/route=1/);
  });

  test('rest stops lengthen the drive and appear in the timeline', async ({ page }) => {
    await openTrip(page, TRIPS.tahoe);
    const before = await page.locator('#statTime').innerText();
    await page.locator('#breaksSeg [data-breaks="short"]').click();
    await expect(page.locator('#statTime')).not.toHaveText(before);
    await expect(page.locator('#statTime')).toContainText('incl. 2 breaks');
    await expect(page.locator('.stop-break:not(.stop-sun)')).toHaveCount(2);
    await expect(page).toHaveURL(/breaks=short/);
    // Units are untouched by the breaks control (regression).
    await expect(page.locator('.seg-btn[data-units="imperial"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('units toggle converts temperatures and distances', async ({ page }) => {
    await openTrip(page, TRIPS.sf);
    const f = Number((await page.locator('.stop-temp').first().innerText()).replace('°', ''));
    await page.locator('.seg-btn[data-units="metric"]').click();
    const c = Number((await page.locator('.stop-temp').first().innerText()).replace('°', ''));
    expect(Math.abs(c - (f - 32) * 5 / 9)).toBeLessThanOrEqual(1);
    await expect(page.locator('#statDist')).toContainText('kilometres');
  });

  test('choosing a departure hour re-plans instantly', async ({ page }) => {
    await openTrip(page, TRIPS.sf);
    const before = await page.locator('#statLeave').innerText();
    await page.locator('#optBars .bar').nth(10).click();
    await expect(page.locator('#statLeave')).not.toHaveText(before);
    await expect(page.locator('#optBars .bar').nth(10)).toHaveClass(/\bsel\b/);
  });

  test('a shared link restores the route and breaks', async ({ page }) => {
    await openTrip(page, `${TRIPS.tahoe}&route=1&breaks=long`);
    await expect(page.locator('.route-card').nth(1)).toHaveClass(/\bon\b/);
    await expect(page.locator('#breaksSeg [data-breaks="long"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('trip poster renders and can be downloaded', async ({ page }) => {
    await openTrip(page, TRIPS.sf);
    await page.locator('#posterBtn').click();
    await expect(page.locator('#posterDialog')).toBeVisible();
    await expect.poll(() => page.locator('#posterImg').evaluate(img => img.naturalWidth)).toBe(1080);
    await expect(page.locator('#posterDownload')).toHaveAttribute('download', 'san-jose-to-san-francisco.png');
  });
});

test.describe('official alerts', () => {
  test.use({ alerts: { minLat: 38.6 } });
  test('alerts in force at your ETA lower the score and are called out', async ({ page }) => {
    await openTrip(page, TRIPS.tahoe);
    await expect(page.locator('.tip-nws')).toContainText('Winter Storm Warning');
    await expect(page.locator('.stop-flag', { hasText: 'winter storm warning' }).first()).toBeVisible();
    expect(Number(await page.locator('#scoreNum').innerText())).toBeLessThanOrEqual(40);
  });
});

test.describe('accessibility', () => {
  const audit = async page => {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).exclude('#map').analyze();
    return res.violations.filter(v => ['serious', 'critical'].includes(v.impact))
      .map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 4).join(' | ')}`);
  };
  test('landing page has no serious violations', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')));
    await page.waitForTimeout(1200);
    expect(await audit(page)).toEqual([]);
  });
  test('case study has no serious violations', async ({ page }) => {
    await page.goto('/case-study.html');
    await page.waitForTimeout(800);
    expect(await audit(page)).toEqual([]);
  });
  test('results in dark mode have no serious violations', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTrip(page, TRIPS.tahoe);
    await page.waitForTimeout(1200);
    expect(await audit(page)).toEqual([]);
  });
  test('results have no serious violations', async ({ page }) => {
    await openTrip(page, TRIPS.tahoe);
    await page.waitForTimeout(1200);
    expect(await audit(page)).toEqual([]);
  });
});
