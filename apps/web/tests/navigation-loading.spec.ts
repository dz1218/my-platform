import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';
async function configure(request: APIRequestContext, config: object = {}) { await request.post(fixture, { data: config }); }
async function requests(request: APIRequestContext) { return (await (await request.get(fixture)).json()).requests as Array<{ path: string; startedAt: number; finishedAt: number | null }>; }
async function prepare(page: Page) {
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [], total: 0, nextPage: null, occupations: [] } }));
  await page.goto('/companion');
  await expect(page.getByRole('button', { name: '收起侧边栏' })).toBeVisible();
}

test.beforeEach(async ({ request }) => { await configure(request); });
test.afterEach(async ({ request }) => { await configure(request); });

for (const prefetched of [false, true]) {
  test(`production navigation with ${prefetched ? 'available' : 'blocked'} prefetch`, async ({ page, request }, testInfo) => {
    test.skip(!testInfo.config.configFile?.includes('production'), 'Default Link prefetch runs in the production build.');
    await page.route('**/live?*', route => route.request().headers()['next-router-prefetch'] === '1' && !prefetched ? route.abort() : route.continue());
    const prefetch = prefetched ? page.waitForResponse(response => new URL(response.url()).pathname === '/live' && response.request().headers()['next-router-prefetch'] === '1') : null;
    await prepare(page);
    // A dynamic route prefetch streams its loading boundary; waiting for the
    // whole response to close would also wait for deferred page content.
    if (prefetch) expect((await prefetch).ok()).toBe(true);
    await configure(request, { delays: { '/api/v1/rooms': 2500 } });
    const target = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '直播', exact: true });
    await target.click();
    await expect(target).toHaveClass(/nav-item-active/);
    await expect(page.locator('[data-page-skeleton="live"]')).toBeVisible();
    await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
    await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  });
}

for (const width of [390, 768, 1440]) {
  test(`navigation responds before slow SSR at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [], total: 0, nextPage: null, occupations: [] } }));
    await page.goto('/companion');
    const nav = page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true });
    await expect(nav).toBeVisible();
    await configure(request, { delays: { '/api/v1/rooms': 2500 } });
    const target = nav.getByRole('link', { name: '直播', exact: true });
    // Capture feedback from the click event itself, excluding Playwright auto-waits.
    await page.evaluate(() => {
      document.addEventListener('click', () => {
        const start = performance.now();
        document.documentElement.dataset.navigationStartedAt = String(start);
        const observer = new MutationObserver(() => {
          if (document.querySelector('[data-navigation-pending="/live"], [data-page-skeleton="live"]')) {
            document.documentElement.dataset.navigationFeedbackMs = String(performance.now() - start);
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      }, { once: true, capture: true });
    });
    await target.click();
    await expect(target).toHaveClass(/nav-item-active/);
    await expect(page.locator('[data-page-skeleton="live"]')).toBeVisible();
    const feedbackMs = await page.evaluate(() => Number(document.documentElement.dataset.navigationFeedbackMs));
    expect(feedbackMs).toBeLessThan(200);
    await expect.poll(async () => (await requests(request)).some(r => r.path === '/api/v1/rooms' && r.finishedAt === null)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`loading-${width}.png`) });
    await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
    const contentReadyMs = await page.evaluate(() => performance.now() - Number(document.documentElement.dataset.navigationStartedAt));
    await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach('navigation-timing', { body: JSON.stringify({ width, feedbackMs, contentReadyMs, requests: await requests(request) }), contentType: 'application/json' });
  });
}

test('latest navigation wins and history restores the selected tab', async ({ page, request }) => {
  await prepare(page);
  await configure(request, { delays: { '/api/v1/rooms': 2500, '/api/v1/novels': 1800 } });
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await nav.getByRole('link', { name: '直播', exact: true }).click();
  await nav.getByRole('link', { name: '小说', exact: true }).click();
  await expect(nav.getByRole('link', { name: '小说', exact: true })).toHaveClass(/nav-item-active/);
  await expect(page.getByText('暂无小说', { exact: true })).toBeVisible();
  await expect(page).toHaveURL('/novels');
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  await expect(nav.locator('[aria-current="page"]')).toHaveClass(/nav-item-active/);
  await page.goForward();
  await expect(page).toHaveURL('/novels');
  await expect(nav.getByRole('link', { name: '小说', exact: true })).toHaveClass(/nav-item-active/);
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
});

test('current-page clicks and cancellation cannot leave a stale overlay', async ({ page, request }) => {
  await prepare(page);
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  const companion = nav.getByRole('link', { name: '陪伴', exact: true });
  await companion.click();
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  await configure(request, { delays: { '/api/v1/rooms': 2500 } });
  await nav.getByRole('link', { name: '直播', exact: true }).click();
  await companion.click();
  await expect(page).toHaveURL('/companion');
  await expect(page.getByRole('heading', { name: '今天想和谁聊聊？' })).toBeVisible();
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  await expect(companion).toHaveClass(/nav-item-active/);
  // The abandoned server response must not change the selected destination.
  await expect.poll(async () => (await requests(request)).every(r => r.finishedAt !== null)).toBe(true);
  await expect(page).toHaveURL('/companion');
  await expect(companion).toHaveAttribute('aria-current', 'page');
});

test('keyboard navigation and reduced motion retain immediate feedback', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await configure(request, { delays: { '/api/v1/rooms': 2500 } });
  const target = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '直播', exact: true });
  await target.focus();
  await target.press('Enter');
  await expect(target).toHaveClass(/nav-item-active/);
  const skeleton = page.locator('[data-page-skeleton="live"]');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator('.motion-safe\\:animate-pulse').first()).toHaveCSS('animation-name', 'none');
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
});

test('guest skips authentication requests and fresh lobby data is not fetched twice', async ({ page, request }) => {
  await page.goto('/live');
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
  const reads = await requests(request);
  expect(reads.filter(r => r.path === '/api/v1/me')).toHaveLength(0);
  expect(reads.filter(r => r.path === '/api/v1/rooms')).toHaveLength(1);
});

test('repeat navigation reuses warm data without a lingering loading state', async ({ page, request }, testInfo) => {
  await prepare(page);
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  const timings: Array<{ visit: string; contentReadyMs: number; roomReads: number }> = [];
  for (const visit of ['first', 'repeat']) {
    await nav.getByRole('link', { name: '直播', exact: true }).evaluate(link => {
      link.addEventListener('click', () => { document.documentElement.dataset.navigationStartedAt = String(performance.now()); }, { once: true });
    });
    await nav.getByRole('link', { name: '直播', exact: true }).click();
    await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
    await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
    timings.push({ visit, contentReadyMs: await page.evaluate(() => performance.now() - Number(document.documentElement.dataset.navigationStartedAt)), roomReads: (await requests(request)).filter(r => r.path === '/api/v1/rooms').length });
    if (visit === 'first') {
      await nav.getByRole('link', { name: '小说', exact: true }).click();
      await expect(page.getByText('暂无小说', { exact: true })).toBeVisible();
    }
  }
  await testInfo.attach('first-repeat-navigation', { body: JSON.stringify(timings), contentType: 'application/json' });
});

test('errors and login redirects release navigation feedback', async ({ page, request }) => {
  await prepare(page);
  await configure(request, { delays: { '/api/v1/novels': 800 }, failures: { '/api/v1/novels': 503 } });
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '小说', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂时无法完成操作' })).toBeVisible();
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  await configure(request);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('暂无小说', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: '手机主导航' }).getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
});
