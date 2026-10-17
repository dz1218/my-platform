import { expect, test } from '@playwright/test';

test.afterEach(async ({ request }) => { await request.post('http://127.0.0.1:18181/__performance', { data: {} }); });

test('document streams while slow authentication and novel requests overlap', async ({ page, request }, testInfo) => {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  await request.post('http://127.0.0.1:18181/__performance', { data: { delays: { '/api/v1/me': 2500, '/api/v1/novels/design-novel': 2500 } } });
  await page.goto('/novels/design-novel', { waitUntil: 'commit' });
  await expect(page.locator('[data-app-startup]')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toBeVisible();
  await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '雨停之前的来信', exact: true, level: 1 })).toBeVisible();
  const { requests } = await (await request.get('http://127.0.0.1:18181/__performance')).json();
  const user = requests.find((item: { path: string }) => item.path === '/api/v1/me');
  const novel = requests.find((item: { path: string }) => item.path === '/api/v1/novels/design-novel');
  expect(user.startedAt).toBeLessThan(novel.finishedAt);
  expect(novel.startedAt).toBeLessThan(user.finishedAt);
  await testInfo.attach('parallel-server-requests', { body: JSON.stringify({ user, novel }), contentType: 'application/json' });
});

for (const width of [390, 1440]) {
  test(`auth requests only the matching first image and one next scene at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const images: string[] = [];
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/_next/image?*', async route => {
      images.push(new URL(route.request().url()).searchParams.get('url') ?? '');
      if (images.length === 1) await held;
      await route.continue().catch(() => {});
    });
    try {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
      await expect.poll(() => images.length).toBe(1);
      expect(images[0]).toContain(width < 761 ? 'conversation.jpg' : 'messages-across-the-rain.png');
      release();
      await expect.poll(() => images.length).toBe(2);
      await page.locator('.auth-scene img').evaluateAll(async nodes => { await Promise.all(nodes.map(node => (node as HTMLImageElement).decode())); });
      expect(images).toHaveLength(2);
      expect(images[1]).toContain('radio-host.jpg');
      await testInfo.attach('image-requests', { body: JSON.stringify(images), contentType: 'application/json' });
      const bytes = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/_next/image?')).reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).encodedBodySize, 0));
      await testInfo.attach('auth-image-bytes', { body: JSON.stringify({ width, bytes }), contentType: 'application/json' });
    } finally { release(); }
  });
}

test('profile cover uses responsive optimized bytes', async ({ page }, testInfo) => {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [] } }));
  await page.goto('/me');
  const cover = page.locator('.profile-cover-media img');
  await cover.evaluate(image => (image as HTMLImageElement).decode());
  expect(await cover.evaluate(image => (image as HTMLImageElement).currentSrc)).toContain('/_next/image?');
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.name.includes('profile-moonlit-sea')).map(entry => ({ url: entry.name, bytes: (entry as PerformanceResourceTiming).encodedBodySize })));
  expect(resources.length).toBeGreaterThan(0);
  expect(Math.max(...resources.map(entry => entry.bytes))).toBeLessThan(400_000);
  await testInfo.attach('profile-cover-bytes', { body: JSON.stringify(resources), contentType: 'application/json' });
});
