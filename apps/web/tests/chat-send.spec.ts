import { expect, test, type WebSocketRoute } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`can send consecutive messages before acknowledgement at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-inherited', domain: '127.0.0.1', path: '/' }]);
    let socket: WebSocketRoute;
    const commands: { content: string; requestId: string }[] = [];
    await page.routeWebSocket('**/api/v1/conversations/*/socket?*', ws => {
      socket = ws;
      ws.onMessage(raw => { const data = JSON.parse(String(raw)); if (data.type === 'send') commands.push(data); });
    });
    await page.route('**/api/v1/matches/send-match', route => route.fulfill({ json: {
      id: 'send-match', conversationId: 'send-conversation', identity: { id: 'identity', name: '陈念', age: 24, avatarUrl: '' },
    } }));
    await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
    await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'AI', mode: 'AUTO', delaySeconds: 0, version: 1, canManage: false } }));
    await page.goto('/chat/send-match');
    await expect.poll(() => !!socket).toBe(true);
    const input = page.locator('textarea[name="message"]');
    for (const content of ['一般', '你呢']) {
      await input.fill(content);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(input).toHaveValue('');
    }
    await expect.poll(() => commands.length).toBe(2);
    const message = (index: number) => ({ id: String(index + 1), ...commands[index], senderType: 'user', source: 'USER', sender: { id: 'self', name: '我' }, status: 'complete', createdAt: '' });
    // A persisted snapshot must acknowledge the first send even without an accepted frame.
    socket!.send(JSON.stringify({ type: 'history', page: { items: [message(0)] } }));
    socket!.send(JSON.stringify({ type: 'error', requestId: commands[1].requestId, message: '暂时不可用' }));
    await expect(page.getByRole('button', { name: '发送失败，点击重试' })).toBeVisible();
    await page.getByRole('button', { name: '发送失败，点击重试' }).click();
    await expect.poll(() => commands.length).toBe(3);
    expect(commands[2].requestId).toBe(commands[1].requestId);
    socket!.send(JSON.stringify({ type: 'accepted', requestId: commands[2].requestId, message: message(1) }));
    await expect(page.getByText('发送中', { exact: true })).toHaveCount(0);
    // Accepting a user message does not expose generation/queue state or fake typing.
    await expect(page.getByText(/正在回复|正在输入|正在思考|生成中/)).toHaveCount(0);
    await expect(page.getByRole('log').getByText('一般', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('log').getByText('你呢', { exact: true })).toHaveCount(1);
  });
}
