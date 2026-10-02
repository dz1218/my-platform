import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const room = { id: 'room-regression', title: '无需刷新直播间', status: '准备中', viewers: 0 };

async function login(context: BrowserContext) {
  await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
}

async function lobby(page: Page, items: typeof room[] = []) {
  await page.route('**/api/v1/rooms', async (route) => {
    await route.fulfill({ json: { items } });
  });
  await page.goto('/live');
  await expect(page.getByRole('button', { name: '刷新列表' })).toBeEnabled();
}

test('create and close update immediately even when subsequent list requests fail', async ({ page, context }) => {
  await login(context);
  let listFails = false;
  let creates = 0;
  await page.route('**/api/v1/rooms', async (route) => {
    if (route.request().method() === 'POST') {
      creates++;
      listFails = true;
      return route.fulfill({ status: 201, json: { item: room } });
    }
    return route.fulfill(listFails
      ? { status: 503, json: { error: { message: '测试服务暂不可用' } } }
      : { json: { items: [] } });
  });
  await page.route(`**/api/v1/rooms/${room.id}`, (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/live');
  await page.getByRole('textbox', { name: '直播间标题' }).fill(room.title);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('article', { name: room.title })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '直播间标题' })).toHaveValue('');
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('列表更新失败');
  await expect(page.getByRole('article', { name: room.title })).toBeVisible();
  expect(creates).toBe(1);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `关闭直播间：${room.title}` }).click();
  await expect(page.getByRole('article', { name: room.title })).toHaveCount(0);
});

test('polling updates another user’s room without a document reload', async ({ page }) => {
  const items: typeof room[] = [];
  await lobby(page, items);
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
  items.push(room);
  await expect(page.getByRole('article', { name: room.title })).toBeVisible({ timeout: 8_000 });
  items.pop();
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible({ timeout: 8_000 });
});

test('a delayed old list cannot undo a successful create', async ({ page, context }) => {
  await login(context);
  await lobby(page);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let listStarted!: () => void;
  const started = new Promise<void>((resolve) => { listStarted = resolve; });
  await page.route('**/api/v1/rooms', async (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { item: room } });
    listStarted();
    await delayed;
    await route.fulfill({ json: { items: [] } }).catch(() => {});
  });
  await page.getByRole('button', { name: '刷新列表' }).click();
  await started;
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('article', { name: room.title })).toBeVisible();
  release();
  await expect(page.getByRole('article', { name: room.title })).toBeVisible();
});

test('failed create preserves the title; Chinese composition does not submit', async ({ page, context }) => {
  await login(context);
  await lobby(page);
  let creates = 0;
  await page.route('**/api/v1/rooms', async (route) => {
    if (route.request().method() === 'POST') {
      creates++;
      return route.fulfill({ status: 503, json: { error: { message: '创建失败，请重试' } } });
    }
    return route.fulfill({ json: { items: [] } });
  });
  const input = page.getByRole('textbox', { name: '直播间标题' });
  await input.fill('中文标题');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  expect(creates).toBe(0);
  await input.press('Enter');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('创建失败');
  await expect(input).toHaveValue('中文标题');
  expect(creates).toBe(1);
});

test('guests see errors and can retry without a misleading empty state', async ({ page }) => {
  await page.route('**/api/v1/rooms', (route) => route.fulfill({ status: 503, json: { error: { message: '直播服务暂不可用' } } }));
  await page.goto('/live');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('直播服务暂不可用');
  await expect(page.getByText('暂无直播间', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建', exact: true })).toHaveCount(0);
  await page.route('**/api/v1/rooms', (route) => route.fulfill({ json: { items: [room] } }));
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.getByRole('article', { name: room.title })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('returning to the lobby refreshes its cached list', async ({ page }) => {
  const items = [room];
  await lobby(page, items);
  await page.getByRole('link', { name: '观看', exact: true }).click();
  await expect(page).toHaveURL(`/live/${room.id}`);
  items.pop();
  await page.getByRole('link', { name: '直播大厅' }).click();
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
});

test('join errors allow retry and leaving cancels an unfinished join', async ({ page }) => {
  let attempts = 0;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/rooms/room-missing/join', async (route) => {
    attempts++;
    if (attempts > 1) await delayed;
    await route.fulfill({ status: 404, json: { error: { message: '直播间已关闭或不存在' } } }).catch(() => {});
  });
  await page.goto('/live/room-missing');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('直播间已关闭或不存在');
  expect(attempts).toBe(1);
  await page.getByRole('button', { name: '重新加入' }).click();
  await expect(page.getByRole('button', { name: '正在进入直播间…' })).toBeDisabled();
  await page.getByRole('link', { name: '直播大厅' }).click();
  release();
  await expect(page).toHaveURL('/live');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

const entryScenarios = [true, false].flatMap((host) =>
  ['准备中', '直播中'].map((status) => ({ host, status })),
);

for (const { host, status } of entryScenarios) {
  test(`${host ? 'host' : 'viewer'} joins a ${status} room automatically with one click from the lobby`, async ({ page, context }) => {
    if (host) await login(context);
    let attempts = 0;
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/v1/rooms/${room.id}/join`, async (route) => {
      attempts++;
      await delayed;
      await route.fulfill({ status: 503, json: { error: { message: '连接失败，请重试' } } }).catch(() => {});
    });
    await lobby(page, [{ ...room, status, viewers: status === '直播中' ? 1 : 0 }]);
    await page.getByRole('link', { name: host ? '进入直播间' : '观看', exact: true }).click();
    await expect(page.getByRole('button', { name: '正在进入直播间…' })).toBeDisabled();
    await expect.poll(() => attempts).toBe(1);
    await expect(page.getByRole('button', { name: /^(进入直播间|进入观看|开始直播|开启直播)$/ })).toHaveCount(0);
    release();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('连接失败');
    await expect(page.getByRole('button', { name: '重新加入' })).toBeEnabled();
    expect(attempts).toBe(1);
  });
}

test('room cards fit mobile and desktop widths', async ({ page, context }) => {
  await login(context);
  await lobby(page, [{ ...room, title: '一段很长的直播间标题'.repeat(5) }]);
  for (const width of [375, 844, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('article')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const enter = await page.getByRole('link', { name: '进入直播间', exact: true }).boundingBox();
    const close = await page.getByRole('button', { name: /^关闭直播间/ }).boundingBox();
    expect(Math.abs(enter!.y - close!.y)).toBeLessThanOrEqual(2);
  }
});
