import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`empty lobby fits the viewport including the safe area at ${width}px`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Safe-area emulation uses CDP.');
    await page.setViewportSize({ width, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: [] } }));
    await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今晚，还很安静。' })).toBeVisible();

    for (const bottom of [0, 34]) {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom } });
      // Resize in both directions to cover browser toolbar expansion/collapse.
      for (const height of [844, 600, 700, 844]) {
        await page.setViewportSize({ width, height });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
        await page.evaluate(() => scrollTo(0, 10000));
        await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThanOrEqual(1);
        const bounds = await page.getByRole('link', { name: '登录开播' }).boundingBox();
        const nav = await page.locator('.mobile-nav').boundingBox();
        expect(bounds!.y).toBeGreaterThan(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(nav!.y);
        await expect(page.getByRole('heading', { name: '直播', exact: true })).toHaveClass('sr-only');
        if (bottom === 34 && height === 600) {
          await page.screenshot({ path: test.info().outputPath(`compact-${width}.png`), fullPage: true });
        }
      }
    }
    await page.screenshot({ path: test.info().outputPath(`empty-${width}.png`), fullPage: true });
  });
}

test('a long lobby still scrolls to its final room above the action and navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  const rooms = Array.from({ length: 12 }, (_, index) => ({
    id: `scroll-room-${index}`, title: `电台 ${index + 1}`, status: '直播中', viewers: 1, canManage: false,
  }));
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: rooms } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(rooms.length);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const last = await page.getByRole('article', { name: '电台 12', exact: true }).boundingBox();
  const action = await page.getByRole('link', { name: '登录开播' }).boundingBox();
  const nav = await page.locator('.mobile-nav').boundingBox();
  expect(last!.y).toBeGreaterThanOrEqual(0);
  expect(last!.y + last!.height).toBeLessThanOrEqual(action!.y);
  expect(action!.y + action!.height).toBeLessThanOrEqual(nav!.y);
  await page.screenshot({ path: test.info().outputPath('long-list.png'), fullPage: false });
});
