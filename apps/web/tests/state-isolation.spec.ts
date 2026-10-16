import { expect, test } from '@playwright/test';

test('draft survives client navigation but is cleared when logging into a different account', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  const identity = { id: 'scope-friend', name: '状态隔离测试朋友', age: 26, avatarUrl: '', gender: 'FEMALE' };
  const match = { id: 'scope-match', conversationId: 'scope-conversation', identity };
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [identity], total: 1, page: 1, nextPage: null, occupations: [] } }));
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [match] } }));
  await page.route('**/api/v1/matches/scope-match', route => route.fulfill({ json: match }));
  await page.route('**/api/v1/conversations/scope-conversation/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/scope-conversation/auto-reply', route => route.fulfill({ json: { ownerType: 'AI', mode: 'ALWAYS', version: 1, canManage: false } }));
  await page.routeWebSocket('**/ws/conversations/*', () => {});
  await page.routeWebSocket('**/ws/matches', () => {});

  await page.goto('/chat/scope-match');
  const input = page.getByRole('textbox', { name: '给状态隔离测试朋友发消息' });
  await expect(input).toBeEnabled();
  await input.fill('只属于第一个账户的草稿');
  // A full reload would hide a leaking module singleton, so verify this stays
  // within the same browser document through logout and the next login.
  await page.evaluate(() => { document.documentElement.dataset.stateScopeTest = 'same-document'; });
  await page.getByRole('link', { name: '返回陪伴', exact: true }).click();
  await page.getByRole('link', { name: '状态隔离测试朋友 继续你们的对话', exact: true }).click();
  await expect(input).toHaveValue('只属于第一个账户的草稿');
  await page.getByRole('button', { name: '返回陪伴', exact: true }).click();
  await expect(page.getByRole('link', { name: '状态隔离测试朋友 继续你们的对话', exact: true })).toBeFocused();
  await page.getByRole('button', { name: /账户与身份 ·/ }).click();
  await page.getByRole('navigation', { name: '账户与身份', exact: true }).getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('link', { name: '登录 / 注册', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '登录 / 注册', exact: true }).click();
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800138000');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  await expect(page.getByRole('button', { name: /账户与身份 · 第二测试用户/ })).toBeVisible();
  await page.getByRole('link', { name: '状态隔离测试朋友 继续你们的对话', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('html')).toHaveAttribute('data-state-scope-test', 'same-document');
  expect(errors).toEqual([]);
});
