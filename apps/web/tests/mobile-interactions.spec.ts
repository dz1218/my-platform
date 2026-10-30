import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const cookie = { name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' };

async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, cancel = false, beforeRelease?: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 12; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12 }] });
  }
  await beforeRelease?.();
  await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('lobby refresh requires a deliberate pull, deduplicates requests and retains the page', async ({ page, context }) => {
  await context.addCookies([cookie]);
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: [] } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/rooms/refresh', async route => {
    calls++;
    await gate;
    await route.fulfill({ json: { items: [{ id: 'fresh', title: '刚开播的电台', status: '直播中', viewers: 2, canManage: false }] } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今晚，还很安静。' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/has-pull-refresh/);
  const main = page.getByRole('main');
  const initialTop = (await main.boundingBox())!.y;
  const nav = page.locator('.mobile-nav');
  const navTop = (await nav.boundingBox())!.y;
  await swipe(page, { x: 30, y: 100 }, { x: 30, y: 160 });
  await expect.poll(async () => (await main.boundingBox())!.y).toBeCloseTo(initialTop, 0);
  expect(calls).toBe(0);
  await swipe(page, { x: 30, y: 100 }, { x: 230, y: 130 });
  expect(calls).toBe(0);
  await swipe(page, { x: 30, y: 100 }, { x: 30, y: 310 }, true);
  await expect.poll(async () => (await main.boundingBox())!.y).toBeCloseTo(initialTop, 0);
  expect(calls).toBe(0);
  try {
    await swipe(page, { x: 30, y: 100 }, { x: 30, y: 310 }, false, async () => {
      await expect(page.locator('[data-pull-refresh]')).toHaveText('松开刷新');
      expect((await main.boundingBox())!.y - initialTop).toBeGreaterThan(80);
      expect((await nav.boundingBox())!.y).toBe(navTop);
      expect(calls).toBe(0);
      await page.screenshot({ path: test.info().outputPath('pull-following-finger.png') });
    });
    await expect.poll(() => calls).toBe(1);
    await expect(page.locator('[data-pull-refresh]')).toHaveText('正在刷新…');
    // The released page springs back to the smaller loading gap.
    await expect.poll(async () => (await main.boundingBox())!.y - initialTop).toBeCloseTo(56, 0);
    expect((await nav.boundingBox())!.y).toBe(navTop);
    await swipe(page, { x: 30, y: 100 }, { x: 30, y: 310 });
    expect(calls).toBe(1);
    await page.screenshot({ path: test.info().outputPath('pull-refresh.png') });
  } finally { release(); }
  await expect(page.getByRole('article', { name: '刚开播的电台' })).toBeVisible();
  await expect(page.locator('[data-pull-refresh]')).toHaveText('已更新');
  await expect.poll(async () => (await main.boundingBox())!.y).toBeCloseTo(initialTop, 0);
  await expect(page.locator('[data-pull-refresh]')).toBeHidden();
  await expect(page).toHaveURL('/');
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('refresh failure keeps existing rooms and a later pull retries', async ({ page }) => {
  const rooms = [{ id: 'existing', title: '仍在播放的电台', status: '直播中', viewers: 1, canManage: false }];
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: rooms } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  let calls = 0;
  await page.route('**/api/v1/rooms/refresh', route => {
    calls++;
    return calls === 1 ? route.fulfill({ status: 503, json: { error: { message: '暂时无法更新' } } }) : route.fulfill({ json: { items: rooms } });
  });
  await page.goto('/');
  await expect(page.getByRole('article')).toBeVisible();
  await swipe(page, { x: 25, y: 90 }, { x: 25, y: 300 });
  await expect(page.locator('[data-pull-refresh]')).toHaveText('刷新失败，请重试');
  await expect(page.getByRole('article')).toBeVisible();
  await swipe(page, { x: 25, y: 90 }, { x: 25, y: 300 });
  await expect(page.locator('[data-pull-refresh]')).toHaveText('已更新');
  expect(calls).toBe(2);
});

test('adding a second finger cancels the pull and restores the page', async ({ page }) => {
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: [] } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  let calls = 0;
  await page.route('**/api/v1/rooms/refresh', route => { calls++; return route.fulfill({ json: { items: [] } }); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今晚，还很安静。' })).toBeVisible();
  const main = page.getByRole('main');
  const initialTop = (await main.boundingBox())!.y;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 30, y: 100, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 30, y: 300, id: 0 }] });
  await expect(page.locator('[data-pull-refresh]')).toHaveText('松开刷新');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 30, y: 300, id: 0 }, { x: 130, y: 300, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(page.locator('[data-pull-refresh]')).toBeHidden();
  expect((await main.boundingBox())!.y).toBeCloseTo(initialTop, 0);
  expect(calls).toBe(0);
});

test('leaving mobile during refresh clears displacement and ignores its late feedback', async ({ page }) => {
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: [] } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/rooms/refresh', async route => {
    await gate;
    await route.fulfill({ json: { items: [] } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今晚，还很安静。' })).toBeVisible();
  try {
    await swipe(page, { x: 30, y: 100 }, { x: 30, y: 310 });
    await expect(page.locator('[data-pull-refresh]')).toHaveText('正在刷新…');
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('[data-pull-refresh]')).toHaveCount(0);
      await expect(page.locator('html')).not.toHaveClass(/has-pull-refresh/);
      await expect(page.getByRole('main')).toHaveCSS('transform', 'none');
      expect(await page.getByRole('main').evaluate(element => element.style.getPropertyValue('--pull-refresh-distance'))).toBe('');
      await page.screenshot({ path: test.info().outputPath(`desktop-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-pull-refresh]')).toBeHidden();
  } finally { release(); }
  await expect(page.getByRole('button', { name: '刷新当前页面' })).toBeEnabled();
  await expect(page.getByRole('main')).toHaveCSS('transform', 'none');
  await expect(page.locator('[data-pull-refresh]')).toBeHidden();
});

test('reduced motion retains pulling and refresh without a rebound animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: [] } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  let calls = 0;
  await page.route('**/api/v1/rooms/refresh', route => { calls++; return route.fulfill({ json: { items: [] } }); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今晚，还很安静。' })).toBeVisible();
  await swipe(page, { x: 30, y: 100 }, { x: 30, y: 310 }, false, async () => {
    expect((await page.getByRole('main').boundingBox())!.y).toBeGreaterThan(80);
    await expect(page.getByRole('main')).toHaveCSS('transition-duration', '0s');
    expect(calls).toBe(0);
  });
  await expect.poll(() => calls).toBe(1);
  await expect(page.locator('[data-pull-refresh]')).toBeHidden();
  await expect(page.getByRole('main')).toHaveCSS('transform', 'none');
});

test('pulling on a room link refreshes the list without opening the room', async ({ page }) => {
  const rooms = [{ id: 'pullable', title: '可以下拉的电台', status: '直播中', viewers: 1, canManage: false }];
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: rooms } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  let calls = 0;
  await page.route('**/api/v1/rooms/refresh', route => { calls++; return route.fulfill({ json: { items: rooms } }); });
  await page.goto('/');
  const link = page.getByRole('article').getByRole('link');
  await expect(link).toBeVisible();
  const bounds = (await link.boundingBox())!;
  await swipe(page, { x: bounds.x + 60, y: bounds.y + 40 }, { x: bounds.x + 60, y: bounds.y + 250 });
  await expect.poll(() => calls).toBe(1);
  await expect(page.locator('[data-pull-refresh]')).toHaveText('已更新');
  await expect(page).toHaveURL('/');
  await page.route('**/api/v1/rooms/pullable/join', route => route.fulfill({ status: 503, json: { error: { message: '测试连接' } } }));
  await link.click();
  await expect(page).toHaveURL('/live/pullable');
});

test('sheets lock the scrolled background, retain drafts and restore touch scrolling', async ({ page, context }) => {
  await context.addCookies([cookie]);
  const rooms = Array.from({ length: 16 }, (_, i) => ({ id: `room-${i}`, title: `电台 ${i + 1}`, status: '直播中', viewers: 1, canManage: false }));
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: rooms } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  let refreshes = 0;
  await page.route('**/api/v1/rooms/refresh', route => { refreshes++; return route.fulfill({ json: { items: rooms } }); });
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(16);
  await page.evaluate(() => scrollTo(0, 400));
  await page.getByRole('button', { name: '开播', exact: true }).click();
  const sheet = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: '房间名称' }) });
  await expect(sheet).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  const y = await page.evaluate(() => scrollY);
  await swipe(page, { x: 30, y: 100 }, { x: 30, y: 350 });
  await swipe(page, { x: 30, y: 350 }, { x: 30, y: 100 });
  await page.mouse.move(30, 100);
  await page.mouse.wheel(0, 700);
  expect(await page.evaluate(() => scrollY)).toBe(y);
  expect(refreshes).toBe(0);
  await sheet.getByRole('textbox', { name: '房间名称' }).fill('保留的草稿');
  await page.screenshot({ path: test.info().outputPath('create-sheet.png') });
  await sheet.getByRole('button', { name: /^关闭/ }).click();
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
  expect(await page.evaluate(() => scrollY)).toBe(y);
  await expect(page.getByRole('button', { name: '开播', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '开播', exact: true }).click();
  await expect(sheet.getByRole('textbox', { name: '房间名称' })).toHaveValue('保留的草稿');
  await page.keyboard.press('Escape');
  await swipe(page, { x: 25, y: 400 }, { x: 25, y: 180 });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y);
  expect(refreshes).toBe(0);
});

test('auth notice scrolls internally, blocks overscroll and releases on close', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: '隐私与互动说明', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '隐私与互动说明' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  const content = dialog.locator('.auth-notice-content');
  const bounds = (await content.boundingBox())!;
  const y = await page.evaluate(() => scrollY);
  await swipe(page, { x: bounds.x + 30, y: bounds.y + bounds.height - 30 }, { x: bounds.x + 30, y: bounds.y + 30 });
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(y);
  await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await swipe(page, { x: bounds.x + 30, y: bounds.y + bounds.height - 30 }, { x: bounds.x + 30, y: bounds.y + 30 });
  expect(await page.evaluate(() => scrollY)).toBe(y);
  await dialog.getByRole('button', { name: '关闭说明' }).click();
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
});

test('closing one modal keeps the other locked, and unmount releases the final lock', async ({ page, context }) => {
  await context.addCookies([cookie]);
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: [] } }));
  await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
  await page.goto('/');
  await page.getByRole('button', { name: '开播', exact: true }).click();
  const create = page.locator('dialog.sheet[open]');
  await expect(create).toBeVisible();
  // Exercise the native modal lifecycle shared by confirmations and Sheets,
  // including releasing a lower modal before the upper one.
  const confirm = page.locator('dialog.live-dialog');
  await confirm.evaluate((dialog: HTMLDialogElement) => dialog.showModal());
  await expect(confirm).toBeVisible();
  await create.locator('button[aria-label^="关闭"]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  await confirm.evaluate((dialog: HTMLDialogElement) => dialog.close());
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
  await page.getByRole('button', { name: '开播', exact: true }).click();
  await expect(create).toBeVisible();
  await page.evaluate(() => history.pushState(null, '', '/novels'));
  await expect(page.getByRole('main')).toHaveAttribute('data-mobile-page', 'novels');
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
});

test('chat settings lock the history and become a nonmodal panel on desktop', async ({ page, context }) => {
  await context.addCookies([{ ...cookie, value: 'inheritance-test-inherited' }]);
  const match = { id: 'touch-match', conversationId: 'touch-conversation', participantName: '来信的人', identity: { id: 'inheritance-chennian', name: '陈念', age: 24, avatarUrl: '' } };
  await page.route('**/api/v1/operator/conversations', route => route.fulfill({ json: { items: [match] } }));
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'HUMAN', mode: 'TIMEOUT', delaySeconds: 120, version: 1, canManage: true } }));
  await page.route('**/api/v1/conversations/*/preferences', route => route.fulfill({ json: { version: 1, allowProactiveAI: false } }));
  await page.route('**/api/v1/conversations/*/daily-state', route => route.fulfill({ json: { version: 1, currentActivity: '', mood: '', paused: false } }));
  await page.routeWebSocket('**/api/v1/conversations/*/socket?*', () => {});
  await page.goto('/operator?id=touch-conversation');
  await page.getByRole('button', { name: '会话设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '会话设置', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  await expect(page.locator('[data-pull-refresh]')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.matches(':modal'))).toBe(false);
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '会话设置', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  await dialog.getByRole('button', { name: '关闭会话设置' }).click();
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('button', { name: '会话设置', exact: true })).toBeFocused();
});

for (const scenario of [
  { path: '/companion?view=discover', endpoint: '**/api/v1/discover?*', json: { items: [], total: 0, nextPage: null, occupations: [] } },
  { path: '/novels', endpoint: '**/api/v1/novels', json: { items: [] } },
  { path: '/me', endpoint: '**/api/v1/matches', json: { items: [] } },
]) {
  test(`${scenario.path} refreshes its own data without document navigation`, async ({ page, context }) => {
    await context.addCookies([cookie]);
    await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
    let calls = 0;
    await page.route(scenario.endpoint, route => { calls++; return route.fulfill({ json: scenario.json }); });
    await page.goto(scenario.path);
    await expect(page.locator('html')).toHaveClass(/has-pull-refresh/);
    await expect.poll(() => calls).toBeGreaterThan(0);
    const before = calls;
    const navCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    const initialTop = (await page.getByRole('main').boundingBox())!.y;
    await swipe(page, { x: 25, y: 90 }, { x: 25, y: 310 }, false, async () => {
      await expect(page.locator('[data-pull-refresh]')).toHaveText('松开刷新');
      expect((await page.getByRole('main').boundingBox())!.y - initialTop).toBeGreaterThan(80);
      expect(calls).toBe(before);
      await page.screenshot({ path: test.info().outputPath('page-pulled.png') });
    });
    await expect.poll(() => calls).toBe(before + 1);
    await expect(page.locator('[data-pull-refresh]')).toHaveText('已更新');
    await expect.poll(async () => (await page.getByRole('main').boundingBox())!.y).toBeCloseTo(initialTop, 0);
    expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navCount);
    await page.screenshot({ path: test.info().outputPath('refreshed-page.png'), fullPage: true });
  });
}
