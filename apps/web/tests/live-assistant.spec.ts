import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const livekitURL = process.env.LIVEKIT_TEST_URL || 'http://127.0.0.1:7880';
async function rpc(method: string, body: Record<string, unknown>) {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: process.env.LIVEKIT_TEST_API_KEY || 'devkey', nbf: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, video: { roomCreate: true, roomAdmin: true, roomList: true, room: body.room || body.name } })}`;
  const token = `${data}.${createHmac('sha256', process.env.LIVEKIT_TEST_API_SECRET || 'devsecretdevsecretdevsecretdevsec').update(data).digest('base64url')}`;
  const response = await fetch(`${livekitURL.replace(/^ws/, 'http')}/twirp/livekit.RoomService/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (method === 'DeleteRoom' && response.status === 404) return;
  expect(response.ok, `${method}: ${response.status}`).toBe(true);
}
async function sync() {
  // The shared developer LiveKit may send webhooks to :8080, not this isolated
  // fixture. Reconcile test rooms explicitly without changing its configuration.
  const response = await fetch('http://127.0.0.1:18182/__sync', { method: 'POST' });
  expect(response.ok).toBe(true);
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

test.describe('room assistant with real LiveKit, Go and fake model', () => {
  test.skip(process.env.ROOM_ASSISTANT_INTEGRATION !== '1' || process.env.LIVEKIT_INTEGRATION !== '1', 'Requires local LiveKit and room worker fixtures');
  for (const mobile of [false, true]) test(`${mobile ? 'phone' : 'desktop'} calls, shares replies, removes and resets assistant context`, async ({ page: host, context, browser }) => {
    test.setTimeout(120_000);
    const room = `voice-e2e-${randomUUID()}`;
    const viewerContext = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 } });
    const viewer = await viewerContext.newPage();
    await host.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 });
    await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
    await rpc('CreateRoom', { name: room, emptyTimeout: 60, metadata: JSON.stringify({ ownerId: 'live-test-host', title: 'AI 助手测试' }) });
    await sync();
    const panel = () => host.getByRole('button', { name: '设备与助手', exact: true });
    const open = async () => { if (mobile) await panel().click(); };
    const close = async () => { if (mobile) await host.getByRole('dialog').getByRole('button', { name: '关闭设备与助手', exact: true }).click(); };
    const call = async () => {
      await open(); await host.getByRole('button', { name: '呼叫 AI 助手', exact: true }).click();
      await expect.poll(async () => {
        await sync();
        const response = await host.request.get(`/api/v1/rooms/${room}`);
        return (await response.json()).assistant?.status;
      }, { timeout: 35_000, intervals: [500, 1000] }).toBe('online');
      await expect(host.getByText('AI 助手已在线', { exact: true })).toBeVisible(); await close();
    };
    try {
      await host.goto(`/live/${room}`); await expect(host.getByText('已连接', { exact: true })).toBeVisible();
      await viewer.goto(`http://127.0.0.1:3012/live/${room}`); await expect(viewer.getByText('已连接', { exact: true })).toBeVisible();
      await call();
      await send(viewer, '普通聊天不该触发助手');
      await viewer.getByRole('textbox', { name: '发送消息', exact: true }).fill('你好');
      await viewer.getByRole('button', { name: '向 AI 助手提问' }).click();
      await expect(viewer.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('@AI 你好');
      await viewer.getByRole('button', { name: '发送', exact: true }).click();
      for (const page of [host, viewer]) {
        await expect(page.getByText('测试回答（第1轮）：你好', { exact: true })).toBeVisible();
        await expect(page.locator('.live-message').filter({ hasText: '测试回答（第1轮）' }).locator('.live-message-role')).toHaveText('AI 助手');
      }
      await send(host, '@AI 继续');
      await expect(viewer.getByText('测试回答（第2轮）：继续', { exact: true })).toBeVisible();
      await host.screenshot({ path: test.info().outputPath('assistant-online.png'), fullPage: true });
      const previousCalls = (await (await fetch('http://127.0.0.1:18183/calls')).json()).length;
      await send(viewer, '@AI 慢回答');
      await expect.poll(async () => (await (await fetch('http://127.0.0.1:18183/calls')).json()).length).toBeGreaterThan(previousCalls);
      await open(); await host.getByRole('button', { name: '移除助手', exact: true }).click();
      await expect(host.getByRole('button', { name: '呼叫 AI 助手', exact: true })).toBeVisible(); await close();
      await expect(viewer.getByRole('button', { name: '向 AI 助手提问' })).toHaveCount(0);
      await call(); await send(viewer, '@AI 新会话');
      await expect(viewer.getByText('测试回答（第1轮）：新会话', { exact: true })).toBeVisible();
      await expect(viewer.getByText('测试回答（第3轮）：慢回答', { exact: true })).toHaveCount(0);
      const forbidden = await viewer.request.post(`/api/v1/rooms/${room}/agent/dispatch`, { data: {} });
      expect(forbidden.status()).toBe(401);
    } finally {
      await rpc('DeleteRoom', { room }); await sync(); await viewerContext.close();
    }
  });
});
