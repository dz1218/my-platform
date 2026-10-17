import { expect, test } from '@playwright/test';

const controls = 'http://127.0.0.1:18181';
const room = { id: 'room-pushed', title: '实时直播间', status: '准备中', viewers: 0, canManage: true };

test.beforeEach(async ({ request }) => { await request.post(`${controls}/__performance`, { data: { rooms: [] } }); });
test.afterEach(async ({ request }) => { await request.post(`${controls}/__performance`, { data: {} }); });

test('lobby snapshots reach two pages, preserve guest permissions and recover after reconnect', async ({ page, context, browser, request }) => {
  await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
  const guestContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const guest = await guestContext.newPage();
  try {
    await page.goto('/live');
    await guest.goto('/live');
    for (const current of [page, guest]) await expect(current.getByText('暂无直播间', { exact: true })).toBeVisible();
    await expect.poll(async () => (await (await request.get(`${controls}/__performance`)).json()).roomSockets).toBe(2);
    await request.post(`${controls}/__performance`, { data: { rooms: [room] } });
    for (const current of [page, guest]) await expect(current.getByRole('article', { name: room.title })).toBeVisible();
    await expect(page.getByRole('link', { name: '进入我的直播间' })).toBeVisible();
    await expect(guest.getByRole('button', { name: /^关闭直播间/ })).toHaveCount(0);
    await expect(guest.getByRole('link', { name: '进入我的直播间' })).toHaveCount(0);

    const before = await (await request.get(`${controls}/__performance`)).json();
    await request.post(`${controls}/__rooms/heartbeat`);
    await expect.poll(async () => (await (await request.get(`${controls}/__performance`)).json()).roomSocketPongs).toBeGreaterThanOrEqual(before.roomSocketPongs + 2);
    await request.post(`${controls}/__rooms/disconnect`);
    await request.post(`${controls}/__performance`, { data: { rooms: [{ ...room, status: '直播中', viewers: 3 }] } });
    await expect.poll(async () => (await (await request.get(`${controls}/__performance`)).json()).roomSocketConnections).toBeGreaterThanOrEqual(before.roomSocketConnections + 2);
    for (const current of [page, guest]) await expect(current.getByRole('article', { name: room.title })).toContainText('直播中');
    // The reconnect snapshot repairs all missed changes without an HTTP poll.
    const requests = (await (await request.get(`${controls}/__performance`)).json()).requests as { path: string }[];
    expect(requests.filter(item => /^\/api\/v1\/rooms(?:\/refresh)?$/.test(item.path))).toEqual([]);
    await request.post(`${controls}/__performance`, { data: { rooms: [] } });
    for (const current of [page, guest]) await expect(current.getByText('暂无直播间', { exact: true })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test('an idle lobby performs no interval room requests, while manual refresh remains available', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', request => {
    if (/\/api\/v1\/rooms(?:\/refresh)?$/.test(new URL(request.url()).pathname)) reads.push(`${request.method()} ${request.url()}`);
  });
  await page.goto('/live');
  await expect(page.getByText('暂无直播间', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新列表' })).toBeEnabled();
  const before = reads.length;
  // Cross two former five-second poll boundaries with the actual browser clock.
  await page.waitForTimeout(11_000);
  expect(reads).toHaveLength(before);
  const refreshed = page.waitForResponse(response => response.url().endsWith('/rooms/refresh') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '刷新列表' }).click();
  expect((await refreshed).ok()).toBe(true);
});
