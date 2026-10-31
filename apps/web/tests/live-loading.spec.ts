import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';
const room = { id: 'room-loading', title: '今晚，一起聊聊', status: '准备中', viewers: 0, canManage: true };

test.afterEach(async ({ request }) => { await request.post(fixture, { data: {} }); });

for (const width of [390, 1440]) {
  test(`automatic retries keep one loading frame and remain cancellable at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await request.post(fixture, { data: { rooms: [room] } });
    let attempts = 0;
    let releaseFirst!: () => void;
    let releaseRetry!: () => void;
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    const retry = new Promise<void>(resolve => { releaseRetry = resolve; });
    await page.route(`**/api/v1/rooms/${room.id}/join`, async route => {
      attempts++;
      await (attempts === 1 ? first : retry);
      await route.fulfill({ status: 503, headers: { 'Retry-After': '2' }, json: { error: { message: '直播服务暂时不可用' } } }).catch(() => {});
    });
    try {
      await page.goto(`/live/${room.id}`);
      const loading = page.locator('[data-player-loading]');
      await expect(loading).toBeVisible();
      // This marker disappears if a failed request remounts the loading frame.
      await loading.evaluate(element => element.setAttribute('data-test-continuous', 'true'));
      const before = (await page.locator('.live-stage').boundingBox())!;
      releaseFirst();
      await expect.poll(() => attempts).toBe(2);
      await expect(loading).toHaveAttribute('data-test-continuous', 'true');
      await expect(page.getByText('未连接', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '重新加入' })).toHaveCount(0);
      await expect(page.locator('.live-guest-name')).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
      await expect(page.locator('[data-skeleton="room-chat"]')).toBeVisible();
      await expect(page.getByRole('button', { name: '取消连接' })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath(`retry-${width}.png`), fullPage: true });
      await expect(loading.getByText('连接时间较长，请稍候…')).toBeVisible({ timeout: 10_000 });
      const after = (await page.locator('.live-stage').boundingBox())!;
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      await page.screenshot({ path: testInfo.outputPath(`slow-retry-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: '取消连接' }).click();
      releaseRetry();
      await expect(loading).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '你已离开直播间' })).toBeVisible();
      await expect(page.getByRole('button', { name: '重新加入' })).toBeEnabled();
      await page.waitForTimeout(2500);
      expect(attempts).toBe(2);
    } finally { releaseFirst(); releaseRetry(); }
  });

  test(`a reload waits for the previous session without flashing the occupied-room screen at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1000 });
    await request.post(fixture, { data: { rooms: [room] } });
    let reloading = false;
    let attempts = 0;
    let release!: () => void;
    const retry = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/v1/rooms/${room.id}/join`, async route => {
      if (reloading && ++attempts === 1) {
        return route.fulfill({ status: 409, headers: { 'Retry-After': '2' }, json: { error: { code: 'host_session_in_use', message: '上次连接尚未释放' } } });
      }
      if (reloading) await retry;
      await route.fulfill({ status: 403, json: { error: { message: '当前账号暂时无法进入直播间' } } }).catch(() => {});
    });
    try {
      await page.goto(`/live/${room.id}`);
      await expect(page.getByRole('heading', { name: '暂时无法进入直播间' })).toBeVisible();
      reloading = true;
      await page.reload();
      await expect.poll(() => attempts).toBe(1);
      await expect(page.locator('[data-player-loading]')).toBeVisible();
      await expect(page.getByRole('heading', { name: '此直播间已在其他页面打开' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '取消连接' })).toBeEnabled();
      await expect.poll(() => attempts).toBe(2);
      await expect(page.locator('[data-player-loading]')).toBeVisible();
      release();
      await expect(page.getByRole('heading', { name: '暂时无法进入直播间' })).toBeVisible();
      await expect(page.locator('[data-player-loading]')).toHaveCount(0);
    } finally { release(); }
  });
}

for (const width of [320, 390, 768, 1440, 2560]) {
  test(`room refresh keeps its stage and chat through account and connection waits at ${width}px`, async ({ page, context, request }, testInfo) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
    await request.post(fixture, { data: { rooms: [room], delays: { '/api/v1/me': 6000 } } });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/v1/rooms/${room.id}/join`, async route => {
      await held;
      await route.fulfill({ status: 403, json: { error: { message: '当前账号暂时无法进入直播间' } } }).catch(() => {});
    });
    try {
      await page.goto(`/live/${room.id}`, { waitUntil: 'commit' });
      const loading = page.locator('[data-page-loading="room"]');
      await expect(loading).toBeVisible();
      await expect(loading.locator('.live-stage')).toBeVisible();
      await expect(loading.locator('.live-stage')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await expect(loading.locator('.live-stage h2')).toHaveCount(0);
      await expect(loading.locator('[data-skeleton="room-chat"] .live-chat-log')).toBeEmpty();
      await expect(loading.getByRole('complementary', { name: '直播互动' })).toBeVisible();
      await expect(page.locator('[data-loading-overlay]')).toHaveCount(0);
      if (width < 768) await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeHidden();
      const before = (await loading.locator('.live-stage').boundingBox())!;
      const chatBefore = (await loading.locator('.live-sidebar').boundingBox())!;
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`refresh-${width}.png`), fullPage: true });
      await expect(loading).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByRole('status', { name: '正在连接直播间', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '取消连接' })).toBeEnabled();
      await page.getByRole('button', { name: '取消连接' }).click({ trial: true });
      await expect(page.getByRole('textbox', { name: '发送消息' })).toBeDisabled();
      const after = (await page.locator('.live-stage').boundingBox())!;
      expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(2);
      const chatAfter = (await page.locator('.live-sidebar').boundingBox())!;
      expect(Math.abs(chatBefore.y - chatAfter.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(chatBefore.height - chatAfter.height)).toBeLessThanOrEqual(2);
      await expect(page.getByRole('heading', { name: room.title, exact: true })).toBeVisible();
      await expect(page.locator('[data-skeleton="room-chat"]')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`connecting-${width}.png`), fullPage: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.locator('[data-player-loading] svg')).toHaveCSS('animation-name', 'none');
      // A hard refresh repeats the same frame, including the account boundary.
      await page.reload({ waitUntil: 'commit' });
      await expect(loading).toBeVisible();
      await expect(loading.locator('[data-player-loading] svg')).toHaveCSS('animation-name', 'none');
      await expect(loading).toHaveCount(0, { timeout: 15_000 });
      release();
      await expect(page.getByRole('main').getByRole('alert')).toContainText('当前账号暂时无法进入直播间');
      await expect(page.getByRole('button', { name: '重新加入' })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
    } finally { release(); }
  });
}
