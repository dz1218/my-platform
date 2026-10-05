import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

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
  expect(response.ok, `${method}: ${response.status}`).toBe(true);
  return response.json();
}

async function join(page: Page, roomId: string, host: boolean) {
  let attempt = 0;
  await page.route(`**/api/v1/rooms/${roomId}/join`, (route) => {
    const identity = `${host ? 'host' : 'viewer'}_e2e_${++attempt}`;
    return route.fulfill({ status: 201, json: {
      roomId, identity, livekitUrl: livekitUrl.replace(/^http/, 'ws'),
      token: token({ roomJoin: true, room: roomId, canPublish: host, canSubscribe: true, canPublishData: true }, identity),
    } });
  });
  await page.goto(`/live/${roomId}`);
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  expect(attempt).toBe(1);
  return () => attempt;
}

test('real host/viewer media, permissions, rejoin and navigation cleanup', async ({ page, context, browser }) => {
  test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires local LiveKit');
  test.setTimeout(90_000);
  const roomId = `live-e2e-${randomUUID()}`;
  await rpc('CreateRoom', { name: roomId, emptyTimeout: 30 }, { roomCreate: true });
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3012' });
  try {
    await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
    const hostJoinAttempts = await join(page, roomId, true);
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

    await page.getByRole('button', { name: '离开房间' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(guest.getByRole('button', { name: '在线 1' })).toBeVisible();
    await page.getByRole('button', { name: '重新加入', exact: true }).click();
    await expect(page.getByText('已连接', { exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: '在线 2' })).toBeVisible();
    await page.getByRole('link', { name: '直播大厅' }).click();
    await expect(guest.getByRole('button', { name: '在线 1' })).toBeVisible();
    const participants = await rpc('ListParticipants', { room: roomId }, { roomAdmin: true, room: roomId });
    expect(participants.participants).toHaveLength(1);
    // Returning through the lobby must also connect without a second button.
    await page.route('**/api/v1/rooms', (route) => route.fulfill({ json: { items: [
      { id: roomId, title: '正在直播的房间', status: '直播中', viewers: 1 },
    ] } }));
    await page.getByRole('button', { name: '刷新列表' }).click();
    await page.getByRole('link', { name: '进入直播间', exact: true }).click();
    await expect(page.getByText('已连接', { exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: '在线 2' })).toBeVisible();
    expect(hostJoinAttempts()).toBe(3);

    // Refreshing an active room must restore the connected view automatically.
    await page.reload();
    await expect(page.getByText('已连接', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(开始直播|开启直播|重新加入)$/ })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: '在线 2' })).toBeVisible();
    expect(hostJoinAttempts()).toBe(4);
    const afterReload = await rpc('ListParticipants', { room: roomId }, { roomAdmin: true, room: roomId });
    expect(afterReload.participants).toHaveLength(2);
  } finally {
    await guestContext.close();
    await rpc('DeleteRoom', { room: roomId }, { roomCreate: true });
  }
});
