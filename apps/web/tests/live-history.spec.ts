import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

async function rpc(method: string, body: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: process.env.LIVEKIT_TEST_API_KEY || 'devkey',
    exp: Math.floor(Date.now() / 1000) + 300,
    video: { roomCreate: true, roomAdmin: true, room: body.name },
  })}`;
  const signature = createHmac('sha256', process.env.LIVEKIT_TEST_API_SECRET || 'devsecretdevsecretdevsecretdevsec')
    .update(content).digest('base64url');
  const response = await fetch(`${(process.env.LIVEKIT_TEST_URL || 'http://127.0.0.1:7880').replace(/^ws/, 'http')}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${content}.${signature}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.ok || (method === 'DeleteRoom' && response.status === 404)).toBe(true);
}

async function enter(page: Page, roomId: string, reload = false) {
  const joining = page.waitForResponse(response => response.url().endsWith(`/rooms/${roomId}/join`) && response.status() === 201);
  if (reload) await page.reload();
  else await page.goto(`/live/${roomId}`);
  const joined = await (await joining).json();
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  // The isolated LiveKit has no development webhook; reconcile presence here.
  expect((await fetch('http://127.0.0.1:18182/__sync', { method: 'POST' })).ok).toBe(true);
  await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeEnabled();
  return joined as { roomToken: string; member: { id: string }; identity: string };
}

async function send(page: Page, text: string) {
  const sent = page.waitForResponse(response => response.url().endsWith('/messages') && response.request().method() === 'POST');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByRole('log')).toContainText(text);
}

for (const width of [1440, 390]) {
  test(`live chat history survives host and guest reload at ${width}px`, async ({ page: host, context, browser }) => {
    test.skip(process.env.LIVEKIT_INTEGRATION !== '1', 'Requires isolated LiveKit');
    test.setTimeout(90_000);
    const roomId = `voice-e2e-${randomUUID()}`;
    await host.setViewportSize({ width, height: 960 });
    const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3012', viewport: { width, height: 960 } });
    await context.addCookies([{ name: 'companion_session', value: 'live-test-host', domain: '127.0.0.1', path: '/' }]);
    await rpc('CreateRoom', { name: roomId, departureTimeout: 120, metadata: JSON.stringify({ ownerId: 'live-test-host', title: '刷新历史回归' }) });
    try {
      expect((await fetch('http://127.0.0.1:18182/__sync', { method: 'POST' })).ok).toBe(true);
      const firstHost = await enter(host, roomId);
      await send(host, '观众入场前的消息');
      const guest = await guestContext.newPage();
      const firstGuest = await enter(guest, roomId);
      await send(guest, '刷新前的观众消息');
      await send(host, '刷新前的主播消息');
      for (const page of [host, guest]) {
        await expect(page.getByRole('log')).toContainText('刷新前的观众消息');
        await expect(page.getByRole('log')).toContainText('刷新前的主播消息');
      }
      for (const [page, first] of [[host, firstHost], [guest, firstGuest]] as const) {
        const refreshed = await enter(page, roomId, true);
        expect(refreshed.member.id).toBe(first.member.id);
        const response = await page.request.get(`/api/v1/rooms/${roomId}/activity`, { headers: { 'X-Live-Room-Token': refreshed.roomToken } });
        expect(response.ok()).toBe(true);
        const snapshot = await response.json();
        expect(snapshot.messages.map((message: { text: string }) => message.text)).toContain('刷新前的观众消息');
        await expect(page.getByRole('log')).toContainText('刷新前的观众消息');
        await expect(page.getByRole('log')).toContainText('刷新前的主播消息');
      }
      await expect(host.getByRole('log')).toContainText('观众入场前的消息');
      await expect(guest.getByRole('log')).not.toContainText('观众入场前的消息');
      await send(guest, '刷新后的新消息');
      await expect(host.getByRole('log')).toContainText('刷新后的新消息');
      await host.screenshot({ path: test.info().outputPath('host-history.png') });
      await guest.screenshot({ path: test.info().outputPath('guest-history.png') });
    } finally {
      try { await guestContext.close(); }
      finally { await rpc('DeleteRoom', { name: roomId }); }
    }
  });
}
