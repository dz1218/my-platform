import { expect, test } from '@playwright/test';

test('private sockets use fresh tickets and connect directly to API', async ({ page, context }) => {
  await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  const sockets: URL[] = [];
  page.on('websocket', socket => sockets.push(new URL(socket.url())));
  await page.goto('/companion');
  await expect.poll(() => sockets.filter(url => url.pathname === '/api/v1/matches/socket').length).toBeGreaterThan(0);
  const matchSocket = sockets.find(url => url.pathname === '/api/v1/matches/socket')!;
  expect(matchSocket.origin).toBe('ws://127.0.0.1:18181');
  expect(matchSocket.searchParams.get('ticket')).toBeTruthy();
  expect(sockets.some(url => url.pathname.startsWith('/ws/'))).toBe(false);
  // Exercise the real bootstrap route, including authentication and ticket renewal.
  const result = await page.evaluate(async () => {
    const connect = async () => {
      const response = await fetch('/api/realtime/connection?kind=conversation&conversationId=test-conversation', { method: 'POST' });
      const { url } = await response.json();
      const snapshot = await new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.onmessage = event => { resolve(event.data); socket.close(); };
        socket.onerror = () => { socket.close(); reject(new Error('socket failed')); };
      });
      return { url, snapshot };
    };
    return [await connect(), await connect()];
  });
  expect(new URL(result[0].url).origin).toBe('ws://127.0.0.1:18181');
  expect(JSON.parse(result[0].snapshot).type).toBe('history');
  expect(result[0].url).not.toBe(result[1].url);
});

test('private bootstrap rejects guests, foreign origins and invalid scopes', async ({ request }) => {
  expect((await request.post('/api/realtime/connection?kind=matches')).status()).toBe(401);
  expect((await request.post('/api/realtime/connection?kind=matches', { headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await request.post('/api/realtime/connection?kind=conversation&conversationId=../matches')).status()).toBe(400);
});
