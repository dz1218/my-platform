import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';
const room = { id: 'room-loading', title: '今晚，一起聊聊', status: '准备中', viewers: 0, canManage: true };

test.afterEach(async ({ request }) => { await request.post(fixture, { data: {} }); });

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
      await route.fulfill({ status: 503, json: { error: { message: '连接暂时不可用，请重试' } } }).catch(() => {});
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
      await expect(page.getByRole('main').getByRole('alert')).toContainText('连接暂时不可用');
      await expect(page.getByRole('button', { name: '重新加入' })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
    } finally { release(); }
  });
}
