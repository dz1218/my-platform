import { expect, test, type Page } from '@playwright/test';

const cookie = { name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' };
const novels = Array.from({ length: 25 }, (_, index) => ({
  id: `shelf-book-${index + 1}`, title: `雨夜来信 ${String(index + 1).padStart(2, '0')}`,
  description: index === 24 ? '一场星际旅行，寻找遥远的回声。' : '一座城市，两段生活，那些未曾说出口的话。',
  author: { id: 'author', name: index < 13 ? '夜行人' : '远山' },
  authorId: 'author', chapterCount: index + 1, status: 'ongoing', chapters: [],
}));

async function mockShelf(page: Page) {
  const state = { items: novels, calls: [] as URL[], failPage: 0, slowQuery: '' };
  await page.route(/\/api\/v1\/novels(?:\?|$)/, async route => {
    const url = new URL(route.request().url());
    state.calls.push(url);
    const query = (url.searchParams.get('q') ?? '').toLowerCase();
    const requestedPage = Number(url.searchParams.get('page') ?? 1);
    const filtered = state.items.filter(novel => [novel.title, novel.author.name, novel.description].some(value => value.toLowerCase().includes(query)));
    const currentPage = Math.max(1, Math.min(requestedPage, Math.ceil(filtered.length / 12)));
    if (query && query === state.slowQuery) await new Promise(resolve => setTimeout(resolve, 500));
    if (requestedPage === state.failPage) return route.fulfill({ status: 503, json: { error: { message: '书架暂时不可用' } } });
    return route.fulfill({ json: { items: filtered.slice((currentPage - 1) * 12, currentPage * 12), total: filtered.length, page: currentPage, pageSize: 12 } });
  });
  return state;
}

for (const width of [320, 390, 768, 1440]) {
  test(`bookshelf pagination, search and return at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([cookie]);
    await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
    const state = await mockShelf(page);
    await page.goto('/novels');
    const results = page.getByRole('region', { name: '小说列表' });
    const pagination = page.getByRole('navigation', { name: '书架分页' });
    const search = page.getByRole('search', { name: '搜索书架' });
    const input = search.getByRole('searchbox');
    await expect(results.getByRole('link')).toHaveCount(12);
    await expect(pagination).toContainText('第 1 / 3 页');
    await expect(pagination.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/radio-friday-review/novel-shelf-${width}.png` });
    if (width >= 768) {
      const heading = await page.getByRole('heading', { name: '书架', exact: true }).boundingBox();
      const field = await search.boundingBox();
      const create = await page.getByRole('link', { name: '创建小说', exact: true }).boundingBox();
      expect(Math.abs(field!.y - create!.y)).toBeLessThanOrEqual(2);
      expect(heading!.y).toBeGreaterThanOrEqual(field!.y);
    }
    await pagination.getByRole('button', { name: '下一页' }).click();
    await expect(pagination).toContainText('第 2 / 3 页');
    await expect(results.getByRole('link').first()).toContainText('雨夜来信 13');
    await expect(results).toBeFocused();
    await pagination.getByRole('button', { name: '下一页' }).click();
    await expect(results.getByRole('link')).toHaveCount(1);
    await expect(pagination.getByRole('button', { name: '下一页' })).toBeDisabled();

    const reads = state.calls.length;
    await input.fill('  星际旅行  ');
    expect(state.calls).toHaveLength(reads);
    await input.press('Enter');
    await expect(input).toHaveValue('星际旅行');
    await expect(results.getByRole('link')).toHaveCount(1);
    await expect(results.getByRole('link')).toContainText('雨夜来信 25');
    expect(state.calls.at(-1)?.searchParams.get('page')).toBeNull();
    await expect(pagination).toHaveCount(0);
    await search.getByRole('button', { name: '清空搜索' }).click();
    await expect(results.getByRole('link')).toHaveCount(12);
    await expect(pagination).toContainText('第 1 / 3 页');

    await input.fill('夜行人');
    await search.getByRole('button', { name: '搜索小说' }).click();
    await expect(pagination).toContainText('第 1 / 2 页');
    await pagination.getByRole('button', { name: '下一页' }).click();
    await expect(results.getByRole('link')).toHaveCount(1);
    const filteredReads = state.calls.length;
    const navigation = page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true });
    await navigation.getByRole('link', { name: '我的', exact: true }).click();
    await expect(page).toHaveURL('/me', { timeout: 15_000 });
    await navigation.getByRole('link', { name: '小说', exact: true }).click();
    await expect(page).toHaveURL('/novels');
    await expect(input).toHaveValue('夜行人');
    await expect(pagination).toContainText('第 2 / 2 页');
    expect(state.calls).toHaveLength(filteredReads);

    await input.fill('没有这本书');
    await input.press('Enter');
    await expect(results).toContainText('没有找到相关小说');
    await expect(results.getByRole('link')).toHaveCount(0);
    await expect(pagination).toHaveCount(0);
    await results.getByRole('button', { name: '清空搜索' }).click();
    await expect(results.getByRole('link')).toHaveCount(12);
  });
}

test('bookshelf recovers a failed page and clamps the last page after refresh', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await context.addCookies([cookie]);
  const state = await mockShelf(page);
  await page.goto('/novels');
  const results = page.getByRole('region', { name: '小说列表' });
  const pagination = page.getByRole('navigation', { name: '书架分页' });
  await expect(results.getByRole('link')).toHaveCount(12);
  state.failPage = 2;
  await pagination.getByRole('button', { name: '下一页' }).click();
  await expect(results.getByRole('alert')).toContainText('书架暂时加载失败');
  await expect(pagination.getByRole('button', { name: '上一页' })).toBeEnabled();
  state.failPage = 0;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(pagination).toContainText('第 2 / 3 页');
  await pagination.getByRole('button', { name: '下一页' }).click();
  await expect(results.getByRole('link')).toHaveCount(1);
  state.failPage = 3;
  await page.getByRole('button', { name: '刷新当前页面', exact: true }).focus();
  await page.getByRole('button', { name: '刷新当前页面', exact: true }).press('Enter');
  await expect(results.getByRole('alert')).toContainText('书架更新失败，已保留上次内容');
  await expect(results.getByRole('link')).toHaveCount(1);
  state.failPage = 0;
  state.items = novels.slice(0, 13);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(pagination).toContainText('第 2 / 2 页');
  await expect(results.getByRole('link')).toHaveCount(1);
  await expect(results.getByRole('link')).toContainText('雨夜来信 13');
  await page.screenshot({ path: '/tmp/radio-friday-review/novel-shelf-pagination-390.png', fullPage: true });
});

test('a newer search wins over a slow response', async ({ page, context }) => {
  await context.addCookies([cookie]);
  const state = await mockShelf(page);
  state.slowQuery = '雨夜';
  await page.goto('/novels');
  const input = page.getByRole('searchbox');
  const results = page.getByRole('region', { name: '小说列表' });
  await expect(results.getByRole('link')).toHaveCount(12);
  await input.fill('雨夜');
  await input.press('Enter');
  await expect.poll(() => state.calls.at(-1)?.searchParams.get('q')).toBe('雨夜');
  await input.fill('星际旅行');
  await input.press('Enter');
  await expect(results.getByRole('link')).toHaveCount(1);
  await expect(results.getByRole('link')).toContainText('雨夜来信 25');
  await page.waitForTimeout(600);
  await expect(results.getByRole('link')).toHaveCount(1);
  await expect(input).toHaveValue('星际旅行');
});
