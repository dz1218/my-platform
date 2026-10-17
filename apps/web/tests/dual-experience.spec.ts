import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const identity = { id: 'design-friend', name: '林晚', age: 26, city: '杭州', occupation: '设计师', occupationCode: 'designer', gender: 'FEMALE', avatarUrl: '', background: '喜欢雨天的书店、窗边的音乐，也愿意认真听你说说今天。' };
const match = { id: 'design-match', conversationId: 'design-conversation', identity };
const occupations = [{ code: 'designer', name: '设计师' }];

async function setup(page: Page, recent = true) {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  let matches = recent ? [match] : [];
  let sockets = 0;
  let sends = 0;
  let matchReads = 0;
  const queries: string[] = [];
  await page.route('**/api/v1/discover?*', route => {
    queries.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { items: [identity, { ...identity, id: 'design-other', name: '沈知远', background: identity.background.repeat(4) }], total: 2, page: 1, nextPage: null, occupations } });
  });
  await page.route('**/api/v1/matches', route => {
    if (route.request().method() === 'GET') matchReads++;
    return route.fulfill({ json: route.request().method() === 'POST' ? match : { items: matches } });
  });
  await page.route('**/api/v1/matches/*', route => route.fulfill({ json: match }));
  await page.route('**/api/v1/operator/conversations', route => route.fulfill({ json: { items: [{ ...match, participantName: '来信的人' }] } }));
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'HUMAN', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
  await page.route('**/api/v1/identity-inheritance', route => route.fulfill({ json: { gender: 'FEMALE', onboardingCompleted: true, identity: null, items: [] } }));
  await page.route('**/api/v1/identity-inheritance/options?*', route => route.fulfill({ json: { items: [{ ...identity, available: true }], total: 1, page: 1, nextPage: null, occupations } }));
  await page.routeWebSocket('**/api/v1/matches/socket?*', socket => { socket.send(JSON.stringify({ type: 'matches.updated', items: matches })); });
  await page.routeWebSocket('**/api/v1/conversations/*/socket?*', socket => {
    sockets++;
    socket.onMessage(raw => {
      const data = JSON.parse(String(raw));
      if (data.type !== 'send') return;
      sends++;
      socket.send(JSON.stringify({ type: 'accepted', requestId: data.requestId, message: { id: String(100 + sends), sender: { id: 'self', name: '我' }, senderType: 'user', source: 'USER', content: data.content, status: 'complete', requestId: data.requestId, createdAt: new Date().toISOString() } }));
    });
  });
  return { sockets: () => sockets, sends: () => sends, matchReads: () => matchReads, queries, setRecent: (value: boolean) => { matches = value ? [match] : []; } };
}

test('mobile defaults, explicit tabs, staged filters and browser history', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/companion');
  const recent = page.getByRole('button', { name: '最近聊天', exact: true });
  await expect(recent).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeVisible();
  await expect(page.locator('.scene-banner')).toHaveCount(0);
  await page.getByRole('button', { name: '发现朋友', exact: true }).click();
  await expect(page).toHaveURL('/companion?view=discover');
  await page.getByRole('button', { name: '筛选朋友', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '筛选朋友' });
  await sheet.getByRole('combobox', { name: '职业', exact: true }).click();
  await sheet.getByRole('option', { name: '设计师', exact: true }).click();
  await sheet.getByRole('button', { name: '关闭筛选朋友' }).click();
  await page.getByRole('button', { name: '筛选朋友', exact: true }).click();
  await expect(sheet.getByRole('combobox', { name: '职业', exact: true })).toHaveText('全部职业');
  await sheet.getByRole('combobox', { name: '职业', exact: true }).click();
  await sheet.getByRole('option', { name: '设计师', exact: true }).click();
  await sheet.getByRole('button', { name: '应用' }).click();
  await expect.poll(() => state.queries.at(-1)).toContain('occupationCode=designer');
  await page.getByRole('button', { name: '筛选朋友，1 项条件' }).click();
  await sheet.getByRole('button', { name: '重置' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '筛选朋友，1 项条件' })).toBeFocused();
  await page.getByRole('link', { name: /继续聊天\s*，和林晚/ }).click();
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL('/companion?view=discover');
  await expect(page.getByRole('button', { name: '筛选朋友，1 项条件' })).toBeVisible();
  await page.goBack();
  await expect(recent).toHaveAttribute('aria-pressed', 'true');
  await page.goForward();
  await expect(page.getByRole('button', { name: '发现朋友', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('empty conversations default to discover and an explicit tab stays selected', async ({ page }) => {
  const state = await setup(page, false);
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/companion');
  await expect(page.getByRole('button', { name: '发现朋友', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '最近聊天', exact: true }).click();
  const reads = state.matchReads();
  state.setRecent(true);
  await page.clock.runFor(16_000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  await page.clock.runFor(500);
  expect(state.matchReads()).toBe(reads);
  await expect(page.getByRole('link', { name: /林晚/ })).toHaveCount(0);
  await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
  await expect(page.getByRole('link', { name: /林晚/ })).toBeVisible();
  expect(state.matchReads()).toBe(reads + 1);
  await expect(page.getByRole('heading', { name: '接着上次的故事' })).toBeVisible();
  await expect(page.getByRole('button', { name: '最近聊天', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('chat keeps its socket and draft across breakpoints and uses device-appropriate Enter behavior', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chat/design-match');
  const input = page.getByRole('textbox', { name: '给林晚发消息' });
  await expect(input).toBeEnabled();
  await input.fill('第一行');
  await input.press('Enter');
  await expect(input).toHaveValue('第一行\n');
  expect(state.sends()).toBe(0);
  const connections = state.sockets();
  for (const width of [1440, 390, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(input).toHaveValue('第一行\n');
    await expect(page.locator('.chat-layout')).toHaveCount(1);
  }
  expect(state.sockets()).toBe(connections);
  await page.getByRole('button', { name: '发送', exact: false }).click();
  await expect(input).toHaveValue('');
  expect(state.sends()).toBe(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await input.fill('桌面消息');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect(state.sends()).toBe(1);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  expect(state.sends()).toBe(2);
});

test('mobile create-room sheet uses the same mutation and retains title across resizing', async ({ page }) => {
  await setup(page);
  let creates = 0;
  const rooms: Array<{ id: string; title: string; status: string; viewers: number; canManage: boolean }> = [];
  await page.route('**/api/v1/rooms', route => {
    if (route.request().method() === 'POST') {
      creates++;
      rooms.push({ id: 'design-room', title: route.request().postDataJSON().title, status: '准备中', viewers: 0, canManage: true });
      return route.fulfill({ status: 201, json: { item: rooms[0] } });
    }
    return route.fulfill({ json: { items: rooms } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/live');
  await expect(page.getByRole('textbox', { name: '房间名称' })).toHaveCount(0);
  await page.getByRole('button', { name: '开播', exact: true }).click();
  await page.getByRole('textbox', { name: '房间名称' }).fill('雨夜来信');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('dialog', { name: '我的直播间', exact: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: '房间名称' })).toHaveValue('雨夜来信');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '开播', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '房间名称' })).toHaveValue('雨夜来信');
  await page.getByRole('button', { name: '创建直播间', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: '进入我的直播间' })).toBeVisible();
  expect(creates).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: '我的直播间', exact: true })).toBeVisible();
});

test.afterEach(async ({ request }) => { await request.post('http://127.0.0.1:18181/__performance', { data: {} }); });

test('four-width page review, warm theme, long content and immersive route coverage', async ({ page }) => {
  test.setTimeout(180_000);
  await setup(page);
  await page.request.post('http://127.0.0.1:18181/__performance', { data: { rooms: [{ id: 'design-room', title: '雨夜的电台，聊聊那些还没来得及说完的故事', status: '准备中', viewers: 0, canManage: false }] } });
  await mkdir('/tmp/radio-friday-review', { recursive: true });
  await page.route('**/api/v1/rooms/*/join', route => route.fulfill({ status: 503, json: { error: { message: '测试：暂时无法连接，请重试' } } }));
  await page.route('**/api/v1/rooms', route => route.fulfill({ json: { items: [{ id: 'design-room', title: '雨夜的电台，聊聊那些还没来得及说完的故事', status: '准备中', viewers: 0, canManage: false }] } }));
  const routes = ['/companion?view=discover', '/companion?view=recent', '/chat/design-match', '/live', '/live/design-room', '/novels', '/novels/design-novel', '/novels/design-novel/chapters/design-chapter', '/novels/create', '/novels/design-novel/edit', '/novels/design-novel/chapters/design-chapter/edit', '/me', '/choose-identity', '/privacy'];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [index, path] of routes.entries()) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.locator('[data-app-startup]')).toHaveCount(0);
      await expect(page.getByRole('status', { name: '正在准备页面…', exact: true })).toHaveCount(0);
      if (path.startsWith('/companion?view=discover')) await expect(page.getByRole('button', { name: '和沈知远打个招呼' })).toBeVisible();
      if (path === '/live') await expect(page.getByRole('article')).toBeVisible();
      const immersive = path.startsWith('/chat/') || path.startsWith('/live/') || path.endsWith('/design-chapter');
      const nav = page.getByRole('navigation', { name: '手机主导航' });
      if (width < 768 && !immersive) await expect(nav).toBeVisible(); else await expect(nav).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: ${path}`).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(27, 27, 25)');
      await page.screenshot({ path: `/tmp/radio-friday-review/${width}-${index}-${path.split('?')[0].replaceAll('/', '_')}.png`, fullPage: true });
    }
  }
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-inherited', domain: '127.0.0.1', path: '/' }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/operator?id=design-conversation');
  await expect(page.getByRole('heading', { name: '与来信的人的对话' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeHidden();
  await page.getByRole('link', { name: '返回我的 AI 身份' }).click();
  await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeVisible();
  await page.screenshot({ path: '/tmp/radio-friday-review/mobile-operator.png', fullPage: true });
});
