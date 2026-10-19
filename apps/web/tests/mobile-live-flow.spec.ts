import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

async function rpc(method: string, room: string) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const key = process.env.LIVEKIT_TEST_API_KEY || 'devkey';
  const secret = process.env.LIVEKIT_TEST_API_SECRET || 'devsecretdevsecretdevsecretdevsec';
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: key, nbf: now, exp: now + 300, video: { roomCreate: true, roomAdmin: true, roomList: true, room } })}`;
  const token = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  const response = await fetch(`${(process.env.LIVEKIT_TEST_URL || 'http://127.0.0.1:7880').replace(/^ws/, 'http')}/twirp/livekit.RoomService/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(method === 'CreateRoom' ? { name: room, metadata: JSON.stringify({ title: '晚风电台', ownerId: 'live-test-host' }) } : { room }),
  });
  expect(response.ok || method === 'DeleteRoom' && response.status === 404).toBe(true);
  if (method === 'CreateRoom') await fetch('http://127.0.0.1:18182/__sync', { method: 'POST' });
}
async function join(page: Page, room: string) {
  const response = page.waitForResponse(response => response.url().endsWith(`/rooms/${room}/join`) && response.request().method() === 'POST');
  await page.goto(`/live/${room}`);
  expect((await response).status()).toBe(201);
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
}

test('phone host and viewer complete devices, chat, members, voice, leave and end flows', async ({ page: host, context, browser }, info) => {
  test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires local LiveKit');
  test.setTimeout(120_000);
  const room = `voice-e2e-${randomUUID()}`;
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3012', viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] });
  const viewer = await guestContext.newPage();
  await context.grantPermissions(['camera', 'microphone']);
  await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
  await host.setViewportSize({ width: 390, height: 844 });
  await rpc('CreateRoom', room);
  try {
    await join(host, room);
    await join(viewer, room);
    await expect(host.getByRole('button', { name: '在线 2', exact: true })).toBeVisible();
    await expect(host.getByRole('button', { name: '开启麦克风', exact: true })).toHaveCount(0);
    await host.getByRole('button', { name: '设备与助手', exact: true }).click();
    await host.getByRole('button', { name: '开启摄像头', exact: true }).click();
    await expect(host.getByRole('button', { name: '关闭摄像头', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await host.getByRole('button', { name: '开启麦克风', exact: true }).click();
    await host.screenshot({ path: info.outputPath('host-devices.png'), fullPage: true });
    await host.getByRole('button', { name: '关闭设备与助手', exact: true }).click();
    await expect(viewer.locator('.live-stage video')).toHaveCount(1);
    const input = viewer.getByRole('textbox', { name: '发送消息', exact: true });
    await input.fill('今晚好');
    await input.press('Enter');
    await expect(input).toHaveValue('今晚好\n');
    await expect(host.getByRole('log')).not.toContainText('今晚好');
    await viewer.getByRole('button', { name: '发送', exact: true }).click();
    await expect(host.getByRole('log')).toContainText('今晚好');
    await host.getByRole('button', { name: '在线 2', exact: true }).click();
    await expect(host.getByRole('dialog', { name: '在线成员', exact: true })).toContainText('参与者 · 2');
    await host.getByRole('button', { name: '关闭在线成员', exact: true }).click();
    await viewer.getByRole('button', { name: '连麦与设备', exact: true }).click();
    await viewer.getByRole('button', { name: '申请连麦', exact: true }).click();
    await expect(viewer.getByRole('dialog', { name: '连麦与设备', exact: true })).toContainText('等待主播同意');
    await host.getByRole('button', { name: /^连麦/ }).click();
    await host.getByRole('button', { name: '同意连麦', exact: true }).click();
    await expect(viewer.getByRole('switch', { name: '麦克风', exact: true })).toBeEnabled();
    await viewer.getByRole('switch', { name: '麦克风', exact: true }).click();
    await viewer.getByRole('switch', { name: '摄像头', exact: true }).click();
    await expect(viewer.getByRole('switch', { name: '摄像头', exact: true })).toHaveAttribute('aria-checked', 'true');
    await viewer.screenshot({ path: info.outputPath('viewer-call.png'), fullPage: true });
    await viewer.getByRole('button', { name: '关闭连麦与设备', exact: true }).click();
    await host.getByRole('button', { name: '关闭连麦管理', exact: true }).click();
    await expect(host.locator('.live-stage video')).toHaveCount(2);
    const videos = await viewer.locator('.live-stage video').elementHandles();
    await viewer.getByRole('button', { name: '将连麦者切换到大画面', exact: true }).click();
    for (const video of videos) expect(await video.evaluate(element => element.isConnected)).toBe(true);
    await viewer.getByRole('button', { name: '房间选项', exact: true }).click();
    await expect(viewer.getByRole('button', { name: '分享直播间', exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: '关闭房间选项', exact: true }).click();
    await viewer.getByRole('button', { name: '离开', exact: true }).click();
    await viewer.getByRole('button', { name: '继续观看', exact: true }).click();
    await expect(viewer.locator('.live-stage video')).toHaveCount(2);
    await viewer.screenshot({ path: info.outputPath('viewer-room.png'), fullPage: true });
    await viewer.getByRole('button', { name: '连麦与设备', exact: true }).click();
    await viewer.getByRole('button', { name: '退出连麦', exact: true }).click();
    await expect(host.locator('.live-stage video')).toHaveCount(1);
    await viewer.getByRole('button', { name: '关闭连麦与设备', exact: true }).click();
    await viewer.getByRole('button', { name: '离开', exact: true }).click();
    await viewer.getByRole('button', { name: '确认离开', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: '你已离开直播间', exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: '重新加入', exact: true }).click();
    await expect(viewer.getByText('已连接', { exact: true })).toBeVisible();
    await expect(host.getByRole('button', { name: '在线 2', exact: true })).toBeVisible();
    await host.getByRole('button', { name: '结束直播', exact: true }).click();
    await host.getByRole('button', { name: '取消', exact: true }).click();
    await expect(viewer.getByText('已连接', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: '结束直播', exact: true }).click();
    await host.screenshot({ path: info.outputPath('host-end.png'), fullPage: true });
    await host.getByRole('button', { name: '确认结束', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: '直播间已结束', exact: true })).toBeVisible();
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await guestContext.close();
    await rpc('DeleteRoom', room);
  }
});
