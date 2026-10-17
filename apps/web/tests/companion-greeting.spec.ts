import { expect, test, type Route } from '@playwright/test';

const friend = (id: string, name: string) => ({ id, name, age: 26, city: '杭州', gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' });
const first = friend('greeting-first', '林晚');
const second = friend('greeting-second', '苏禾');
const known = { id: 'known-match', conversationId: 'known-conversation', identity: friend('known-friend', '陈宁') };
const created = { id: 'greeting-match', conversationId: 'greeting-conversation', identity: second };

for (const width of [1440, 390]) {
  test(`greeting loading stays on the clicked cards at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
    await page.routeWebSocket('**/api/v1/matches/socket?*', socket => socket.send(JSON.stringify({ type: 'matches.updated', items: [known] })));
    await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [first, second, known.identity], total: 3, page: 1, nextPage: null, occupations: [] } }));
    const pending = new Map<string, Route>();
    const calls: string[] = [];
    await page.route('**/api/v1/matches', route => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { items: [known] } });
      const id = route.request().postDataJSON().identityId;
      calls.push(id);
      pending.set(id, route);
    });
    await page.route('**/api/v1/matches/*', route => route.fulfill({ json: created }));
    await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
    await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'HUMAN', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
    await page.routeWebSocket('**/api/v1/conversations/*/socket?*', () => {});
    await page.goto('/companion?view=discover');
    const firstButton = page.getByRole('button', { name: '和林晚打个招呼', exact: true });
    const secondButton = page.getByRole('button', { name: '和苏禾打个招呼', exact: true });
    await expect(firstButton).toBeEnabled();
    await firstButton.click();
    await expect.poll(() => calls.length).toBe(1);
    await expect(firstButton).toBeDisabled();
    await expect(firstButton).toHaveText('正在连接…');
    await expect(firstButton).toHaveAttribute('aria-busy', 'true');
    await expect(secondButton).toBeEnabled();
    await expect(secondButton).toHaveText('打个招呼');
    await expect(page.getByRole('link', { name: /继续聊天\s*，和陈宁/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新人物目录', exact: true })).toBeEnabled();
    await expect(page.locator('[data-skeleton]:visible')).toHaveCount(0);
    await expect(page).toHaveURL('/companion?view=discover');
    if (width === 1440) await expect(page.getByRole('complementary', { name: '最近聊天' })).toContainText('陈宁');
    await page.screenshot({ path: testInfo.outputPath(`greeting-pending-${width}.png`), fullPage: true });
    await secondButton.click();
    await expect.poll(() => calls.length).toBe(2);
    await expect(secondButton).toBeDisabled();
    await pending.get(first.id)!.fulfill({ status: 503, json: { error: { message: '旧请求失败' } } });
    await expect(firstButton).toBeEnabled();
    await expect(firstButton).toHaveText('打个招呼');
    await expect(secondButton).toBeDisabled();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await pending.get(second.id)!.fulfill({ json: created });
    await expect(page).toHaveURL('/chat/greeting-match');
    await expect(page.getByRole('textbox', { name: '给苏禾发消息' })).toBeVisible();
    expect(calls).toEqual([first.id, second.id]);
  });
}
