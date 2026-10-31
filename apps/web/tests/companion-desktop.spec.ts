import { expect, test, type Page } from '@playwright/test';

const occupations = [{ code: 'designer', name: '设计师' }, { code: 'teacher', name: '教师' }];
const friends = [
  { id: 'desktop-lin', name: '林知夏', age: 26, city: '杭州', occupationCode: 'designer', occupation: '设计师', background: '在杭州生活，是一名设计师。喜欢逛小书店，偶尔会为了一个好看的落日绕路。最近在学做咖啡。' },
  { id: 'desktop-wu', name: '吴知夏', age: 29, city: '珠海', occupationCode: 'teacher', occupation: '教师', background: '周末常沿着海边慢慢走。比起热闹的聚会，更喜欢一场不用赶时间的聊天。' },
  { id: 'desktop-yu', name: '余以宁', age: 32, city: '福州', occupationCode: 'designer', occupation: '设计师', background: '喜欢旧电影和雨天。会记住朋友随口提起的小事，也愿意分享生活里的新发现。' },
  ...['乔念初', '秦书瑶', '陈宁', '苏禾', '沈云舒'].map((name, i) => ({ id: `desktop-${i}`, name, age: 24 + i, city: '上海', occupationCode: 'teacher', occupation: '教师', background: '闲下来喜欢读书、散步，听朋友讲讲今天发生的事。' })),
].map(identity => ({ ...identity, gender: 'FEMALE', avatarUrl: '' }));
const matches = friends.slice(1).map(identity => ({ id: `match-${identity.id}`, conversationId: `conversation-${identity.id}`, identity }));

async function setup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  await page.routeWebSocket('**/api/v1/matches/socket?*', socket => socket.send(JSON.stringify({ type: 'matches.updated', items: matches })));
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: matches } }));
  const requests: URL[] = [];
  await page.route('**/api/v1/discover?*', route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const q = url.searchParams.get('q') || '';
    const code = url.searchParams.get('occupationCode');
    const items = friends.filter(item => item.name.includes(q) && (!code || item.occupationCode === code) && item.age >= Number(url.searchParams.get('ageMin') || 18) && item.age <= Number(url.searchParams.get('ageMax') || 50));
    return route.fulfill({ json: { items, total: items.length, page: 1, nextPage: null, occupations } });
  });
  await page.goto('/companion');
  await expect(page.getByRole('button', { name: '和林知夏打个招呼' })).toBeEnabled();
  return requests;
}

test('desktop filters apply explicitly, discard cancelled edits and clear independently', async ({ page }, testInfo) => {
  const requests = await setup(page);
  const search = page.getByRole('searchbox', { name: '搜索名字', exact: true });
  const trigger = page.getByRole('button', { name: /^筛选朋友/ });
  const form = page.getByRole('form', { name: '筛选角色' });
  await search.fill('夏');
  await search.press('Enter');
  await expect(page.locator('[data-identity-id]')).toHaveCount(2);
  await trigger.click();
  await page.getByRole('combobox', { name: '职业', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索职业' }).fill('设计');
  await page.getByRole('option', { name: '设计师', exact: true }).click();
  await form.getByRole('spinbutton', { name: '最小年龄' }).fill('24');
  await form.getByRole('spinbutton', { name: '最大年龄' }).fill('28');
  expect(requests.at(-1)?.searchParams.get('occupationCode')).toBeNull();
  await page.screenshot({ path: testInfo.outputPath('desktop-filter-open.png') });
  await form.getByRole('button', { name: '应用筛选' }).click();
  await expect(form).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-identity-id]')).toHaveCount(1);
  expect(requests.at(-1)?.searchParams.get('occupationCode')).toBe('designer');
  expect(requests.at(-1)?.searchParams.get('q')).toBe('夏');
  await trigger.click();
  await form.getByRole('button', { name: '重置', exact: true }).click();
  await page.keyboard.press('Escape');
  await trigger.click();
  await expect(form.getByRole('combobox', { name: '职业' })).toHaveText('设计师');
  await expect(form.getByRole('spinbutton', { name: '最小年龄' })).toHaveValue('24');
  await form.getByRole('spinbutton', { name: '最大年龄' }).fill('20');
  const countBefore = requests.length;
  await form.getByRole('button', { name: '应用筛选' }).click();
  await expect(form).toBeVisible();
  expect(requests).toHaveLength(countBefore);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '移除筛选：设计师' }).click();
  await expect(page.getByRole('button', { name: '移除筛选：24–28 岁' })).toBeVisible();
  await page.getByRole('button', { name: '清除全部' }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('[data-identity-id]')).toHaveCount(friends.length);
  await search.fill('不存在的人');
  await search.press('Enter');
  await expect(page.getByText('没有找到符合条件的朋友', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除全部', exact: true }).click();
  await expect(page.locator('[data-identity-id]')).toHaveCount(friends.length);
});

test('desktop cards fit the first screen, recent chats are capped and all chats opens the right tab', async ({ page }, testInfo) => {
  await setup(page);
  await expect(page.locator('.scene-banner')).toHaveCount(0);
  const rail = page.getByRole('complementary', { name: '最近聊天' });
  await expect(rail.getByRole('listitem')).toHaveCount(6);
  for (const width of [1440, 1100, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '和林知夏打个招呼' })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`desktop-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '我的', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 身份' }).click();
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '陪伴', exact: true }).click();
  await rail.getByRole('link', { name: '查看全部' }).click();
  await expect(page).toHaveURL('/me');
  await expect(page.getByRole('tab', { name: '最近聊天' })).toHaveAttribute('aria-selected', 'true');
});

test('desktop whole-card entry retains the existing guest authentication flow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: friends, total: friends.length, page: 1, nextPage: null, occupations } }));
  await page.goto('/companion');
  const card = page.locator('[data-identity-id="desktop-lin"]');
  await expect(card.getByRole('button')).toBeEnabled();
  await card.click({ position: { x: 24, y: 24 } });
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
});
