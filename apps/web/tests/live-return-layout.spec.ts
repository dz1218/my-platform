import { expect, test } from '@playwright/test';

for (const width of [1440, 768, 390]) {
  test(`ending a room preserves the stage position before returning at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 980 });
    const room = { id: 'return-layout', title: '返回大厅布局', status: '直播中', viewers: 1, canManage: false };
    await page.request.post('http://127.0.0.1:18181/__performance', { data: { rooms: [] } });
    let closed = false;
    await page.route(`**/api/v1/rooms/${room.id}`, route => route.fulfill({ json: { item: room, state: closed ? 'closed' : 'open' } }));
    await page.route(`**/api/v1/rooms/${room.id}/refresh`, route => route.fulfill({ json: { item: room, state: 'closed' } }));
    await page.route(`**/api/v1/rooms/${room.id}/join`, route => route.fulfill({ status: 503, json: { error: { message: '测试连接未建立' } } }));
    await page.goto(`/live/${room.id}`);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('测试连接未建立');
    const studio = page.locator('.live-studio');
    const top = () => studio.evaluate(el => el.getBoundingClientRect().top + window.scrollY);
    const before = await top();
    await expect(page.getByRole('button', { name: '刷新状态', exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`room-${width}.png`), fullPage: true });
    closed = true;
    await page.request.post('http://127.0.0.1:18181/__performance', { data: { rooms: [], roomDetails: { [room.id]: { item: room, state: 'closed' } } } });
    await expect(page.getByRole('heading', { name: '直播间已结束' })).toBeVisible();
    expect(Math.abs(await top() - before)).toBeLessThan(2);
    await page.screenshot({ path: test.info().outputPath(`closed-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: width < 768 ? '返回直播大厅' : '返回大厅', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: width < 768 ? '今晚，还很安静。' : '暂无直播间', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新列表', exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`lobby-${width}.png`), fullPage: true });
  });
}
