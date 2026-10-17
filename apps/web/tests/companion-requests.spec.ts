import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

const identity = { id: 'request-friend', name: '林晚', age: 26, city: '杭州', gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' };
const match = { id: 'request-match', conversationId: 'request-conversation', identity };
const secondMatch = { id: 'request-second-match', conversationId: 'request-second-conversation', identity: { ...identity, id: 'request-second-friend', name: '苏禾' } };

async function setup(page: Page) {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  const requests: string[] = [];
  let matchReads = 0;
  let items = [match];
  const accountSockets = new Set<WebSocketRoute>();
  let accountConnections = 0;
  let pongs = 0;
  await page.routeWebSocket('**/ws/matches', socket => {
    accountConnections++;
    accountSockets.add(socket);
    socket.onClose(() => { accountSockets.delete(socket); });
    socket.onMessage(raw => { if (JSON.parse(String(raw)).type === 'pong') pongs++; });
    socket.send(JSON.stringify({ type: 'matches.updated', items }));
  });
  page.on('request', request => {
    const url = new URL(request.url());
    // Link visibility can schedule prefetch after the initial content settles;
    // count every business read and only actual route work for this assertion.
    if (url.pathname.startsWith('/api/v1/') || (url.searchParams.has('_rsc') && request.headers()['next-router-prefetch'] !== '1')) requests.push(request.url());
  });
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [identity], total: 1, page: 1, nextPage: null, occupations: [] } }));
  await page.route('**/api/v1/matches', route => {
    matchReads++;
    return route.fulfill({ json: { items } });
  });
  await page.route('**/api/v1/matches/*', route => route.fulfill({ json: match }));
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'HUMAN', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
  await page.routeWebSocket('**/ws/conversations/*', socket => {
    socket.onMessage(raw => {
      const command = JSON.parse(String(raw));
      if (command.type === 'send') socket.send(JSON.stringify({ type: 'accepted', requestId: command.requestId, message: { id: '101', sender: { id: 'self', name: '我' }, senderType: 'user', source: 'USER', content: command.content, status: 'complete', requestId: command.requestId, createdAt: new Date().toISOString() } }));
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/companion');
  await expect(page.getByRole('link', { name: /继续聊天\s*，和林晚/ })).toBeVisible();
  return {
    requests,
    matchReads: () => matchReads,
    setMatches: (next: typeof items) => { items = next; },
    pushMatches: (next: typeof items) => {
      items = next;
      for (const socket of accountSockets) socket.send(JSON.stringify({ type: 'matches.updated', items }));
    },
    accountConnections: () => accountConnections,
    activeAccountSockets: () => accountSockets.size,
    heartbeat: () => { for (const socket of accountSockets) socket.send(JSON.stringify({ type: 'ping' })); },
    pongs: () => pongs,
    disconnectAccount: async () => {
      for (const socket of [...accountSockets]) {
        accountSockets.delete(socket);
        await socket.close({ code: 1011, reason: 'test disconnect' });
      }
    },
  };
}

test('chat intent warms HTTP data without connecting and reuses the known match on entry', async ({ page }) => {
  const state = await setup(page);
  const sockets: string[] = [];
  page.on('websocket', socket => { if (socket.url().includes('/ws/conversations/')) sockets.push(socket.url()); });
  state.requests.length = 0;
  const link = page.getByRole('link', { name: /继续聊天\s*，和林晚/ });
  await link.hover();
  await expect.poll(() => state.requests.some(url => url.includes('/conversations/request-conversation/messages'))).toBe(true);
  expect(sockets).toEqual([]);
  await link.click();
  await expect(page.getByRole('textbox', { name: '给林晚发消息' })).toBeVisible();
  expect(state.requests.filter(url => new URL(url).pathname === '/api/v1/matches/request-match')).toEqual([]);
});

test('idle and refocused companion keeps cached matches until manual refresh', async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  const before = state.matchReads();
  state.setMatches([]);
  await page.clock.runFor(31_000);
  expect(state.matchReads()).toBe(before);
  await expect(page.getByText('你们的故事，从这里开始', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  await page.clock.runFor(500);
  expect(state.matchReads()).toBe(before);
  await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
  await expect.poll(state.matchReads).toBe(before + 1);
  await expect(page.getByText('你们的故事，从这里开始', { exact: true })).toBeVisible();
});

test('sidebar toggle and repeated home links do not request data or refresh the route', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(state.activeAccountSockets).toBe(1);
  const connections = state.accountConnections();
  state.requests.length = 0;
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await page.getByRole('button', { name: '展开侧边栏' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('link', { name: 'Radio Friday 首页' }).click();
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '陪伴', exact: true }).click();
  await page.getByRole('button', { name: /账户与身份 ·/ }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  expect(state.requests).toEqual([]);
  expect(state.accountConnections()).toBe(connections);
});

test('other conversations update recent order while home stays visible without HTTP polling', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(state.activeAccountSockets).toBe(1);
  const recent = page.locator('.conversation-rail li');
  state.pushMatches([match, secondMatch]);
  await expect(recent).toHaveCount(2);
  await expect(recent.first()).toContainText('林晚');
  const reads = state.matchReads();
  // A reply in the other conversation moves it to the top without navigation.
  state.pushMatches([secondMatch, match]);
  await expect(recent.first()).toContainText('苏禾');
  await expect(recent.last()).toContainText('林晚');
  expect(state.matchReads()).toBe(reads);
  await expect(page).toHaveURL('/companion');
  const connections = state.accountConnections();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('section[aria-labelledby="recent-heading"] li').first()).toContainText('苏禾');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(recent.first()).toContainText('苏禾');
  expect(state.accountConnections()).toBe(connections);
});

test('heartbeats keep an idle account connection alive and a silent connection recovers', async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  await expect.poll(state.activeAccountSockets).toBe(1);
  const connections = state.accountConnections();
  const reads = state.matchReads();
  for (let i = 1; i <= 3; i++) {
    await page.clock.runFor(20_000);
    state.heartbeat();
    await expect.poll(state.pongs).toBe(i);
  }
  expect(state.accountConnections()).toBe(connections);
  expect(state.matchReads()).toBe(reads);
  state.setMatches([secondMatch, match]);
  await page.clock.runFor(47_000);
  await expect.poll(state.accountConnections).toBeGreaterThan(connections);
  await expect(page.locator('.conversation-rail li').first()).toContainText('苏禾');
});

test('account snapshots update the shared profile list without reconnecting or issuing HTTP', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(state.activeAccountSockets).toBe(1);
  const connections = state.accountConnections();
  const reads = state.matchReads();
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await nav.getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/me');
  await expect(page.getByRole('link', { name: '继续和林晚聊天', exact: true })).toBeVisible();
  state.pushMatches([secondMatch, match]);
  await expect(page.getByRole('link', { name: '继续和苏禾聊天', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: '陪伴', exact: true }).click();
  await expect(page.locator('.conversation-rail li').first()).toContainText('苏禾');
  expect(state.matchReads()).toBe(reads);
  expect(state.accountConnections()).toBe(connections);
  expect(state.activeAccountSockets()).toBe(1);
});

test('account socket reconnect restores missed changes and survives ordinary tab navigation', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(state.activeAccountSockets).toBe(1);
  const connections = state.accountConnections();
  await state.disconnectAccount();
  state.setMatches([secondMatch, match]);
  await expect.poll(state.accountConnections).toBeGreaterThan(connections);
  await expect(page.locator('.conversation-rail li').first()).toContainText('苏禾');
  await expect.poll(state.activeAccountSockets).toBe(1);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/me');
  await expect.poll(state.activeAccountSockets).toBe(1);
  await expect(page.getByRole('link', { name: '继续和苏禾聊天', exact: true })).toBeVisible();
});

test('a socket snapshot wins over a stale HTTP response still in flight', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(state.activeAccountSockets).toBe(1);
  let started = false;
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/matches', async route => {
    started = true;
    await held;
    await route.fulfill({ json: { items: [match] } }).catch(() => {});
  });
  try {
    await page.getByRole('button', { name: '刷新最近聊天', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    state.pushMatches([secondMatch, match]);
    await expect(page.locator('.conversation-rail li').first()).toContainText('苏禾');
    release();
    await page.waitForTimeout(200);
    await expect(page.locator('.conversation-rail li').first()).toContainText('苏禾');
  } finally {
    release();
  }
});

test('home link still returns from chat and refreshes matches invalidated by a WebSocket send', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('link', { name: /继续聊天\s*，和林晚/ }).click();
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  const before = state.matchReads();
  await page.getByRole('textbox', { name: '给林晚发消息' }).fill('你好');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('你好', { exact: true })).toBeVisible();
  expect(state.matchReads()).toBe(before);
  await page.getByRole('link', { name: 'Radio Friday 首页' }).click();
  await expect(page).toHaveURL('/companion');
  await expect(page.getByTestId('chat-overlay')).toHaveCount(0);
  await expect.poll(state.matchReads).toBe(before + 1);
});

test('WebSocket receives and deduplicates messages, resumes after disconnect, and refreshes home on return', async ({ page }) => {
  const state = await setup(page);
  const sockets: WebSocketRoute[] = [];
  const active = new Set<WebSocketRoute>();
  await page.routeWebSocket('**/ws/conversations/*', socket => {
    sockets.push(socket);
    active.add(socket);
    socket.onClose(() => { active.delete(socket); });
  });
  await page.getByRole('link', { name: /继续聊天\s*，和林晚/ }).click();
  // Strict Mode may open and immediately dispose of the first development socket.
  await expect.poll(() => active.size).toBe(1);
  const current = [...active][0];
  const connectionCount = sockets.length;
  const message = (id: string, content: string) => ({ id, content, sender: { id: identity.id, name: identity.name }, senderType: 'identity', source: 'AI', status: 'complete', createdAt: new Date().toISOString() });
  const first = message('102', '第一条实时回复');
  current.send(JSON.stringify({ type: 'history', page: { items: [first] } }));
  current.send(JSON.stringify({ type: 'message.created', message: first }));
  await expect(page.getByText(first.content, { exact: true })).toHaveCount(1);
  const before = state.matchReads();
  await current.close({ code: 1011, reason: 'test reconnect' });
  await expect.poll(() => sockets.length).toBe(connectionCount + 1);
  const resumed = sockets.at(-1)!;
  expect(new URL(resumed.url()).searchParams.get('after')).toBe('102');
  const missed = message('103', '断线期间的回复');
  resumed.send(JSON.stringify({ type: 'history', page: { items: [first, missed] } }));
  await expect(page.getByText(first.content, { exact: true })).toHaveCount(1);
  await expect(page.getByText(missed.content, { exact: true })).toHaveCount(1);
  expect(state.matchReads()).toBe(before);
  await page.getByRole('link', { name: 'Radio Friday 首页' }).click();
  await expect(page).toHaveURL('/companion');
  await expect.poll(state.matchReads).toBe(before + 1);
});

async function startDelayedGreeting(page: Page) {
  const state = await setup(page);
  const friend = { ...identity, id: 'delayed-friend', name: '迟来朋友' };
  const created = { id: 'delayed-match', conversationId: 'delayed-conversation', identity: friend };
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [friend], total: 1, page: 1, nextPage: null, occupations: [] } }));
  await page.getByRole('button', { name: '刷新人物目录', exact: true }).click();
  const greeting = page.getByRole('button', { name: '和迟来朋友打个招呼', exact: true });
  await expect(greeting).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  let connections = 0;
  await page.routeWebSocket('**/ws/conversations/*', socket => {
    connections++;
    socket.onClose(() => { connections--; });
  });
  await page.route('**/api/v1/matches', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    started = true;
    await gate;
    return route.fulfill({ json: created });
  });
  await greeting.click();
  await expect.poll(() => started).toBe(true);
  return { ...state, release: () => { state.setMatches([created, match]); release(); }, connections: () => connections };
}

async function settleGreetingNavigation(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test('a delayed greeting updates the shared list without leaving the newly selected tab', async ({ page }) => {
  const state = await startDelayedGreeting(page);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/me');
  state.release();
  await expect(page.getByRole('link', { name: '继续和迟来朋友聊天', exact: true })).toBeVisible();
  await settleGreetingNavigation(page);
  await expect(page).toHaveURL('/me');
  expect(state.requests.some(url => new URL(url).pathname === '/chat/delayed-match')).toBe(false);
  expect(state.connections()).toBe(0);
});

test('leaving and returning invalidates a delayed greeting navigation intent', async ({ page }) => {
  const state = await startDelayedGreeting(page);
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await nav.getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/me');
  await nav.getByRole('link', { name: '陪伴', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  state.release();
  await expect(page.getByRole('link', { name: /继续聊天\s*，和迟来朋友/ })).toBeVisible();
  await settleGreetingNavigation(page);
  await expect(page).toHaveURL('/companion');
  expect(state.requests.some(url => new URL(url).pathname === '/chat/delayed-match')).toBe(false);
  expect(state.connections()).toBe(0);
});

test('a delayed greeting still opens its conversation while its original page remains active', async ({ page }) => {
  const state = await startDelayedGreeting(page);
  state.release();
  await expect(page).toHaveURL('/chat/delayed-match');
  await expect(page.getByRole('textbox', { name: '给迟来朋友发消息' })).toBeVisible();
  await expect.poll(state.connections).toBe(1);
  await page.getByRole('link', { name: 'Radio Friday 首页' }).click();
  await expect(page.getByRole('link', { name: /继续聊天\s*，和迟来朋友/ })).toBeVisible();
});
