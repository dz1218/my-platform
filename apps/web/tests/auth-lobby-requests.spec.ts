import { expect, test, type Request } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181/__performance';

test.beforeEach(async ({ request }) => {
  // No pushed snapshot: observe the HTTP read independently of WS cache updates.
  await request.post(fixture, { data: {} });
});
test.afterEach(async ({ request }) => { await request.post(fixture, { data: {} }); });

for (const width of [1440, 390]) {
  test(`closing auth reuses cached rooms and restores live updates at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const calls: Array<{ path: string; outcome: string }> = [];
    const tracked = new Map<Request, typeof calls[number]>();
    page.on('request', outgoing => {
      const path = new URL(outgoing.url()).pathname;
      if (!['/api/v1/rooms', '/api/live/connection'].includes(path)) return;
      const call = { path, outcome: 'pending' };
      calls.push(call);
      tracked.set(outgoing, call);
    });
    page.on('requestfinished', outgoing => {
      const call = tracked.get(outgoing);
      if (call) call.outcome = 'finished';
    });
    page.on('requestfailed', outgoing => {
      const call = tracked.get(outgoing);
      if (call) call.outcome = outgoing.failure()?.errorText ?? 'failed';
    });
    const socketCount = async () => (await (await request.get(fixture)).json()).roomSockets;
    await page.goto('/login');
    await page.getByRole('button', { name: '显示密码', exact: true }).click();
    await page.getByRole('link', { name: '关闭并进入首页' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText(width < 768 ? '暂无直播间，等一个声音，也可以是你。' : '暂无直播间', { exact: true })).toBeVisible();
    await expect.poll(socketCount).toBe(1);
    await expect.poll(() => calls.filter(call => call.outcome === 'pending')).toEqual([]);
    // A cold visit still fetches data; development cleanup may abort a probe.
    expect(calls.filter(call => call.path === '/api/v1/rooms' && call.outcome === 'finished')).toHaveLength(1);
    for (const authPath of ['/login', '/register']) {
      await page.getByRole('link', { name: width < 768 ? '登录开播' : '登录 / 注册', exact: true }).click();
      await expect.poll(socketCount).toBe(0);
      if (authPath === '/register') {
        await page.getByRole('link', { name: '手机号注册', exact: true }).click();
      }
      await expect(page).toHaveURL(authPath);
      // Change the directory while the lobby is unmounted. Only the new socket
      // snapshot can bring this change into the cached list on return.
      const room = { id: 'auth-return-room', title: `返回${authPath}后的新直播间`, status: '直播中', viewers: 3, canManage: false };
      await request.post(fixture, { data: { rooms: [room] } });
      const before = calls.length;
      await page.getByRole('link', { name: '关闭并进入首页' }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('article', { name: room.title })).toBeVisible();
      await expect.poll(socketCount).toBe(1);
      await expect.poll(() => calls.slice(before).filter(call => call.outcome === 'pending')).toEqual([]);
      const visit = calls.slice(before);
      await testInfo.attach(`requests-after-${authPath.slice(1)}`, { body: JSON.stringify(visit), contentType: 'application/json' });
      expect(visit.filter(call => call.path === '/api/v1/rooms')).toEqual([]);
      expect(visit.filter(call => call.path === '/api/live/connection' && call.outcome === 'finished')).toHaveLength(1);
      expect(visit.filter(call => !['finished', 'net::ERR_ABORTED'].includes(call.outcome))).toEqual([]);
    }
    await page.getByRole('link', { name: width < 768 ? '登录开播' : '登录 / 注册', exact: true }).click();
    await expect.poll(socketCount).toBe(0);
  });
}
