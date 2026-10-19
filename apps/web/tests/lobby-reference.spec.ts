import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';
test.beforeEach(async ({ request }) => { await request.post(fixture, { data: { rooms: [] } }); });
test.afterEach(async ({ request }) => { await request.post(fixture, { data: {} }); });

for (const width of [320, 390, 768, 1440]) {
  test(`lobby reference layout and guest entry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/live');
    await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新列表' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width >= 768) {
      await expect(page.locator('.scene-banner')).toHaveCount(0);
      const search = page.getByRole('searchbox', { name: '搜索直播间' });
      await search.focus();
      await expect(search.locator('..')).toHaveCSS('box-shadow', 'none');
      await expect(search.locator('..')).toHaveCSS('border-top-width', '0px');
      const action = page.getByRole('button', { name: '我要开播', exact: true });
      expect((await action.boundingBox())!.height).toBe(44);
      await expect(page.getByRole('button', { name: '我要开播', exact: true })).toBeEnabled();
      await page.screenshot({ path: `/tmp/radio-friday-review/lobby-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: '我要开播', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '今晚，开场', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: '登录后创建' })).toHaveAttribute('href', '/login');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '我要开播', exact: true })).toBeFocused();
    } else {
      await expect(page.getByRole('link', { name: '登录开播' })).toBeVisible();
      await page.screenshot({ path: `/tmp/radio-friday-review/lobby-${width}.png`, fullPage: true, animations: 'disabled' });
    }
  });
}

test('desktop create dialog preserves drafts, closes after creation and links directly to the owned room', async ({ page, context }) => {
  await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/live');
  await page.getByRole('button', { name: '我要开播', exact: true }).click();
  const input = page.getByRole('textbox', { name: '房间名称' });
  await input.fill('晚间电台');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '我要开播', exact: true }).click();
  await expect(input).toHaveValue('晚间电台');
  const dialog = page.getByRole('dialog', { name: '今晚，开场', exact: true });
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(420);
  await expect(dialog.getByRole('heading')).toHaveCount(1);
  await page.screenshot({ path: '/tmp/radio-friday-review/lobby-create.png', animations: 'disabled' });
  // The read-only API fixture has no create endpoint; supply the real response shape.
  await page.route('**/api/v1/rooms', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 201, json: { item: { id: 'created-room', title: '晚间电台', status: '准备中', viewers: 0, canManage: true } } })
    : route.continue());
  await page.getByRole('button', { name: '创建直播间', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '今晚，开场', exact: true })).toBeHidden();
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('article', { name: '晚间电台' })).toBeVisible();
  await expect(page.getByRole('link', { name: '我的直播间', exact: true })).toHaveAttribute('href', '/live/created-room');
  await expect(page.getByText('0 人在房间', { exact: true })).toHaveCount(0);
  await expect(input).toHaveCount(0);
});

test('desktop filters, search and pushed room updates remain usable', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/live');
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
  await request.post(fixture, { data: { rooms: [
    { id: 'on-air', title: '晚安电台', status: '直播中', viewers: 3, canManage: false },
    { id: 'waiting', title: '下班后聊聊', status: '准备中', viewers: 0, canManage: false },
  ] } });
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '准备中 (1)', exact: true })).toBeVisible();
  await expect(page.getByText('0 人在房间', { exact: true })).toHaveCount(0);
  await expect(page.getByText('3 人在房间', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '直播中 (1)', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: '晚安电台' })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索直播间' }).fill('不存在');
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看全部直播间' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: '搜索直播间' }).fill('');
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.screenshot({ path: '/tmp/radio-friday-review/lobby-rooms.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
});
