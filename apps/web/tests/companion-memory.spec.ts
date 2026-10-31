import { expect, test, type Page } from '@playwright/test';
const match = { id: 'memory-match', conversationId: 'memory-conversation', identity: { id: 'memory-identity', name: '林晚', age: 27, avatarUrl: '' } };
async function mock(page: Page) {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-inherited', domain: '127.0.0.1', path: '/' }]);
  await page.routeWebSocket('**/api/v1/conversations/*/socket?*', () => {});
  await page.route('**/api/v1/matches/memory-match', route => route.fulfill({ json: match }));
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'AI', mode: 'ALWAYS', delaySeconds: 15, version: 1, canManage: false, canManageMemory: true } }));
  let preferences = { enabled: false, version: 1, consentVersion: 0 };
  let items = [{ id: 'm1', content: '我喜欢喝咖啡', kind: 'PREFERENCE', sourceMessageId: '12', version: 1, manual: false }];
  let proposals = [{ id: 'p1', content: '我准备去成都旅行', kind: 'EXPERIENCE', sourceMessageId: '15', version: 1, manual: false, reason: '计划、假设或不确定内容' }];
  const writes: string[] = [];
  await page.route('**/api/v1/conversations/*/memory-preferences', async route => {
    if (route.request().method() === 'PATCH') { const body = route.request().postDataJSON(); expect(body.version).toBe(preferences.version); expect(body.consentVersion).toBe(2); preferences = { enabled: body.enabled, version: preferences.version + 1, consentVersion: 2 }; writes.push('preferences'); }
    await route.fulfill({ json: preferences });
  });
  await page.route('**/api/v1/conversations/*/memories', async route => {
    if (route.request().method() === 'POST') { const body = route.request().postDataJSON(); expect(body.version).toBe(items[0].version); items = items.map(m => ({ ...m, content: body.content, version: m.version + 1, manual: true })); preferences.version++; writes.push('edit'); }
    await route.fulfill({ json: { items, proposals } });
  });
  await page.route('**/api/v1/conversations/*/memory-proposals/*/resolve', async route => { const body = route.request().postDataJSON(); expect(body.version).toBe(1); if (body.accept) items.push(proposals[0]); proposals = []; preferences.version++; writes.push('resolve'); await route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/v1/conversations/*/memories/*/delete', async route => { const body = route.request().postDataJSON(); expect(body.version).toBe(items[0].version); items = items.slice(1); preferences.version++; writes.push('delete'); await route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/v1/conversations/*/memories/clear', async route => { expect(route.request().postDataJSON().version).toBe(preferences.version); items = []; proposals = []; preferences.version++; writes.push('clear'); await route.fulfill({ json: { ok: true } }); });
  return writes;
}
for (const width of [390, 1440]) {
  test(`participant manages memory without identity-management privileges at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 850 }); const writes = await mock(page);
    await page.goto('/chat/memory-match');
    await expect(page.locator('#conversation-settings')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: '林晚', exact: true })).toBeVisible();
    await expect(page.getByText(/当前使用本账户|AI 与真人共同参与|正在回复|正在输入/)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`chat-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '会话设置' }).click();
    await expect(page.getByRole('checkbox', { name: '自动记住这段聊天' })).toBeVisible();
    await expect(page.getByText('主动联系与虚拟日常', { exact: true })).toHaveCount(0);
    await expect(page.getByText('我喜欢喝咖啡', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: '自动记住这段聊天' }).check();
    await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('textbox', { name: '编辑记忆' }).fill('我现在更喜欢茶');
    await page.getByRole('button', { name: '保存记忆' }).click();
    await expect(page.getByText('我现在更喜欢茶', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`memory-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '记住', exact: true }).click();
    await expect(page.getByRole('region', { name: '待确认', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '删除', exact: true }).first().click();
    expect(writes).not.toContain('delete');
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByText('我现在更喜欢茶', { exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: '自动记住这段聊天' }).uncheck();
    await expect(page.getByText('已停止记忆整理和回忆。已有记忆仍可查看、删除。')).toBeVisible();
    await page.getByRole('button', { name: '清空全部记忆' }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByText('还没有保存的记忆。')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('dialog[open]')).toHaveCount(0); await expect(page.getByRole('button', { name: '会话设置' })).toBeFocused();
    expect(writes).toEqual(['preferences', 'edit', 'resolve', 'delete', 'preferences', 'clear']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
