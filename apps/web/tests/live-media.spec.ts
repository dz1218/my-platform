import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Opt in with LIVEKIT_INTEGRATION=1 and a local LiveKit instance. Only the
// uniquely named room below is touched, and it is deleted in finally.
const livekitUrl = process.env.LIVEKIT_TEST_URL || 'http://127.0.0.1:7880';
const apiKey = process.env.LIVEKIT_TEST_API_KEY || 'devkey';
const apiSecret = process.env.LIVEKIT_TEST_API_SECRET || 'devsecretdevsecretdevsecretdevsec';

function token(video: Record<string, unknown>, identity?: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: apiKey, sub: identity, name: identity, iat: now, nbf: now, exp: now + 300, video })}`;
  return `${content}.${createHmac('sha256', apiSecret).update(content).digest('base64url')}`;
}

async function rpc(method: string, body: Record<string, unknown>, grant: Record<string, unknown>) {
  const response = await fetch(`${livekitUrl.replace(/^ws/, 'http')}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token(grant)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (method === 'DeleteRoom' && response.status === 404) return {};
  expect(response.ok, `${method}: ${response.status}`).toBe(true);
  const result = await response.json();
  if (method === 'CreateRoom') {
    const synchronized = await fetch('http://127.0.0.1:18182/__sync', { method: 'POST' });
    expect(synchronized.ok, 'test room snapshot initialized').toBe(true);
  }
  return result;
}

async function login(context: BrowserContext, account = 'live-test-host') {
  await context.addCookies([{ name: 'companion_session', value: account, domain: '127.0.0.1', path: '/' }]);
}

async function join(page: Page, roomId: string, host: boolean) {
  const response = page.waitForResponse(response => response.url().endsWith(`/rooms/${roomId}/join`) && response.request().method() === 'POST');
  await page.goto(`/live/${roomId}`);
  const result = await response;
  expect(result.status()).toBe(201);
  const joined = await result.json();
  expect(joined.role).toBe(host ? 'host' : 'viewer');
  expect(joined.voiceToken).toBeTruthy();
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  return joined;
}

async function expectEnded(page: Page) {
  await expect(page.getByRole('heading', { name: '直播间已结束' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^(重新加入|结束直播)$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '返回直播大厅', exact: true }).filter({ hasText: '返回直播大厅' })).toBeVisible();
}

test('real host/viewer media, viewer rejoin and confirmed host ending', async ({ page, context, browser }) => {
  test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires local LiveKit');
  test.setTimeout(90_000);
  const roomId = `voice-e2e-${randomUUID()}`;
  await rpc('CreateRoom', { name: roomId, metadata: JSON.stringify({ title: '媒体测试', ownerId: 'live-test-host' }) }, { roomCreate: true });
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3012' });
  try {
    await login(context);
    await join(page, roomId, true);
    const guest = await guestContext.newPage();
    await join(guest, roomId, false);
    await expect(guest.getByRole('button', { name: '呼叫 AI 助手' })).toHaveCount(0);
    await expect(guest.getByText('本地预览', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '在线 2' })).toBeVisible();

    // Both roles may send data, while the viewer remains unable to publish media.
    const guestInput = guest.getByRole('textbox', { name: '发送消息' });
    await expect(guest.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await guestInput.fill('大家晚上好 <script>这只是文字</script>');
    await guestInput.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
    await expect(page.getByRole('log')).not.toContainText('大家晚上好');
    await guestInput.press('Enter');
    await expect(page.getByRole('log')).toContainText('大家晚上好 <script>这只是文字</script>');
    await expect(guest.getByRole('log')).toContainText('大家晚上好');
    await expect(guestInput).toHaveValue('');
    await page.getByRole('textbox', { name: '发送消息' }).fill('欢迎来到直播间');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(guest.getByRole('log')).toContainText('欢迎来到直播间');
    await guestInput.fill('   ');
    await expect(guest.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await guestInput.fill('');
    await page.getByRole('button', { name: '在线 2' }).click();
    await expect(page.getByRole('heading', { name: '参与者 · 2' })).toBeVisible();
    await page.getByRole('button', { name: '聊天', exact: true }).click();
    await expect(page.getByRole('log')).toContainText('大家晚上好');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 980 });
      await page.screenshot({ path: test.info().outputPath(`room-${width}.png`), fullPage: width > 500 });
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('main *')).filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1).map((element) => element.className));
      expect(overflow).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width < 500) {
        await page.getByRole('textbox', { name: '发送消息' }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath('room-mobile-chat.png') });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }

    await page.getByRole('button', { name: '开启摄像头' }).click();
    await expect(page.locator('video')).toHaveCount(1);
    await expect(guest.locator('video')).toHaveCount(1);
    await expect.poll(() => guest.locator('video').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: '开启麦克风' }).click();
    await expect(page.getByRole('button', { name: '关闭麦克风' })).toBeEnabled({ timeout: 10_000 });
    await expect(guest.locator('audio')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭摄像头' }).click();
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '关闭麦克风' })).toBeEnabled();
    await page.getByRole('button', { name: '开启摄像头' }).click();
    await expect(page.locator('video')).toHaveCount(1);

    let dispatches = 0;
    await page.route(`**/api/v1/rooms/${roomId}/agent/dispatch`, (route) => {
      dispatches++;
      return route.fulfill({ status: 201, json: { item: { id: 'test-dispatch' } } });
    });
    await page.getByRole('button', { name: '呼叫 AI 助手' }).click();
    await expect(page.getByRole('button', { name: '已呼叫，等待助手加入' })).toBeDisabled();
    expect(dispatches).toBe(1);

    // A viewer can leave and rejoin without closing the host's room.
    await guest.getByRole('button', { name: '离开房间' }).click();
    await expect(page.getByRole('button', { name: '在线 1' })).toBeVisible();
    await guest.getByRole('button', { name: '重新加入', exact: true }).click();
    await expect(guest.getByText('已连接', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '在线 2' })).toBeVisible();
    await expect(guest.getByRole('button', { name: '结束直播', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '离开房间', exact: true })).toHaveCount(0);

    // Cancelling the host confirmation keeps media running; confirming closes
    // the actual LiveKit room and both pages become terminal.
    await page.getByRole('button', { name: '结束直播', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '结束这个直播间？' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(guest.getByText('已连接', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '结束直播', exact: true }).click();
    await page.getByRole('button', { name: '确认结束', exact: true }).click();
    await expectEnded(page);
    await expectEnded(guest);
    await expect(page.locator('video')).toHaveCount(0);
    await expect(guest.locator('audio')).toHaveCount(0);
    const rooms = await rpc('ListRooms', { names: [roomId] }, { roomList: true });
    expect(rooms.rooms ?? []).toHaveLength(0);
    await page.reload();
    await expectEnded(page);
  } finally {
    await guestContext.close();
    await rpc('DeleteRoom', { room: roomId }, { roomCreate: true });
  }
});

test('one host page owns the room while the same account can watch another host', async ({ page, context, browser }) => {
  test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires local LiveKit');
  test.setTimeout(90_000);
  const ownRoom = `voice-e2e-${randomUUID()}`;
  const otherRoom = `voice-e2e-${randomUUID()}`;
  const viewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3012' });
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3012' });
  await rpc('CreateRoom', { name: ownRoom, metadata: JSON.stringify({ title: '唯一主播', ownerId: 'live-test-host' }) }, { roomCreate: true });
  await rpc('CreateRoom', { name: otherRoom, metadata: JSON.stringify({ title: '其他主播', ownerId: 'live-test-viewer' }) }, { roomCreate: true });
  try {
    await login(context);
    await login(otherContext, 'live-test-viewer');
    const ownHost = await join(page, ownRoom, true);
    const duplicate = await context.newPage();
    const refused = duplicate.waitForResponse(response => response.url().endsWith(`/rooms/${ownRoom}/join`));
    await duplicate.goto(`/live/${ownRoom}`);
    expect((await refused).status()).toBe(409);
    expect((await (await refused).json()).error.code).toBe('host_session_in_use');
    await expect(duplicate.getByRole('heading', { name: '此直播间已在其他页面打开' })).toBeVisible();
    await expect(duplicate.getByRole('button', { name: /^(重新加入|申请连麦|结束直播)$/ })).toHaveCount(0);
    const ownParticipants = await rpc('ListParticipants', { room: ownRoom }, { roomAdmin: true, room: ownRoom });
    expect(ownParticipants.participants.map((participant: { identity: string }) => participant.identity)).toEqual([ownHost.identity]);

    const otherHostPage = await otherContext.newPage();
    await join(otherHostPage, otherRoom, true);
    const watchingPage = await context.newPage();
    await join(watchingPage, otherRoom, false);
    await expect(watchingPage.getByRole('button', { name: '结束直播', exact: true })).toHaveCount(0);
    await expect(watchingPage.getByRole('button', { name: '离开房间', exact: true })).toBeEnabled();
    await expect(page.getByText('已连接', { exact: true })).toBeVisible();
    await watchingPage.getByRole('button', { name: '离开房间', exact: true }).click();
    await expect(otherHostPage.getByRole('button', { name: '在线 1' })).toBeVisible();
    await expect(page.getByText('已连接', { exact: true })).toBeVisible();
    await watchingPage.getByRole('button', { name: '重新加入', exact: true }).click();
    await expect(watchingPage.getByText('已连接', { exact: true })).toBeVisible();

    const viewer = await viewerContext.newPage();
    await join(viewer, ownRoom, false);
    // Closing the browser page (without a UI/API end request) must close this
    // room through backend presence reconciliation, even with a viewer present.
    await page.close();
    await expectEnded(viewer);
    const rejoin = await viewer.request.post(`/api/v1/rooms/${ownRoom}/join`, { data: { attemptId: randomUUID() } });
    expect(rejoin.status()).toBe(410);
    expect((await rejoin.json()).error.code).toBe('room_closed');
    await expect(watchingPage.getByText('已连接', { exact: true })).toBeVisible();
    await expect(otherHostPage.getByText('已连接', { exact: true })).toBeVisible();
  } finally {
    await viewerContext.close();
    await otherContext.close();
    await rpc('DeleteRoom', { room: ownRoom }, { roomCreate: true });
    await rpc('DeleteRoom', { room: otherRoom }, { roomCreate: true });
  }
});

test('refreshing the only host page closes its room rather than creating a replacement host', async ({ page, context, browser }) => {
  test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires local LiveKit');
  test.setTimeout(60_000);
  const roomId = `voice-e2e-${randomUUID()}`;
  const viewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3012' });
  await rpc('CreateRoom', { name: roomId, metadata: JSON.stringify({ title: '刷新结束测试', ownerId: 'live-test-host' }) }, { roomCreate: true });
  try {
    await login(context);
    await join(page, roomId, true);
    const viewer = await viewerContext.newPage();
    await join(viewer, roomId, false);
    await page.reload();
    await expectEnded(viewer);
    await expectEnded(page);
    const rooms = await rpc('ListRooms', { names: [roomId] }, { roomList: true });
    expect(rooms.rooms ?? []).toHaveLength(0);
  } finally {
    await viewerContext.close();
    await rpc('DeleteRoom', { room: roomId }, { roomCreate: true });
  }
});

test('a signed LiveKit departure webhook closes the room without sweep or detail polling', async ({ page, context }) => {
  test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires webhook-enabled local LiveKit');
  test.setTimeout(60_000);
  const roomId = `voice-e2e-${randomUUID()}`;
  await rpc('CreateRoom', { name: roomId, metadata: JSON.stringify({ title: 'Webhook关闭测试', ownerId: 'live-test-host' }) }, { roomCreate: true });
  const sdkViewer = await context.newPage();
  try {
    await login(context);
    await join(page, roomId, true);
    await expect.poll(async () => {
      const health = await (await fetch('http://127.0.0.1:18182/health')).json();
      return health.webhookEvents?.[roomId]?.participant_joined ?? 0;
    }).toBeGreaterThan(0);
    // A raw SDK spectator keeps LiveKit nonempty but never requests our room
    // detail endpoint. Once the host page is closed there is no browser left
    // that can trigger reconciliation; the authenticated webhook must do it.
    await sdkViewer.goto('/live');
    await sdkViewer.addScriptTag({ path: resolve('node_modules/livekit-client/dist/livekit-client.umd.js') });
    await sdkViewer.evaluate(async ({ url, token }) => {
      const sdk = (window as unknown as { LivekitClient: typeof import('livekit-client') }).LivekitClient;
      const viewer = new sdk.Room();
      await viewer.connect(url, token);
    }, { url: livekitUrl.replace(/^http/, 'ws'), token: token({ roomJoin: true, room: roomId, canPublish: false, canSubscribe: true }, `viewer_webhook_${randomUUID()}`) });
    const before = await rpc('ListParticipants', { room: roomId }, { roomAdmin: true, room: roomId });
    expect(before.participants).toHaveLength(2);
    await page.close();
    await expect.poll(async () => {
      const rooms = await rpc('ListRooms', { names: [roomId] }, { roomList: true });
      return rooms.rooms ?? [];
    }, { timeout: 15_000 }).toHaveLength(0);
    await expect.poll(async () => {
      const health = await (await fetch('http://127.0.0.1:18182/health')).json();
      return health.webhookEvents?.[roomId]?.participant_left ?? 0;
    }).toBeGreaterThan(0);
  } finally {
    await sdkViewer.close();
    await rpc('DeleteRoom', { room: roomId }, { roomCreate: true });
  }
});

test('idle connected rooms and cached detail reads make no periodic HTTP or LiveKit RPC calls', async ({ page, context, browser }) => {
  test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires webhook-enabled local LiveKit');
  test.setTimeout(60_000);
  const roomId = `voice-e2e-${randomUUID()}`;
  const viewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3012' });
  await rpc('CreateRoom', { name: roomId, metadata: JSON.stringify({ title: '空闲不轮询测试', ownerId: 'live-test-host' }) }, { roomCreate: true });
  try {
    await login(context);
    const viewer = await viewerContext.newPage();
    await join(page, roomId, true);
    await join(viewer, roomId, false);
    await expect(page.getByRole('button', { name: '在线 2' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: '申请连麦', exact: true })).toBeEnabled();
    await expect.poll(async () => {
      const health = await (await fetch('http://127.0.0.1:18182/health')).json();
      return health.webhookEvents?.[roomId]?.participant_joined ?? 0;
    }).toBeGreaterThanOrEqual(2);
    const reads: string[] = [];
    for (const current of [page, viewer]) current.on('request', request => {
      if (new URL(request.url()).pathname.startsWith(`/api/v1/rooms/${roomId}`)) reads.push(`${request.method()} ${request.url()}`);
    });
    const before = await (await fetch('http://127.0.0.1:18182/health')).json();
    // Cache reads may happen on navigation or manual checks, but cannot amplify
    // into Cloud API calls. This also protects the public unauthenticated path.
    for (let i = 0; i < 3; i++) {
      const detail = await viewer.request.get(`/api/v1/rooms/${roomId}`);
      expect(detail.ok()).toBe(true);
      expect((await detail.json()).state).toBe('open');
    }
    await page.waitForTimeout(11_000);
    expect(reads).toEqual([]);
    const after = await (await fetch('http://127.0.0.1:18182/health')).json();
    expect(after.rpcCalls).toEqual(before.rpcCalls);
    await expect(page.getByText('已连接', { exact: true })).toBeVisible();
    await expect(viewer.getByText('已连接', { exact: true })).toBeVisible();
  } finally {
    await viewerContext.close();
    await rpc('DeleteRoom', { room: roomId }, { roomCreate: true });
  }
});
