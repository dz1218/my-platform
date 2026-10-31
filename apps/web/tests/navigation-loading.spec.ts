import { expect, test, type Page, type Locator, type APIRequestContext, type Request, type WebSocketRoute } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';
async function configure(request: APIRequestContext, config: object = {}) { await request.post(fixture, { data: config }); }
async function requests(request: APIRequestContext) { return (await (await request.get(fixture)).json()).requests as Array<{ path: string; method: string; startedAt: number; finishedAt: number | null; abortedAt: number | null }>; }
async function visibleBounds(locator: Locator) {
  await expect(locator).toBeVisible();
  // Streaming can replace a node between visibility and measurement. Locator
  // evaluation retries a detached node instead of returning a null box.
  return locator.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}
async function prepare(page: Page) {
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [], total: 0, nextPage: null, occupations: [] } }));
  await page.goto('/companion');
  await expect(page.getByRole('button', { name: '收起侧边栏' })).toBeVisible();
  // The viewport-specific catalog controls appear only after hydration. A visible
  // SSR nav alone can still follow a native document link before React attaches.
  await expect(page.getByRole('searchbox', { name: '搜索名字', exact: true })).toBeVisible();
}

test.beforeEach(async ({ request }) => { await configure(request); });
test.afterEach(async ({ request }) => { await configure(request); });

for (const prefetched of [false, true]) {
  test(`production navigation with ${prefetched ? 'available' : 'blocked'} prefetch`, async ({ page, request }, testInfo) => {
    test.skip(!testInfo.config.configFile?.includes('production'), 'Default Link prefetch runs in the production build.');
    await page.route(url => url.pathname === '/' && url.searchParams.has('_rsc'), route => route.request().headers()['next-router-prefetch'] === '1' && !prefetched ? route.abort() : route.continue());
    const prefetch = prefetched ? page.waitForResponse(response => new URL(response.url()).pathname === '/' && response.request().headers()['next-router-prefetch'] === '1') : null;
    await prepare(page);
    // A dynamic route prefetch streams its loading boundary; waiting for the
    // whole response to close would also wait for deferred page content.
    if (prefetch) expect((await prefetch).ok()).toBe(true);
    await configure(request, { delays: { '/api/v1/rooms': 2500 } });
    const target = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '直播', exact: true });
    await target.click();
    await expect(target).toHaveClass(/nav-item-active/);
    await expect(page.getByRole('status', { name: '正在加载直播间…', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: '搜索直播间' })).toBeVisible();
    await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
    await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
    await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  });
}

for (const width of [390, 768, 1440]) {
  test(`navigation and page controls respond before slow list data at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [], total: 0, nextPage: null, occupations: [] } }));
    await page.goto('/companion');
    const nav = page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('searchbox', { name: '姓名', exact: true })).toBeVisible();
    await configure(request, { delays: { '/api/v1/rooms': 2500 } });
    const target = nav.getByRole('link', { name: '直播', exact: true });
    // Capture feedback from the click event itself, excluding Playwright auto-waits.
    await page.evaluate(() => {
      document.addEventListener('click', () => {
        const start = performance.now();
        document.documentElement.dataset.navigationStartedAt = String(start);
        const observer = new MutationObserver(() => {
          if (document.querySelector('nav a[href="/"][data-pending="true"], [role="status"][aria-label="正在加载直播间…"]')) {
            document.documentElement.dataset.navigationFeedbackMs = String(performance.now() - start);
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      }, { once: true, capture: true });
    });
    await target.click();
    await expect(target).toHaveClass(/nav-item-active/);
    const loading = page.getByRole('region', { name: '直播间列表', exact: true }).getByRole('status', { name: '正在加载直播间…', exact: true });
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('data-skeleton', 'rooms');
    await expect(loading).toHaveCSS('position', 'static');
    const search = page.getByRole('searchbox', { name: '搜索直播间' });
    await search.fill('等待中的搜索');
    await expect(search).toHaveValue('等待中的搜索');
    await search.clear();
    await target.click({ trial: true });
    const searchBox = (await search.boundingBox())!;
    const skeletonBox = (await loading.boundingBox())!;
    expect(skeletonBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
    await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
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

for (const width of [390, 1440]) {
  for (const kind of ['catalog', 'bookshelf'] as const) {
    test(`the first ${kind} load shows content skeletons and keeps controls usable at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      let release = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      const isCatalog = kind === 'catalog';
      await page.route(isCatalog ? '**/api/v1/discover?*' : '**/api/v1/novels', async route => {
        await held;
        await route.fulfill({ json: isCatalog ? { items: [], total: 0, nextPage: null, occupations: [] } : { items: [] } }).catch(() => {});
      });
      try {
        await page.goto(isCatalog ? '/companion?view=discover' : '/novels');
        const loading = page.getByRole('status', { name: isCatalog ? '正在寻找可以认识的人…' : '正在加载书架…', exact: true });
        await expect(loading).toBeVisible();
        await expect(loading).toHaveAttribute('data-skeleton', kind);
        await expect(loading).toHaveCSS('position', 'static');
        await expect(loading.locator('svg')).toHaveCount(0);
        await expect(loading.locator('[aria-hidden="true"]').first()).toHaveCSS('animation-name', 'pulse');
        await expect(page.getByRole('main').locator('[data-loading-overlay]')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole('heading', { name: isCatalog ? '这里的朋友' : '书架', exact: true })).toBeVisible();
        const nav = page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true });
        await expect(nav).toBeVisible();
        if (isCatalog) await page.getByRole('searchbox', { name: '姓名', exact: true }).click({ trial: true });
        await page.screenshot({ path: testInfo.outputPath(`${kind}-skeleton-${width}.png`) });
        release();
        await expect(loading).toHaveCount(0);
        await expect(page.getByText(isCatalog ? '没有找到符合条件的朋友，试试其他筛选条件。' : '暂无小说', { exact: true })).toBeVisible();
      } finally { release(); }
    });
  }
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

test('current-page clicks and cancellation clear navigation feedback', async ({ page, request }) => {
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
  // Both a completed stale response and a request aborted on unmount are terminal.
  // Neither may change the selected destination after cancellation.
  await expect.poll(async () => (await requests(request)).every(r => r.finishedAt !== null || r.abortedAt != null)).toBe(true);
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
  const loading = page.getByRole('status', { name: '正在加载直播间…', exact: true });
  await expect(loading).toBeVisible();
  await expect(loading.locator('[aria-hidden="true"]').first()).toHaveCSS('animation-name', 'none');
  await expect(page.getByRole('searchbox', { name: '搜索直播间' })).toBeVisible();
  await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
});

test('guest skips authentication requests and fresh lobby data is not fetched twice', async ({ page, request }) => {
  await page.goto('/');
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
  await expect(page.getByRole('main').getByRole('alert')).toContainText('书架暂时加载失败');
  await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
  await configure(request);
  await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('暂无小说', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: '手机主导航' }).getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
  await expect(page.locator('[data-navigation-pending]')).toHaveCount(0);
});


async function signIn(page: Page) {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
}

for (const width of [1440]) {
  test(`recent chats keep their loading frame through account resolution and reload at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await signIn(page);
    await configure(request, { delays: { '/api/v1/me': 3000 } });
    await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [], total: 0, nextPage: null, occupations: [] } }));
    await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let scriptsHeld: Promise<void>;
    let chatsHeld: Promise<void>;
    await page.route('**/_next/static/**', async route => {
      if (route.request().resourceType() === 'script') await scriptsHeld;
      await route.continue().catch(() => {});
    });
    await page.route('**/api/v1/matches', async route => {
      await chatsHeld;
      await route.fulfill({ json: { items: [{ id: 'startup-match', conversationId: 'startup-conversation', identity: { id: 'startup-friend', name: '林晚', age: 26, gender: 'FEMALE', avatarUrl: '' } }] } }).catch(() => {});
    });
    for (const phase of ['visit', 'reload']) {
      let releaseScripts = () => {};
      let releaseChats = () => {};
      scriptsHeld = new Promise<void>(resolve => { releaseScripts = resolve; });
      chatsHeld = new Promise<void>(resolve => { releaseChats = resolve; });
      try {
        if (phase === 'visit') await page.goto('/companion?view=recent', { waitUntil: 'commit' });
        else await page.reload({ waitUntil: 'commit' });
        const startup = page.locator('[data-app-startup]:visible');
        await expect(startup).toBeVisible();
        const recent = page.getByRole('main').getByRole('region', { name: width < 768 ? /^接着上次的故事/ : /^最近聊天/ });
        const loading = recent.getByRole('status', { name: '正在加载聊天…', exact: true });
        await expect(loading).toBeVisible({ timeout: 1500 });
        await expect(loading).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByRole('button', { name: '刷新最近聊天', exact: true })).toBeDisabled();
        const footer = recent.getByText('也可以换一种方式放松', { exact: true });
        await expect(footer).toBeVisible();
        const firstLoadingBox = await visibleBounds(loading);
        const firstFooterBox = await visibleBounds(footer);
        await page.screenshot({ path: testInfo.outputPath(`recent-${phase}-startup-${width}.png`) });

        releaseScripts();
        await expect(startup).toHaveCount(0, { timeout: 10_000 });
        // The account boundary can disappear one render before viewport
        // hydration swaps its presentation. Wait for the live page controls.
        if (width < 768) await expect(page.getByRole('navigation', { name: '陪伴内容' }).getByRole('button', { name: '最近聊天', exact: true })).toBeEnabled();
        else await expect(page.getByRole('button', { name: '筛选', exact: true })).toBeEnabled();
        await expect(loading).toBeVisible();
        // Authentication and hydration must not resize or replace the waiting
        // panel; only the eventual chat data should change its content.
        const hydratedLoadingBox = await visibleBounds(loading);
        const hydratedFooterBox = await visibleBounds(footer);
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(Math.abs(hydratedLoadingBox[key] - firstLoadingBox[key])).toBeLessThanOrEqual(1);
          expect(Math.abs(hydratedFooterBox[key] - firstFooterBox[key])).toBeLessThanOrEqual(1);
        }
        releaseChats();
        await expect(recent.getByRole('link', { name: /林晚/ })).toBeVisible();
        await expect(loading).toHaveCount(0);
        await expect(page.getByRole('button', { name: '刷新最近聊天', exact: true })).toBeEnabled();
      } finally {
        releaseScripts();
        releaseChats();
      }
    }
    expect(errors).toEqual([]);
  });
}

test('slow account resolution keeps the themed navigation shell on profile refresh', async ({ page, request }, testInfo) => {
  await signIn(page);
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [] } }));
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  await configure(request, { delays: { '/api/v1/me': 2500 } });
  await page.goto('/me', { waitUntil: 'commit' });
  const startup = page.locator('[data-app-startup]');
  await expect(startup).toBeVisible();
  await expect(startup.locator('.profile-cover-media img')).toBeVisible();
  await expect(startup.locator('[data-profile-details]')).toBeVisible();
  await expect(startup.getByRole('tablist', { name: '个人主页内容' })).toBeVisible();
  await expect(startup.getByRole('tab', { name: '最近聊天', exact: true })).toBeDisabled();
  await expect(startup.getByRole('tab', { name: 'AI 身份', exact: true })).toBeDisabled();
  await expect(startup.getByRole('main').getByRole('status', { name: '正在加载账户…', exact: true })).toHaveAttribute('data-skeleton', 'profile');
  await expect(startup.locator('[data-skeleton="conversations"]')).toBeVisible();
  await expect(startup.getByRole('main').locator('[data-loading-overlay]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '我的', exact: true })).toBeVisible();
  await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '登录 / 注册', exact: true })).toHaveCount(0);
  await expect(startup).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await page.screenshot({ path: testInfo.outputPath('profile-account-loading.png') });
  await expect(page.getByRole('heading', { name: '继承测试用户', exact: true })).toBeVisible();
  await expect(startup).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '最近聊天', exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'commit' });
  await expect(startup).toBeVisible();
  await expect(startup.locator('[data-skeleton="profile"]')).toBeVisible();
  await expect(startup.locator('[data-skeleton="conversations"]')).toBeVisible();
  await expect(startup.locator('.profile-cover-media img')).toBeVisible();
  await expect(startup.getByRole('tablist', { name: '个人主页内容' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '继承测试用户', exact: true })).toBeVisible();
});

for (const width of [390, 1440]) {
  for (const tab of ['companion', 'live', 'novels', 'me'] as const) {
    test(`the first streamed ${tab} frame retains its page structure before JavaScript at ${width}px`, async ({ page, request }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page);
      await configure(request, { delays: { '/api/v1/me': 5000 } });
      await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [] } }));
      await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [], total: 0, nextPage: null, occupations: [] } }));
      await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      let release = () => {};
      const scriptsHeld = new Promise<void>(resolve => { release = resolve; });
      let blockedScripts = 0;
      await page.route('**/_next/static/**', async route => {
        if (route.request().resourceType() === 'script') {
          blockedScripts++;
          await scriptsHeld;
        }
        await route.continue().catch(() => {});
      });
      try {
        // Deliberately inspect streamed HTML before hydration can replace it.
        await page.goto(tab === 'live' ? '/' : `/${tab}`, { waitUntil: 'commit' });
        const startup = page.locator('[data-app-startup]:visible');
        await expect(startup).toBeVisible();
        await expect.poll(() => blockedScripts).toBeGreaterThan(0);
        const nav = startup.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true });
        await expect(nav).toBeVisible();
        const active = nav.locator('[aria-current="page"]');
        await expect(active).toHaveAttribute('href', tab === 'live' ? '/' : `/${tab}`);
        expect(await active.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
        })).toBe(true);
        await expect(startup.getByRole('link', { name: '登录 / 注册', exact: true })).toHaveCount(0);
        await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);

        const main = startup.getByRole('main');
        const label = { companion: '正在加载页面…', live: '正在加载直播间…', novels: '正在加载书架…', me: '正在加载账户…' }[tab];
        const loading = main.getByRole('status', { name: label, exact: true });
        await expect(loading).toHaveAttribute('data-skeleton', { companion: 'catalog', live: 'rooms', novels: 'bookshelf', me: 'profile' }[tab]);
        await expect(main.locator('[data-loading-overlay]')).toHaveCount(0);
        let frameBottom: number;
        if (tab === 'me') {
          await expect(main.locator('.profile-cover-media img')).toBeVisible();
          await expect(main.locator('[data-profile-details]')).toBeVisible();
          const tabs = main.getByRole('tablist', { name: '个人主页内容' });
          await expect(tabs).toBeVisible();
          await expect(tabs.getByRole('tab', { name: '最近聊天', exact: true })).toBeDisabled();
          await expect(tabs.getByRole('tab', { name: 'AI 身份', exact: true })).toBeDisabled();
          const details = (await main.locator('[data-profile-details]').boundingBox())!;
          const skeleton = (await loading.boundingBox())!;
          expect(skeleton.x).toBeGreaterThanOrEqual(details.x);
          expect(skeleton.x + skeleton.width).toBeLessThanOrEqual(details.x + details.width + 1);
          expect(skeleton.y + skeleton.height).toBeLessThanOrEqual(details.y + details.height + 1);
          frameBottom = details.y;
        } else {
          const title = tab === 'companion' ? width < 768 ? '发现朋友' : '今天想和谁聊聊？' : tab === 'live' ? width < 768 ? '直播' : '直播大厅' : '小说';
          if (tab === 'novels') await expect(main.getByRole('heading', { name: title, exact: true, level: 1 })).toHaveClass('sr-only');
          else await expect(main.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
          if (tab === 'companion' && width < 768) {
            await expect(main.getByRole('navigation', { name: '陪伴内容', exact: true })).toHaveCount(0);
            const search = main.getByRole('searchbox', { name: '姓名', exact: true });
            await expect(search).toBeDisabled();
            await expect(main.getByRole('button', { name: '筛选朋友', exact: true })).toBeDisabled();
            const bounds = (await search.boundingBox())!;
            frameBottom = bounds.y + bounds.height;
          } else if (tab === 'live' && width < 768) {
            // Mobile opens with room controls rather than the desktop scene.
            await expect(main.locator('[data-mobile-page="live"]')).toBeVisible();
            await expect(main.getByRole('region', { name: '深夜电台', exact: true })).toHaveCount(0);
            await expect(main.getByRole('button', { name: '我的直播间', exact: true })).toBeDisabled();
            const directory = main.getByRole('region', { name: '直播间列表', exact: true });
            await expect(directory).toBeVisible();
            await expect(directory.getByRole('button', { name: '刷新列表', exact: true })).toBeDisabled();
            for (const name of ['全部', '直播中', '准备中']) {
              await expect(directory.getByRole('button', { name, exact: true })).toBeDisabled();
            }
            await expect(directory.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
            const bounds = (await directory.getByRole('button', { name: '准备中', exact: true }).boundingBox())!;
            frameBottom = bounds.y + bounds.height;
          } else if (tab === 'novels') {
            await expect(main.getByRole('region', { name: '故事漫游', exact: true })).toHaveCount(0);
            const shelfHeading = main.getByRole('heading', { name: '书架', exact: true });
            const bounds = (await shelfHeading.boundingBox())!;
            frameBottom = bounds.y + bounds.height;
          } else {
            const scene = main.getByRole('region', { name: tab === 'companion' ? '温暖陪伴' : tab === 'live' ? '深夜电台' : '故事漫游', exact: true });
            await expect(scene).toBeVisible();
            const bounds = (await scene.boundingBox())!;
            frameBottom = bounds.y + bounds.height;
          }
          if (tab === 'companion' && width >= 768) {
            await expect(main.getByRole('heading', { name: '这里的朋友', exact: true })).toBeVisible();
            await expect(main.getByRole('searchbox', { name: '姓名', exact: true })).toBeDisabled();
          }
          if (tab === 'live') await expect(main.getByRole('searchbox', { name: '搜索直播间', exact: true })).toBeDisabled();
          if (tab === 'novels') await expect(main.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
        }
        const loadingBox = (await loading.boundingBox())!;
        expect(loadingBox.y).toBeGreaterThanOrEqual(frameBottom);
        await page.screenshot({ path: testInfo.outputPath(`first-frame-${tab}-${width}.png`) });

        release();
        // The fixture holds authentication for 5 seconds; allow its response
        // and the deliberately paused scripts to finish, then require removal.
        await expect(startup).toHaveCount(0, { timeout: 10_000 });
        await expect(page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true })).toBeVisible();
        if (tab === 'me') await expect(page.getByRole('heading', { name: '继承测试用户', exact: true })).toBeVisible();
        else if (tab === 'companion') await expect(page.getByRole('searchbox', { name: '姓名', exact: true })).toBeEnabled();
        else if (tab === 'live') await expect(page.getByRole('searchbox', { name: '搜索直播间', exact: true })).toBeEnabled();
        else if (width < 768) {
          await expect(page.getByRole('button', { name: '刷新小说', exact: true })).toHaveCount(0);
          await expect(page.getByRole('button', { name: '刷新当前页面', exact: true })).toBeEnabled();
        } else {
          await expect(page.getByRole('button', { name: '刷新小说', exact: true })).toHaveCount(0);
          await expect(page.getByRole('link', { name: '创建小说', exact: true })).toBeVisible();
        }
        expect(errors).toEqual([]);
      } finally { release(); }
    });
  }
}

test('profile waits for conversations inside the page while its cover and tabs remain available', async ({ page }, testInfo) => {
  await signIn(page);
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/matches', async route => {
    await held;
    await route.fulfill({ json: { items: [] } }).catch(() => {});
  });
  try {
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: '继承测试用户', exact: true })).toBeVisible();
    await expect(page.locator('.profile-cover-media')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'AI 身份', exact: true })).toBeVisible();
    const panel = page.getByRole('tabpanel', { name: '最近聊天', exact: true });
    const loading = panel.getByRole('status', { name: '正在加载聊天…', exact: true });
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('data-skeleton', 'conversations');
    const tabBox = (await page.getByRole('tab', { name: 'AI 身份', exact: true }).boundingBox())!;
    expect((await loading.boundingBox())!.y).toBeGreaterThanOrEqual(tabBox.y + tabBox.height);
    await page.screenshot({ path: testInfo.outputPath('profile-list-loading.png') });
    await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
    await page.getByRole('tab', { name: 'AI 身份', exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(loading).toBeHidden();
    await expect(page.getByRole('link', { name: '选择 AI 身份', exact: true })).toBeVisible();
  } finally { release(); }
});

test('four tabs reuse ordinary data and one account subscription until an explicit refresh', async ({ page, request }, testInfo) => {
  await signIn(page);
  const identity = { id: 'cached-friend', name: '林晚', age: 26, city: '杭州', gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' };
  const match = { id: 'cached-match', conversationId: 'cached-conversation', identity };
  let discoveryReads = 0;
  let matchesReads = 0;
  let accountConnections = 0;
  const activeAccountConnections = new Set<WebSocketRoute>();
  await page.route('**/api/v1/discover?*', route => {
    discoveryReads++;
    return route.fulfill({ json: { items: [identity], total: 1, page: 1, nextPage: null, occupations: [] } });
  });
  await page.route('**/api/v1/matches', route => {
    matchesReads++;
    return route.fulfill({ json: { items: [match] } });
  });
  await page.routeWebSocket('**/api/v1/matches/socket?*', socket => {
    accountConnections++;
    activeAccountConnections.add(socket);
    socket.onClose(() => { activeAccountConnections.delete(socket); });
  });
  await page.goto('/companion');
  await expect(page.getByRole('link', { name: /继续聊天\s*，和林晚/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  for (const label of ['我的', '小说', '直播']) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    if (label === '我的') await expect(page.getByRole('link', { name: '继续和林晚聊天', exact: true })).toBeVisible();
    if (label === '小说') await expect(page.getByRole('heading', { name: '雨停之前的来信', exact: true })).toBeVisible();
    if (label === '直播') await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
  }
  const initial = await requests(request);
  const ordinaryReads = (items: Awaited<ReturnType<typeof requests>>) => items.filter(item => item.method === 'GET' && ['/api/v1/me', '/api/v1/novels'].includes(item.path));
  expect(ordinaryReads(initial).filter(item => item.path === '/api/v1/me')).toHaveLength(1);
  expect(ordinaryReads(initial).filter(item => item.path === '/api/v1/novels')).toHaveLength(1);
  expect(discoveryReads).toBe(1);
  expect(matchesReads).toBe(1);
  await expect.poll(() => activeAccountConnections.size).toBe(1);
  const initialConnections = accountConnections;
  if (testInfo.config.configFile?.includes('production')) expect(initialConnections).toBe(1);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => requestAnimationFrame(() => {
      const boundary = Array.from(document.querySelectorAll('[data-page-loading], [data-loading-overlay], [data-skeleton]')).find(element =>
        element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden');
      if (boundary) document.documentElement.dataset.cachedLoadingFrame = boundary.getAttribute('data-page-loading') ?? boundary.getAttribute('aria-label') ?? 'unknown';
    }));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
    document.addEventListener('stop-loading-observer', () => observer.disconnect(), { once: true });
  });
  for (const label of ['陪伴', '我的', '小说', '直播', '小说']) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${({ 陪伴: 'companion', 我的: 'me', 小说: 'novels', 直播: '' } as Record<string, string>)[label]}(?:\\?.*)?$`));
    await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
  }
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  // Let focus/reconnect subscriptions process; these must not schedule ordinary reads.
  await page.waitForTimeout(400);
  await expect(page.getByRole('heading', { name: '雨停之前的来信', exact: true })).toBeVisible();
  expect(ordinaryReads(await requests(request))).toHaveLength(ordinaryReads(initial).length);
  expect(discoveryReads).toBe(1);
  expect(matchesReads).toBe(1);
  expect(accountConnections).toBe(initialConnections);
  expect(activeAccountConnections.size).toBe(1);
  expect(await page.evaluate(() => {
    document.dispatchEvent(new Event('stop-loading-observer'));
    return document.documentElement.dataset.cachedLoadingFrame ?? null;
  })).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  const refresh = page.getByRole('button', { name: '刷新当前页面', exact: true });
  await refresh.focus();
  await refresh.press('Enter');
  await expect.poll(async () => (await requests(request)).filter(item => item.method === 'GET' && item.path === '/api/v1/novels').length).toBe(2);
  expect((await requests(request)).filter(item => item.path === '/api/v1/me')).toHaveLength(1);
  expect(discoveryReads).toBe(1);
  expect(matchesReads).toBe(1);
  await testInfo.attach('cached-tab-requests', { body: JSON.stringify({ requests: await requests(request), discoveryReads, matchesReads, accountConnections }), contentType: 'application/json' });
});

test('failed mobile refresh retains the bookshelf and retries only its data on desktop', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  await page.goto('/novels');
  const book = page.getByRole('heading', { name: '雨停之前的来信', exact: true });
  await expect(book).toBeVisible();
  await configure(request, { delays: { '/api/v1/novels': 800 }, failures: { '/api/v1/novels': 503 } });
  const refresh = page.getByRole('button', { name: '刷新当前页面', exact: true });
  await refresh.focus();
  await refresh.press('Enter');
  await expect(refresh).toBeDisabled();
  await expect(book).toBeVisible();
  await expect(page.getByRole('main').locator('[data-loading-overlay]')).toHaveCount(0);
  await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(book).toBeVisible();
  await configure(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('button', { name: '刷新小说', exact: true })).toHaveCount(0);
  await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(book).toBeVisible();
  expect((await requests(request)).filter(item => item.path === '/api/v1/novels')).toHaveLength(1);
  expect((await requests(request)).filter(item => item.path === '/api/v1/me')).toHaveLength(0);
});

test('leaving the live tab stops room updates and returning reuses cached rooms without another read', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await nav.getByRole('link', { name: '小说', exact: true }).click();
  await expect(page.getByText('暂无小说', { exact: true })).toBeVisible();
  const readsBefore = (await requests(request)).filter(item => item.path === '/api/v1/rooms').length;
  // Cross the former poll interval: unmounted rooms must not make background reads.
  await page.waitForTimeout(5200);
  expect((await requests(request)).filter(item => item.path === '/api/v1/rooms')).toHaveLength(readsBefore);
  await configure(request, { delays: { '/api/v1/rooms': 2500 } });
  await nav.getByRole('link', { name: '直播', exact: true }).click();
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: '正在加载直播间…', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').locator('[data-loading-overlay]')).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(fixture)).json()).roomSockets).toBe(1);
  expect((await requests(request)).filter(item => item.path === '/api/v1/rooms')).toEqual([]);
});

test('saved novel metadata and chapter creation invalidate an already visited bookshelf', async ({ page, request }, testInfo) => {
  let completedShelfReads = 0;
  let abortedShelfReads = 0;
  const isShelfRead = (outgoing: Request) => outgoing.method() === 'GET' && new URL(outgoing.url()).pathname === '/api/v1/novels';
  page.on('requestfinished', outgoing => { if (isShelfRead(outgoing)) completedShelfReads++; });
  page.on('requestfailed', outgoing => {
    if (isShelfRead(outgoing) && outgoing.failure()?.errorText === 'net::ERR_ABORTED') abortedShelfReads++;
  });
  const expectShelfReads = async (expected: number) => {
    await expect.poll(() => completedShelfReads).toBe(expected);
    const backendReads = (await requests(request)).filter(item => item.path === '/api/v1/novels' && item.method === 'GET').length;
    if (testInfo.config.configFile?.includes('production')) expect(backendReads).toBe(expected);
    else {
      // StrictMode can cancel the first subscription's stale fetch before the
      // second subscribes. Only an observed abort may explain an extra API read.
      expect(backendReads).toBeGreaterThanOrEqual(expected);
      expect(backendReads).toBeLessThanOrEqual(expected + abortedShelfReads);
    }
  };
  await signIn(page);
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  await page.goto('/novels');
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await page.getByRole('main').locator('a[href="/novels/design-novel"]').click();
  await page.getByRole('link', { name: '管理', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('保存后仍记得的来信');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('heading', { name: '保存后仍记得的来信', exact: true, level: 1 })).toBeVisible();
  await nav.getByRole('link', { name: '小说', exact: true }).click();
  await expect(page).toHaveURL('/novels');
  await expect(page.getByRole('main').locator('a[href="/novels/design-novel"]').getByRole('heading', { name: '保存后仍记得的来信', exact: true })).toBeVisible();
  await expectShelfReads(2);
  await page.getByRole('main').locator('a[href="/novels/design-novel"]').click();
  await page.getByRole('link', { name: '管理', exact: true }).click();
  await page.getByRole('textbox', { name: '新章节标题', exact: true }).fill('第二封信');
  await page.getByRole('button', { name: '添加章节', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑章节', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: '小说', exact: true }).click();
  await expect(page).toHaveURL('/novels');
  await expect(page.getByRole('main').locator('a[href="/novels/design-novel"]')).toContainText('2 章');
  await expectShelfReads(3);
});

test('creating and deleting a novel update the cached shelf across server-action redirects', async ({ page, request }) => {
  await signIn(page);
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  await page.goto('/novels');
  await expect(page.getByRole('heading', { name: '雨停之前的来信', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '创建小说', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: false }).fill('刚刚写下的新故事');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('heading', { name: '刚刚写下的新故事', exact: true, level: 1 })).toBeVisible();
  const detailPath = new URL(page.url()).pathname;
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '小说', exact: true }).click();
  await expect(page.getByRole('heading', { name: '刚刚写下的新故事', exact: true })).toBeVisible();
  await page.getByRole('main').locator(`a[href="${detailPath}"]`).click();
  await page.getByRole('link', { name: '管理', exact: true }).click();
  page.once('dialog', dialog => { void dialog.accept(); });
  await page.getByRole('button', { name: '删除小说', exact: true }).click();
  await expect(page).toHaveURL('/novels');
  await expect(page.getByRole('heading', { name: '刚刚写下的新故事', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '雨停之前的来信', exact: true })).toBeVisible();
  expect((await requests(request)).filter(item => item.path === '/api/v1/novels' && item.method === 'GET')).toHaveLength(3);
});

for (const status of [401, 403]) {
  test(`a private refresh returning ${status} ${status === 401 ? 'expires the session and clears private content' : 'preserves the account and cached content'}`, async ({ page, request }) => {
    await signIn(page);
    const identity = { id: 'private-friend', name: '私有会话朋友', age: 26, gender: 'FEMALE', avatarUrl: '', background: '' };
    let failure = false;
    await page.route('**/api/v1/matches', route => route.fulfill(failure
      ? { status, json: { error: { message: status === 401 ? '请先登录' : '暂时没有权限' } } }
      : { json: { items: [{ id: 'private-match', conversationId: 'private-conversation', identity }] } }));
    const activeConnections = new Set<WebSocketRoute>();
    await page.routeWebSocket('**/api/v1/matches/socket?*', socket => {
      activeConnections.add(socket);
      // Playwright can report both an explicit close and context destruction
      // for the same routed socket when the account exits to a new document.
      socket.onClose(() => { activeConnections.delete(socket); });
    });
    await page.goto('/me');
    const friend = page.getByRole('link', { name: '继续和私有会话朋友聊天', exact: true });
    await expect(friend).toBeVisible();
    await expect.poll(() => activeConnections.size).toBe(1);
    await configure(request, status === 401 ? { failures: { '/api/v1/me': 401 } } : {});
    let clientAccountChecks = 0;
    page.on('request', outgoing => {
      if (outgoing.method() === 'GET' && new URL(outgoing.url()).pathname === '/api/v1/me') clientAccountChecks++;
    });
    failure = true;
    await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
    if (status === 401) {
      await expect(page).toHaveURL('/login');
      await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
      await expect(friend).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '继承测试用户', exact: true })).toHaveCount(0);
      await expect.poll(() => activeConnections.size).toBe(0);
      // One explicit client check verifies expiry. The new login document may
      // also perform its existing server-side check before presenting the form.
      const accountChecks = (await requests(request)).filter(item => item.path === '/api/v1/me').length;
      expect(clientAccountChecks).toBe(1);
      expect(accountChecks).toBeGreaterThanOrEqual(1);
      expect(accountChecks).toBeLessThanOrEqual(2);
    } else {
      await expect(page.getByRole('main').getByRole('alert')).toContainText('聊天更新失败');
      await expect(friend).toBeVisible();
      await expect(page.getByRole('heading', { name: '继承测试用户', exact: true })).toBeVisible();
      await expect(page).toHaveURL('/me');
      expect(activeConnections.size).toBe(1);
      expect((await requests(request)).filter(item => item.path === '/api/v1/me')).toHaveLength(0);
      expect(clientAccountChecks).toBe(0);
    }
  });
}

test('tab browsing choices survive navigation while a document reload resets choices and refetches data', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const identity = { id: 'filter-friend', name: '林晚', age: 26, city: '杭州', gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' };
  const catalogReads: string[] = [];
  let matchReads = 0;
  await page.route('**/api/v1/discover?*', route => {
    catalogReads.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { items: [identity], total: 1, page: 1, nextPage: null, occupations: [] } });
  });
  await page.route('**/api/v1/matches', route => {
    matchReads++;
    return route.fulfill({ json: { items: [] } });
  });
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  await page.goto('/companion?view=discover');
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await expect(page.getByRole('searchbox', { name: '姓名', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '姓名', exact: true }).fill('林');
  await page.getByRole('spinbutton', { name: '最小年龄', exact: true }).fill('25');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect.poll(() => new URLSearchParams(catalogReads.at(-1)).get('q')).toBe('林');
  const filteredReads = catalogReads.length;
  await nav.getByRole('link', { name: '直播', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索直播间', exact: true }).fill('清晨');
  await page.getByRole('button', { name: '准备中', exact: true }).click();
  await nav.getByRole('link', { name: '我的', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 身份', exact: true }).click();
  await nav.getByRole('link', { name: '小说', exact: true }).click();
  await expect(page.getByRole('heading', { name: '雨停之前的来信', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: '我的', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'AI 身份', exact: true })).toHaveAttribute('aria-selected', 'true');
  await nav.getByRole('link', { name: '直播', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜索直播间', exact: true })).toHaveValue('清晨');
  await expect(page.getByRole('button', { name: '准备中', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await nav.getByRole('link', { name: '陪伴', exact: true }).click();
  await expect(page).toHaveURL('/companion?view=discover');
  await expect(page.getByRole('searchbox', { name: '姓名', exact: true })).toHaveValue('林');
  await expect(page.getByRole('spinbutton', { name: '最小年龄', exact: true })).toHaveValue('25');
  expect(catalogReads).toHaveLength(filteredReads);
  expect(matchReads).toBe(1);
  expect((await requests(request)).filter(item => item.path === '/api/v1/me')).toHaveLength(1);

  await page.reload();
  await expect(page.getByRole('searchbox', { name: '姓名', exact: true })).toHaveValue('');
  await expect(page.getByRole('spinbutton', { name: '最小年龄', exact: true })).toHaveValue('');
  await expect.poll(() => catalogReads.length).toBe(filteredReads + 1);
  expect(new URLSearchParams(catalogReads.at(-1)).get('q')).toBeNull();
  await expect.poll(() => matchReads).toBe(2);
  expect((await requests(request)).filter(item => item.path === '/api/v1/me')).toHaveLength(2);
  await nav.getByRole('link', { name: '我的', exact: true }).click();
  await expect(page.getByRole('tab', { name: '最近聊天', exact: true })).toHaveAttribute('aria-selected', 'true');
  await nav.getByRole('link', { name: '直播', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜索直播间', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a temporary authentication error does not suppress a later session-expiry check', async ({ page, request }) => {
  await signIn(page);
  let failure = false;
  await page.route('**/api/v1/matches', route => route.fulfill(failure
    ? { status: 401, json: { error: { message: '会话需要重新验证' } } }
    : { json: { items: [] } }));
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: '继承测试用户', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新最近聊天', exact: true })).toBeEnabled();
  let clientAccountChecks = 0;
  page.on('request', outgoing => {
    if (outgoing.method() === 'GET' && new URL(outgoing.url()).pathname === '/api/v1/me') clientAccountChecks++;
  });
  await configure(request, { user: { name: '重新验证后的账户' } });
  failure = true;
  await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
  // A successful dedicated account check updates both consumers of the cache.
  await expect(page.getByRole('heading', { name: '重新验证后的账户', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '账户与身份 · 重新验证后的账户', exact: true })).toBeVisible();
  expect(clientAccountChecks).toBe(1);
  expect((await requests(request)).filter(item => item.path === '/api/v1/me')).toHaveLength(1);
  await configure(request, { failures: { '/api/v1/me': 401 } });
  await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
  expect(clientAccountChecks).toBe(2);
  expect((await requests(request)).filter(item => item.path === '/api/v1/me').length).toBeLessThanOrEqual(2);
});

test('an unavailable account check preserves private content and allows a later expiry check', async ({ page, request }) => {
  await signIn(page);
  const identity = { id: 'verification-friend', name: '核验中的朋友', age: 26, gender: 'FEMALE', avatarUrl: '', background: '' };
  let failure = false;
  await page.route('**/api/v1/matches', route => route.fulfill(failure
    ? { status: 401, json: { error: { message: '会话需要重新验证' } } }
    : { json: { items: [{ id: 'verification-match', conversationId: 'verification-conversation', identity }] } }));
  const activeConnections = new Set<WebSocketRoute>();
  await page.routeWebSocket('**/api/v1/matches/socket?*', socket => {
    activeConnections.add(socket);
    socket.onClose(() => { activeConnections.delete(socket); });
  });
  await page.goto('/me');
  const friend = page.getByRole('link', { name: '继续和核验中的朋友聊天', exact: true });
  await expect(friend).toBeVisible();
  await expect.poll(() => activeConnections.size).toBe(1);
  let clientAccountChecks = 0;
  page.on('request', outgoing => {
    if (outgoing.method() === 'GET' && new URL(outgoing.url()).pathname === '/api/v1/me') clientAccountChecks++;
  });
  await configure(request, { failures: { '/api/v1/me': 503 } });
  const unavailableCheck = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/me' && response.status() === 503);
  failure = true;
  await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
  await (await unavailableCheck).finished();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('聊天更新失败');
  await expect(friend).toBeVisible();
  await expect(page.getByRole('heading', { name: '继承测试用户', exact: true })).toBeVisible();
  await expect(page).toHaveURL('/me');
  expect(activeConnections.size).toBe(1);
  expect(clientAccountChecks).toBe(1);
  expect((await requests(request)).filter(item => item.path === '/api/v1/me')).toHaveLength(1);

  await configure(request, { failures: { '/api/v1/me': 401 } });
  await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
  await expect(friend).toHaveCount(0);
  await expect.poll(() => activeConnections.size).toBe(0);
  expect(clientAccountChecks).toBe(2);
  expect((await requests(request)).filter(item => item.path === '/api/v1/me').length).toBeLessThanOrEqual(2);
});

test('a failed recent-list refresh leaves cached discovery actions usable', async ({ page }) => {
  await signIn(page);
  const identity = { id: 'greeting-friend', name: '林晚', age: 26, gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' };
  const match = { id: 'greeting-match', conversationId: 'greeting-conversation', identity };
  let failure = false;
  let greetings = 0;
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  await page.routeWebSocket('**/api/v1/conversations/*/socket?*', () => {});
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [identity], total: 1, nextPage: null, occupations: [] } }));
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'HUMAN', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
  await page.route('**/api/v1/matches', route => {
    if (route.request().method() === 'POST') {
      greetings++;
      return route.fulfill({ json: match });
    }
    return route.fulfill(failure
      ? { status: 503, json: { error: { message: '列表暂时不可用' } } }
      : { json: { items: [] } });
  });
  await page.goto('/companion');
  const greeting = page.getByRole('button', { name: '和林晚打个招呼', exact: true });
  await expect(greeting).toBeEnabled();
  failure = true;
  await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('列表暂时不可用');
  await expect(greeting).toBeEnabled();
  await greeting.click();
  await expect.poll(() => greetings).toBe(1);
  await expect(page.getByRole('textbox', { name: '给林晚发消息', exact: true })).toBeVisible();
});

test('catalog refresh failure preserves cards and filters and retry refreshes only the catalog', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const identity = { id: 'refresh-friend', name: '林晚', age: 26, gender: 'FEMALE', avatarUrl: '', background: '上次加载的人物介绍' };
  const reads: URL[] = [];
  let matchesReads = 0;
  let failure = false;
  let recovered = false;
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.routeWebSocket('**/api/v1/matches/socket?*', socket => { socket.send(JSON.stringify({ type: 'ping' })); });
  await page.route('**/api/v1/matches', route => {
    matchesReads++;
    return route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/discover?*', async route => {
    reads.push(new URL(route.request().url()));
    if (failure) {
      await held;
      return route.fulfill({ status: 500, json: { error: { message: '目录暂时不可用' } } });
    }
    return route.fulfill({ json: { items: [{ ...identity, background: recovered ? '刷新后的人物介绍' : identity.background }], total: 1, nextPage: null, occupations: [] } });
  });
  try {
    await page.goto('/companion');
    const directory = page.getByRole('region', { name: '这里的朋友', exact: true });
    await expect(directory.getByText('上次加载的人物介绍', { exact: true })).toBeVisible();
    await directory.getByRole('searchbox', { name: '姓名', exact: true }).fill('林');
    await directory.getByRole('spinbutton', { name: '最小年龄', exact: true }).fill('25');
    await directory.getByRole('button', { name: '筛选', exact: true }).click();
    await expect.poll(() => reads.at(-1)?.searchParams.get('q')).toBe('林');
    const refresh = directory.getByRole('button', { name: '刷新人物目录', exact: true });
    await expect(refresh).toBeEnabled();
    const initialReads = reads.length;
    failure = true;
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(directory.getByText('上次加载的人物介绍', { exact: true })).toBeVisible();
    await expect(directory.getByRole('searchbox', { name: '姓名', exact: true })).toHaveValue('林');
    await expect(directory.getByRole('spinbutton', { name: '最小年龄', exact: true })).toHaveValue('25');
    await expect(directory.getByRole('status', { name: '正在寻找可以认识的人…', exact: true })).toHaveCount(0);
    release();
    await expect(directory.getByRole('alert')).toContainText('目录暂时不可用');
    await expect(directory.getByText('上次加载的人物介绍', { exact: true })).toBeVisible();
    expect(reads.length).toBeGreaterThan(initialReads);
    const failedReads = reads.length;
    failure = false;
    recovered = true;
    await directory.getByRole('button', { name: '重试', exact: true }).click();
    await expect(directory.getByText('刷新后的人物介绍', { exact: true })).toBeVisible();
    await expect(directory.getByRole('alert')).toHaveCount(0);
    expect(reads).toHaveLength(failedReads + 1);
    expect(reads.slice(initialReads).every(url => url.searchParams.get('page') === '1' && url.searchParams.get('q') === '林' && url.searchParams.get('ageMin') === '25')).toBe(true);
    expect(matchesReads).toBe(1);
    expect((await requests(request)).filter(item => item.path === '/api/v1/me')).toHaveLength(1);
  } finally { release(); }
});
