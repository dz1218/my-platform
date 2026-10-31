import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';
const rooms = [
  { id: 'search-waiting', title: '清晨散步', status: '准备中', viewers: 0, canManage: false },
  { id: 'search-live', title: '晚间读书', status: '直播中', viewers: 3, canManage: false },
];

test.beforeEach(async ({ request }) => { await request.post(fixture, { data: { rooms } }); });
test.afterEach(async ({ request }) => { await request.post(fixture, { data: {} }); });

for (const width of [768, 1440]) {
  test(`live search only applies submitted text at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const search = page.getByRole('search', { name: '搜索直播间', exact: true });
    const input = search.getByRole('searchbox');
    const articles = page.getByRole('article');
    await expect(articles).toHaveCount(2);

    await input.fill('不存在的房间');
    await input.press('Tab');
    await expect(articles).toHaveCount(2);
    await page.getByRole('button', { name: /^直播中/ }).click();
    await expect(articles).toHaveCount(1);
    await expect(articles).toContainText('晚间读书');
    await input.press('Enter');
    await expect(articles).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '没有找到相关直播间' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '暂无直播间', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`search-empty-${width}.png`) });

    await input.fill(' 晚间 ');
    await expect(articles).toHaveCount(0);
    await search.getByRole('button', { name: '搜索直播间', exact: true }).click();
    await expect(articles).toHaveCount(1);
    await expect(input).toHaveValue('晚间');

    await input.dispatchEvent('compositionstart');
    await input.fill('中文组合');
    await input.press('Enter');
    await expect(articles).toHaveCount(1);
    await input.dispatchEvent('compositionend');
    await input.press('Enter');
    await expect(articles).toHaveCount(0);
    await search.getByRole('button', { name: '清空搜索' }).click();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(articles).toHaveCount(1);

    await request.post(fixture, { data: { rooms: rooms.slice(0, 1) } });
    await expect(page.getByRole('heading', { name: '没有符合筛选条件的直播间' })).toBeVisible();
    await page.getByRole('button', { name: '全部', exact: true }).click();
    await expect(articles).toHaveCount(1);
    await request.post(fixture, { data: { rooms: [] } });
    await expect(page.getByRole('heading', { name: '暂无直播间', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('mobile live search submits explicitly and uses the matching empty message', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('button', { name: '查找直播间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查找直播间' });
  const input = dialog.getByRole('searchbox', { name: '搜索直播间' });
  await input.fill('不存在的房间');
  await expect(page.locator('article')).toHaveCount(2);
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  await expect(dialog).toBeVisible();
  await input.dispatchEvent('compositionend');
  await dialog.getByRole('button', { name: '查看房间', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '没有找到相关直播间' })).toBeVisible();
  await page.getByRole('button', { name: '查看全部直播间', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);

  await request.post(fixture, { data: { rooms: rooms.slice(0, 1) } });
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: '查找直播间', exact: true }).click();
  await dialog.getByRole('button', { name: /^直播中/ }).click();
  await dialog.getByRole('button', { name: '查看房间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有符合筛选条件的直播间' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
