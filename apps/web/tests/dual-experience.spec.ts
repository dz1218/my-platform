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
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const items = [identity, { ...identity, id: 'design-other', name: '沈知远', background: identity.background.repeat(4) }].filter(item => item.name.includes(q));
    return route.fulfill({ json: { items, total: items.length, page: 1, nextPage: null, occupations } });
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

test('mobile discovery opens directly and anchored filters preserve the card positions', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/companion');
  await expect(page.getByRole('navigation', { name: '陪伴内容' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeVisible();
  await expect(page.getByTestId('identity-catalog')).toHaveAttribute('data-columns', '2');
  const first = page.locator('[data-identity-id="design-friend"]');
  const initial = (await first.boundingBox())!;
  const filter = page.getByRole('button', { name: /^筛选朋友/ });
  const panel = page.getByRole('region', { name: '筛选朋友', exact: true });
  await filter.click();
  await expect(panel).toBeVisible();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(288);
  const minimum = panel.getByRole('spinbutton', { name: '最小年龄', exact: true });
  await minimum.focus();
  expect(await minimum.evaluate(element => getComputedStyle(element, '::placeholder').color)).toBe('rgba(0, 0, 0, 0)');
  expect((await first.boundingBox())!.y).toBe(initial.y);
  await panel.getByRole('combobox', { name: '职业', exact: true }).click();
  await page.getByRole('option', { name: '设计师', exact: true }).click();
  await expect(panel).toBeVisible();
  // The trigger itself closes the nonmodal dropdown; reopening discards unapplied edits.
  await filter.click();
  await expect(panel).toBeHidden();
  await filter.click();
  await expect(panel.getByRole('combobox', { name: '职业', exact: true })).toHaveText('全部职业');
  await panel.getByRole('combobox', { name: '职业', exact: true }).click();
  await page.getByRole('option', { name: '设计师', exact: true }).click();
  await panel.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)).toContain('occupationCode=designer');
  await expect(panel).toBeHidden();
  await expect(filter).toBeFocused();
  const search = page.getByRole('searchbox', { name: '姓名', exact: true });
  await search.focus();
  expect(await search.evaluate(element => getComputedStyle(element, '::placeholder').color)).toBe('rgba(0, 0, 0, 0)');
  await search.fill('林');
  await search.press('Enter');
  await expect.poll(() => state.queries.at(-1)).toContain('q=%E6%9E%97');
  await expect(page.locator('[data-identity-id="design-other"]')).toHaveCount(0);
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(search).toHaveValue('');
  // Clearing a search restores the already-cached filtered list without another request.
  await expect(page.getByTestId('identity-catalog')).toHaveAttribute('data-loaded-count', '2');
  await expect(page.locator('[data-identity-id="design-other"]')).toBeVisible();
  await expect(filter).toHaveAttribute('aria-label', '筛选朋友，1 项条件');
  await filter.click();
  await panel.getByRole('combobox', { name: '职业', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await filter.click();
  // The search field is outside the dropdown and can dismiss it without a backdrop.
  await search.click();
  await expect(panel).toBeHidden();
  // Click the name area, away from the visible footer action.
  await first.click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/companion');
  await expect(filter).toHaveAttribute('aria-label', '筛选朋友，1 项条件');
});

test('legacy mobile tab links show discovery without waiting for recent chats', async ({ page }) => {
  await setup(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/matches', async route => { await held; await route.fulfill({ json: { items: [] } }); });
  try {
    await page.goto('/companion?view=recent');
    await expect(page.locator('[data-identity-id="design-friend"]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '陪伴内容' })).toHaveCount(0);
    await expect(page.getByTestId('identity-catalog')).toHaveAttribute('data-columns', '2');
  } finally { release(); }
});

for (const width of [320, 390]) {
  test(`mobile discovery keeps its search and two-column skeleton stable at ${width}px`, async ({ page }, testInfo) => {
    await setup(page);
    await page.setViewportSize({ width, height: 844 });
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/discover?*', async route => {
      await held;
      await route.fulfill({ json: { items: [identity, { ...identity, id: 'design-other', name: '沈知远' }], total: 2, page: 1, nextPage: null, occupations } });
    });
    try {
      await page.goto('/companion');
      const skeleton = page.locator('[data-skeleton="catalog"]:visible');
      await expect(skeleton).toBeVisible();
      await expect(page.getByRole('navigation', { name: '陪伴内容' })).toHaveCount(0);
      const search = page.getByRole('searchbox', { name: '姓名', exact: true });
      await expect(search).toBeEnabled();
      const searchBounds = await search.boundingBox();
      const skeletonBounds = (await skeleton.boundingBox())!;
      expect(await skeleton.locator(':scope > div').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
      expect(await page.locator('[data-mobile-page="companion"] h1').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`discovery-skeleton-${width}.png`) });
      release();
      await expect(skeleton).toHaveCount(0);
      const first = page.locator('[data-identity-id="design-friend"]');
      await expect(first).toBeVisible();
      expect(await search.boundingBox()).toEqual(searchBounds);
      expect((await first.boundingBox())!.y).toBe(skeletonBounds.y);
      await expect(page.getByTestId('identity-catalog')).toHaveAttribute('data-columns', '2');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`discovery-ready-${width}.png`) });
    } finally { release(); }
  });
}

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
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '房间名称' })).toHaveCount(0);
  await page.getByRole('button', { name: '开播', exact: true }).click();
  await page.getByRole('textbox', { name: '房间名称' }).fill('雨夜来信');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('dialog', { name: '今晚，开场', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '房间名称' })).toHaveValue('雨夜来信');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog', { name: '我的直播间', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '房间名称' })).toHaveValue('雨夜来信');
  await page.getByRole('button', { name: '创建直播间', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '我的直播间', exact: true })).toBeHidden();
  expect(creates).toBe(1);
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
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
  const routes = ['/companion?view=discover', '/companion?view=recent', '/chat/design-match', '/', '/live/design-room', '/novels', '/novels/design-novel', '/novels/design-novel/chapters/design-chapter', '/novels/create', '/novels/design-novel/edit', '/novels/design-novel/chapters/design-chapter/edit', '/me', '/choose-identity', '/privacy'];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [index, path] of routes.entries()) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.locator('[data-app-startup]')).toHaveCount(0);
      await expect(page.getByRole('status', { name: '正在准备页面…', exact: true })).toHaveCount(0);
      if (path.startsWith('/companion?view=discover')) await expect(page.getByRole('button', { name: '和沈知远打个招呼' })).toBeVisible();
      if (path === '/') await expect(page.getByRole('article')).toBeVisible();
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
