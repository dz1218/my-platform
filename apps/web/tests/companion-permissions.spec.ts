import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

const match = {
  id: 'permission-match', conversationId: 'permission-conversation',
  identity: { id: 'identity', name: '陈念', age: 24, avatarUrl: '' },
};
const settings = { ownerType: 'HUMAN', mode: 'TIMEOUT', delaySeconds: 120, version: 1, canManage: false };

async function mockChat(page: Page) {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-inherited', domain: '127.0.0.1', path: '/' }]);
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket('**/api/v1/conversations/*/socket?*', (ws) => { socket = ws; });
  await page.route('**/api/v1/matches/permission-match', (route) => route.fulfill({ json: match }));
  await page.route('**/api/v1/operator/conversations', (route) => route.fulfill({ json: { items: [{ ...match, participantName: '聊天用户' }] } }));
  await page.route('**/api/v1/conversations/*/messages', (route) => route.fulfill({ json: { items: [] } }));
  const managementRequests: string[] = [];
  await page.route('**/api/v1/conversations/*/preferences', (route) => {
    managementRequests.push('preferences');
    return route.fulfill({ json: { ...settings, timezone: 'Asia/Shanghai', quietStart: 1320, quietEnd: 540, maxBatchesPer24h: 1, minGapMinutes: 480, allowProactiveAI: false } });
  });
  await page.route('**/api/v1/conversations/*/memories', (route) => {
    managementRequests.push('memories');
    return route.fulfill({ json: { items: [], proposals: [] } });
  });
  await page.route('**/api/v1/conversations/*/daily-state', (route) => {
    managementRequests.push('daily-state');
    return route.fulfill({ json: { version: 1, currentActivity: '读书', mood: '', paused: false } });
  });
  return { managementRequests, getSocket: () => socket };
}

for (const path of ['/chat/permission-match', '/operator?id=permission-conversation']) {
  test(`account without this identity has no settings even when conversation is HUMAN: ${path}`, async ({ page }) => {
    const chat = await mockChat(page);
    await page.route('**/api/v1/conversations/*/auto-reply', (route) => route.fulfill({ json: settings }));
    const response = page.waitForResponse('**/api/v1/conversations/*/auto-reply');
    await page.goto(path);
    await response;
    await expect(page.getByRole('textbox')).toBeVisible();
    await expect(page.locator('summary')).toHaveCount(0);
    expect(chat.managementRequests).toEqual([]);
  });
}

test('settings wait for confirmed assignment and disappear after revocation', async ({ page }) => {
  const chat = await mockChat(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/conversations/*/auto-reply', async (route) => {
    await pending;
    await route.fulfill({ json: { ...settings, canManage: true } });
  });
  await page.goto('/operator?id=permission-conversation');
  await expect(page.getByRole('textbox')).toBeVisible();
  await expect(page.locator('summary')).toHaveCount(0);
  expect(chat.managementRequests).toEqual([]);
  release();
  await expect(page.getByText('主动联系与虚拟日常', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '结束真人接管' })).toBeVisible();
  await page.getByText('主动联系与虚拟日常', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '真人托管时允许 AI 主动联系' })).toBeVisible();
  await expect(page.getByText('陪伴设置与记忆', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '给聊天用户发消息' }).fill('继承身份后的回复');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await expect.poll(() => !!chat.getSocket()).toBe(true);
  chat.getSocket()!.send(JSON.stringify({ type: 'auto_reply.settings_updated', settings: { ...settings, version: 2 } }));
  await expect(page.locator('summary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送', exact: false })).toBeDisabled();
});

test('settings drafts retain failed edits and actions save the latest values', async ({ page }) => {
  await mockChat(page);
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ...settings, canManage: true } }));
  let policyVersion = 1;
  let allow = false;
  await page.route('**/api/v1/conversations/*/preferences', route => route.fulfill({ json: { version: policyVersion, allowProactiveAI: allow } }));
  await page.route('**/api/v1/conversations/*/proactive-policy', async route => {
    allow = route.request().postDataJSON().allowProactiveAI;
    policyVersion++;
    await route.fulfill({ json: { version: policyVersion } });
  });
  let daily = { version: 1, currentActivity: '读书', mood: '平静', paused: false };
  let attempts = 0;
  await page.route('**/api/v1/conversations/*/daily-state', async route => {
    if (route.request().method() === 'PATCH') {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, json: { error: { message: '测试保存失败' } } });
      const value = route.request().postDataJSON();
      expect(value.fictional).toBe(true);
      expect(value.version).toBe(daily.version);
      daily = { ...value, version: daily.version + 1 };
    }
    return route.fulfill({ json: daily });
  });
  await page.goto('/operator?id=permission-conversation');
  await page.getByText('主动联系与虚拟日常', { exact: true }).click();
  const policy = page.getByRole('checkbox', { name: '真人托管时允许 AI 主动联系' });
  await policy.check();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(() => allow).toBe(true);
  await expect(policy).toBeChecked();
  await page.getByRole('textbox', { name: '虚拟活动', exact: true }).fill('在散步');
  await page.getByRole('textbox', { name: '虚拟心情', exact: true }).fill('愉快');
  await page.getByRole('checkbox', { name: '暂停此虚拟设定' }).check();
  await page.getByRole('button', { name: '保存虚拟日常', exact: true }).click();
  await expect(page.locator('details').getByRole('alert')).toHaveText('测试保存失败');
  await expect(page.getByRole('textbox', { name: '虚拟活动', exact: true })).toHaveValue('在散步');
  await page.getByRole('button', { name: '保存虚拟日常', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  expect(daily).toMatchObject({ currentActivity: '在散步', mood: '愉快', paused: true, version: 2 });
});
