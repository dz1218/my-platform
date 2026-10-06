import { expect, test, type Page } from '@playwright/test';

const occupations = [{ code: 'teacher', name: '教师' }, { code: 'designer', name: '设计师' }];
const identities = Array.from({ length: 1000 }, (_, index) => ({
  id: `catalog-${index}`, name: `朋友${String(index).padStart(4, '0')}`, age: 18 + index % 33,
  gender: 'FEMALE', city: '杭州', avatarUrl: '', occupationCode: occupations[index % 2].code,
  occupation: occupations[index % 2].name,
  background: '在杭州生活，喜欢听你分享日常。'.repeat(1 + index % 6),
}));
const asMatch = (identity: typeof identities[number]) => ({ id: `match-${identity.id}`, conversationId: `conversation-${identity.id}`, identity });

async function setup(page: Page, inheritance = false) {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  const requests: string[] = [];
  const known = new Map([[identities[130].id, asMatch(identities[130])]]);
  let failPage = 0;
  let stateReads = 0;
  let claimed = false;
  let lastSelected: string | null = null;
  let delayQuery: string | null = null;
  const sendPage = async (route: import('@playwright/test').Route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    if (delayQuery && url.searchParams.get('q') === delayQuery) await new Promise(resolve => setTimeout(resolve, 500));
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    if (pageNumber === failPage) return route.fulfill({ status: 503, json: { error: { message: '测试：加载失败，请重试' } } });
    const q = url.searchParams.get('q') ?? '';
    const code = url.searchParams.get('occupationCode');
    const min = Number(url.searchParams.get('ageMin') || 18);
    const max = Number(url.searchParams.get('ageMax') || 50);
    const filtered = identities.filter(item => item.name.includes(q) && (!code || item.occupationCode === code) && item.age >= min && item.age <= max);
    const items = filtered.slice((pageNumber - 1) * 24, pageNumber * 24).map(item => inheritance ? { ...item, available: item.id !== lastSelected || !claimed } : item);
    return route.fulfill({ json: { items, total: filtered.length, availableTotal: filtered.length - Number(claimed), page: pageNumber, pageSize: 24, nextPage: pageNumber * 24 < filtered.length ? pageNumber + 1 : null, occupations } });
  };
  await page.route('**/api/v1/discover?*', sendPage);
  await page.route('**/api/v1/identity-inheritance/options?*', sendPage);
  await page.route(/\/api\/v1\/identity-inheritance(?:\?.*)?$/, route => {
    stateReads++;
    const selectedId = new URL(route.request().url()).searchParams.get('selectedId');
    if (selectedId) lastSelected = selectedId;
    return route.fulfill({ json: { gender: 'FEMALE', onboardingCompleted: true, identity: null, items: [], selected: selectedId ? { ...identities.find(item => item.id === selectedId), available: !claimed } : null } });
  });
  await page.route('**/api/v1/matches', route => {
    if (route.request().method() === 'POST') {
      const identity = identities.find(item => item.id === route.request().postDataJSON().identityId)!;
      const match = asMatch(identity);
      known.set(identity.id, match);
      return route.fulfill({ json: match });
    }
    return route.fulfill({ json: { items: [...known.values()] } });
  });
  await page.route('**/api/v1/matches/*', route => {
    const identity = identities.find(item => `match-${item.id}` === new URL(route.request().url()).pathname.split('/').pop())!;
    return route.fulfill({ json: asMatch(identity) });
  });
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'AI', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
  await page.routeWebSocket('**/ws/conversations/*', socket => {
    socket.onMessage(raw => {
      const data = JSON.parse(String(raw));
      if (data.type === 'send') socket.send(JSON.stringify({ type: 'accepted', requestId: data.requestId, message: { id: '101', sender: { id: 'user', name: '我' }, senderType: 'user', source: 'USER', content: data.content, status: 'complete', requestId: data.requestId, createdAt: new Date().toISOString() } }));
    });
  });
  return { requests, fail: (number: number) => { failPage = number; }, claimSelected: () => { claimed = true; }, stateReads: () => stateReads, delay: (query: string) => { delayQuery = query; } };
}

async function loadThrough(page: Page, count: number) {
  const catalog = page.getByTestId('identity-catalog');
  await expect(catalog).toBeVisible();
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    return Number(await catalog.getAttribute('data-loaded-count'));
  }, { timeout: 90_000, intervals: [100, 200, 300] }).toBeGreaterThanOrEqual(count);
  // Move away from the loading sentinel and allow Masonry's measurements to settle.
  await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
  await settle(page);
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    let count = 0;
    const frame = () => ++count < 10 ? requestAnimationFrame(frame) : resolve();
    requestAnimationFrame(frame);
  }));
}
async function visibleCard(page: Page) {
  return page.locator('[data-identity-id]').evaluateAll(nodes => nodes.find(node => {
    const rect = node.getBoundingClientRect();
    return rect.top > 0 && rect.bottom < window.innerHeight;
  })?.getAttribute('data-identity-id'));
}

test('1000 variable-height roles stay virtualized, finish loading once, and resize without overflow', async ({ page }) => {
  test.setTimeout(120_000);
  const mock = await setup(page);
  await page.goto('/companion');
  await loadThrough(page, 1000);
  await expect(page.getByText('已经看到全部了', { exact: true })).toBeVisible();
  const count = await page.locator('[data-identity-id]').count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(80);
  const requests = mock.requests.length;
  for (const width of [390, 900, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    const size = await page.getByTestId('identity-catalog').evaluate(el => ({ width: el.clientWidth, columns: Number((el as HTMLElement).dataset.columns) }));
    expect(size.columns).toBe(size.width < 480 ? 1 : size.width < 760 ? 2 : size.width < 1040 ? 3 : 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(mock.requests.length).toBe(requests);
});

for (const entry of ['new', 'continue', 'recent'] as const) {
  test(`deep scroll survives ${entry} chat, sending, back and forward within 2px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const mock = await setup(page);
    await page.goto('/companion');
    await loadThrough(page, 144);
    let identityId: string | null | undefined;
    if (entry === 'recent') {
      identityId = await visibleCard(page);
    } else if (entry === 'continue') {
      await page.evaluate(() => window.scrollBy(0, -700));
      await settle(page);
      // Find the already known card by scrolling the measured range.
      for (let attempt = 0; attempt < 30 && !await page.locator('[data-identity-id="catalog-130"]').count(); attempt++) {
        const min = await page.locator('[data-identity-index]').evaluateAll(nodes => Math.min(...nodes.map(node => Number((node as HTMLElement).dataset.identityIndex))));
        await page.evaluate(direction => window.scrollBy(0, direction * 400), min > 130 ? -1 : 1);
        await settle(page);
      }
      identityId = 'catalog-130';
      await page.locator(`[data-identity-id="${identityId}"] a`).scrollIntoViewIfNeeded();
      await settle(page);
    } else {
      identityId = await visibleCard(page);
      expect(identityId).toBeTruthy();
      await page.locator(`[data-identity-id="${identityId}"] button`).scrollIntoViewIfNeeded();
      await settle(page);
    }
    expect(identityId).toBeTruthy();
    const card = page.locator(`[data-identity-id="${identityId}"]`);
    const before = await card.boundingBox();
    const y = await page.evaluate(() => window.scrollY);
    const loaded = await page.getByTestId('identity-catalog').getAttribute('data-loaded-count');
    await card.evaluate(node => { (node as HTMLElement).dataset.retained = 'yes'; });
    if (entry === 'recent') await page.getByRole('complementary', { name: '最近聊天' }).getByRole('link', { name: /朋友0130/ }).click();
    else if (entry === 'continue') await card.getByRole('link').click();
    else await card.getByRole('button').click();
    await expect(page.getByTestId('chat-overlay')).toBeVisible();
    await expect(page.getByRole('textbox')).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
    const requestCount = mock.requests.length;
    await page.getByRole('textbox').fill('今天过得怎么样？');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('今天过得怎么样？', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回陪伴', exact: true }).click();
    await expect(page).toHaveURL('/companion');
    await settle(page);
    await expect(card).toHaveAttribute('data-retained', 'yes');
    await expect(page.getByTestId('identity-catalog')).toHaveAttribute('data-loaded-count', loaded!);
    expect(Math.abs((await card.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(await page.evaluate(() => window.scrollY) - y)).toBeLessThanOrEqual(2);
    expect(mock.requests.length).toBe(requestCount);
    await page.goForward();
    await expect(page.getByTestId('chat-overlay')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/companion');
    await settle(page);
    expect(Math.abs((await card.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(2);
  });
}

test('filters cancel stale results, survive a chat return, and expose retry for next-page errors', async ({ page }) => {
  const mock = await setup(page);
  mock.fail(2);
  await page.goto('/companion');
  mock.delay('朋友00');
  await page.getByRole('searchbox', { name: '姓名' }).fill('朋友00');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('searchbox', { name: '姓名' }).fill('朋友01');
  await page.getByRole('combobox', { name: '职业', exact: true }).selectOption('teacher');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.locator('[data-identity-id]').first()).toContainText('朋友01');
  await expect.poll(() => page.locator('[data-identity-id]').evaluateAll(nodes => nodes.every(node => node.textContent?.includes('教师') && node.textContent.includes('朋友01')))).toBe(true);
  const first = page.locator('[data-identity-id]').first();
  await first.getByRole('button').click();
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('searchbox', { name: '姓名' })).toHaveValue('朋友01');
  await expect(page.getByRole('combobox', { name: '职业', exact: true })).toHaveValue('teacher');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole('button', { name: '重试加载', exact: true })).toBeVisible();
  mock.fail(0);
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await expect.poll(async () => Number(await page.getByTestId('identity-catalog').getAttribute('data-loaded-count'))).toBeGreaterThanOrEqual(48);
});

test('mobile chat locks background scroll, preserves anchor on resize, and standalone URLs return normally', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/companion');
  await loadThrough(page, 144);
  const id = await visibleCard(page);
  expect(id).toBeTruthy();
  const card = page.locator(`[data-identity-id="${id}"]`);
  const anchor = await page.locator('[data-identity-id]').evaluateAll(nodes => {
    const node = nodes.filter(node => node.getBoundingClientRect().bottom > 0).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    return { id: node.getAttribute('data-identity-id'), top: node.getBoundingClientRect().top };
  });
  await card.getByRole('button').click();
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  const y = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 600);
  await settle(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(y);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goBack();
  await expect(page).toHaveURL('/companion');
  await settle(page);
  await expect.poll(() => page.evaluate(saved => { const card = document.querySelector(`[data-identity-id="${saved.id}"]`); return card ? Math.abs(card.getBoundingClientRect().top - saved.top) : 9999; }, anchor), { timeout: 10_000 }).toBeLessThanOrEqual(2);
  await page.goto('/chat/match-catalog-130');
  await expect(page.getByTestId('chat-overlay')).toHaveCount(0);
  await page.getByRole('link', { name: '返回陪伴', exact: true }).click();
  await expect(page).toHaveURL('/companion');
});

test('inheritance selection survives card unmount and light polling refreshes availability only', async ({ page }) => {
  const mock = await setup(page, true);
  await page.clock.install();
  await page.goto('/choose-identity');
  const first = page.getByRole('button', { name: '选择朋友0000', exact: true });
  await first.click();
  await expect(page.getByRole('button', { name: '确认继承朋友0000', exact: true })).toBeVisible();
  await expect(page.locator('[data-identity-id="catalog-0"]')).toHaveCount(0);
  const optionReads = mock.requests.length;
  mock.claimSelected();
  await page.clock.runFor(20_100);
  await expect(page.getByRole('button', { name: '确认继承朋友0000', exact: true })).toBeDisabled();
  expect(mock.requests.length).toBe(optionReads);
  expect(mock.stateReads()).toBeGreaterThanOrEqual(3);
});

test('single and empty results handle age filters and keyboard chat returns focus to the same role', async ({ page }) => {
  await setup(page);
  await page.goto('/companion');
  await page.getByRole('searchbox', { name: '姓名' }).fill('朋友0000');
  await page.getByRole('spinbutton', { name: '最小年龄' }).fill('18');
  await page.getByRole('spinbutton', { name: '最大年龄' }).fill('18');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByTestId('identity-catalog')).toHaveAttribute('data-loaded-count', '1');
  const card = page.locator('[data-identity-id="catalog-0"]');
  await card.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  await page.goBack();
  await expect(card.getByRole('link')).toBeFocused();
  await page.getByRole('searchbox', { name: '姓名' }).fill('不存在的名字');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByText('没有找到符合条件的朋友，试试其他筛选条件。')).toBeVisible();
  await expect(page.locator('[data-identity-id]')).toHaveCount(0);
});

test('an expired chat still returns to the retained list and leaving the area releases its scroll lock', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/matches/match-catalog-130', route => route.fulfill({ status: 401, json: { error: { message: '请先登录' } } }));
  await page.goto('/companion');
  await page.getByRole('complementary', { name: '最近聊天' }).getByRole('link', { name: /朋友0130/ }).click();
  await expect(page.getByTestId('chat-overlay').getByRole('alert')).toHaveText('请先登录');
  await page.getByRole('button', { name: '返回陪伴', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  await page.goForward();
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/me');
  await expect(page.getByTestId('chat-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
});

test('the intercepted self-identity guard never opens a conversation, and reloading chat uses the standalone route', async ({ page }) => {
  await setup(page);
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-inherited', domain: '127.0.0.1', path: '/' }]);
  await page.route('**/api/v1/matches/match-catalog-130', route => route.fulfill({ json: { ...asMatch(identities[130]), identity: { ...identities[130], id: 'inheritance-chennian', name: '陈念' } } }));
  const conversationRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/conversations/')) conversationRequests.push(request.url()); });
  await page.goto('/companion');
  await page.getByRole('complementary', { name: '最近聊天' }).getByRole('link', { name: /朋友0130/ }).click();
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  await expect(page.getByRole('heading', { name: '这是你继承的 AI 身份' })).toBeVisible();
  await page.getByRole('button', { name: '以本账户聊天', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  await page.goForward();
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('chat-overlay')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '这是你继承的 AI 身份' })).toBeVisible();
  expect(conversationRequests).toEqual([]);
});
