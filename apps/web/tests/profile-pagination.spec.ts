import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`profile chat pagination at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
    let count = 22;
    await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: Array.from({ length: count }, (_, index) => ({
      id: `match-${index}`, conversationId: `conversation-${index}`,
      identity: { id: `friend-${index}`, name: `朋友${index + 1}`, age: 26, city: '杭州', occupation: '设计师', occupationCode: 'designer', gender: 'FEMALE', avatarUrl: '', background: '喜欢音乐。' },
    })) } }));
    await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
    await page.goto('/me');
    const list = page.getByRole('list', { name: '最近聊天', exact: true });
    const pagination = page.getByRole('navigation', { name: '聊天分页' });
    await expect(list.getByRole('listitem')).toHaveCount(6);
    await expect(page.getByRole('heading', { name: /你的聊天\s*22/ })).toBeVisible();
    await expect(pagination.getByRole('button', { name: '上一页' })).toBeDisabled();
    await pagination.getByRole('button', { name: '下一页' }).click();
    await expect(list.getByRole('link').first()).toHaveAttribute('aria-label', '继续和朋友7聊天');
    await expect(list).toBeFocused();
    await page.getByRole('tab', { name: 'AI 身份', exact: true }).click();
    await page.getByRole('tab', { name: '最近聊天', exact: true }).click();
    await expect(pagination).toContainText('第 2 / 4 页');
    await pagination.getByRole('button', { name: '下一页' }).click();
    await pagination.getByRole('button', { name: '下一页' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(pagination.getByRole('button', { name: '下一页' })).toBeDisabled();
    await page.screenshot({ path: `/tmp/profile-pagination-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    count = 8;
    await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
    await expect(pagination).toContainText('第 2 / 2 页');
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await pagination.getByRole('button', { name: '上一页' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(6);
    count = 0;
    await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
    await expect(pagination).toHaveCount(0);
    await expect(page.getByText('还没有开始的对话')).toBeVisible();
  });
}
