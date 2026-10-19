import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`phone live directory has a quiet empty state and staged finder at ${width}`, async ({ page }, info) => {
    await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
    let rooms: Array<{ id: string; title: string; status: string; viewers: number; canManage: boolean }> = [];
    await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: rooms } }));
    await page.routeWebSocket('**/api/v1/rooms/socket?*', () => {});
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/live');
    await expect(page.getByRole('heading', { name: '今晚，还很安静。' })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveCount(0);
    const start = page.getByRole('button', { name: '开播', exact: true });
    await expect(start).toBeVisible();
    const bounds = await start.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(780);
    await page.screenshot({ path: info.outputPath(`live-empty-${width}.png`), fullPage: true });
    await start.click();
    await expect(page.getByRole('textbox', { name: '房间名称' })).toBeVisible();
    await page.keyboard.press('Escape');
    rooms = [
      { id: 'night', title: '夜很长，聊聊今天没说完的话', status: '直播中', viewers: 7, canManage: false },
      { id: 'morning', title: '明早见，带一本喜欢的书', status: '准备中', viewers: 0, canManage: false },
    ];
    await page.reload();
    await expect(page.getByRole('article')).toHaveCount(2);
    await page.getByRole('button', { name: '查找直播间', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索直播间' }).fill('夜');
    await page.getByRole('button', { name: '关闭查找直播间', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '查找直播间', exact: true })).toBeHidden();
    await expect(page.getByRole('article')).toHaveCount(2);
    await page.getByRole('button', { name: '查找直播间', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: '搜索直播间' })).toHaveValue('');
    await page.getByRole('searchbox', { name: '搜索直播间' }).fill('夜');
    await page.getByRole('button', { name: '查看房间', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('article').getByRole('link')).toHaveAttribute('href', '/live/night');
    await page.screenshot({ path: info.outputPath(`live-room-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
