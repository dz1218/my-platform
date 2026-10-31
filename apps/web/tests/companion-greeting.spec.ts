import { expect, test, type Page, type Route } from '@playwright/test';

const identity = { id: 'greeting-friend', name: '林晚', age: 26, city: '杭州', gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' };
const known = { id: 'known-match', conversationId: 'known-conversation', identity };

async function setup(page: Page, existing = false) {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  await page.routeWebSocket('**/api/v1/conversations/*/socket?*', () => {});
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [identity], total: 1, page: 1, nextPage: null, occupations: [] } }));
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: existing ? [known] : [] } }));
  await page.route('**/api/v1/matches/*', route => route.fulfill({ json: known }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'HUMAN', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
}

async function expectPreview(page: Page) {
  const dialog = page.getByRole('dialog', { name: '和林晚的聊天' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '林晚', exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '给林晚发消息' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '返回陪伴' })).toBeEnabled();
  await expect(page.getByText('正在打开聊天…', { exact: true })).toHaveCount(0);
  expect(await dialog.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return dialog;
}

for (const width of [390, 768, 1440]) {
  test(`greeting opens the chat frame before creation, keeps it on error, then loads messages at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    const posts: Route[] = [];
    await page.route('**/api/v1/matches', route => route.request().method() === 'POST' ? void posts.push(route) : route.fallback());
    const messages: Route[] = [];
    await page.route('**/api/v1/conversations/*/messages', route => { messages.push(route); });
    await page.goto('/companion?view=discover');
    const greeting = page.getByRole('button', { name: '和林晚打个招呼', exact: true });
    await expect(greeting).toBeEnabled();
    await page.evaluate(() => {
      document.addEventListener('click', () => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (document.querySelector('dialog:modal [data-chat-loading]')) {
            document.documentElement.dataset.chatFeedbackMs = String(performance.now() - start);
            observer.disconnect();
          }
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      }, { capture: true, once: true });
    });
    await greeting.click();
    const preview = await expectPreview(page);
    await expect(preview.getByRole('status', { name: '正在加载聊天记录…' })).toBeVisible();
    expect(Number(await page.locator('html').getAttribute('data-chat-feedback-ms'))).toBeLessThan(200);
    await expect.poll(() => posts.length).toBe(1);
    const y = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 600);
    expect(await page.evaluate(() => scrollY)).toBe(y);
    await page.screenshot({ path: testInfo.outputPath(`chat-entry-${width}.png`) });
    await posts[0].fulfill({ status: 503, json: { error: { message: '暂时无法开始聊天' } } });
    await expect(preview.getByRole('alert')).toContainText('暂时无法开始聊天');
    await preview.getByRole('button', { name: '重新加载' }).click();
    await expect.poll(() => posts.length).toBe(2);
    await posts[1].fulfill({ json: known });
    await expect(page).toHaveURL('/chat/known-match');
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '林晚', exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: '正在加载聊天记录…' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '给林晚发消息' })).toBeDisabled();
    await expect.poll(() => messages.length).toBeGreaterThan(0);
    for (const route of messages) await route.fulfill({ json: { items: [] } }).catch(() => {});
    await expect(page.getByRole('textbox', { name: '给林晚发消息' })).toBeEnabled();
    await page.getByRole('textbox', { name: '给林晚发消息' }).fill('保留聊天草稿');
    await page.getByRole('button', { name: '返回陪伴', exact: true }).click();
    await expect(page).toHaveURL('/companion?view=discover');
    await expect(page.getByRole('link', { name: /继续聊天\s*，和林晚/ })).toBeVisible();
    await expect(page.locator('dialog:modal')).toHaveCount(0);
  });

  test(`existing card shows the chat immediately while its route is blocked and can cancel at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, true);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/chat\/known-match(?:\?|$)/, async route => { await gate; await route.continue(); });
    await page.goto('/companion?view=discover');
    const link = page.getByRole('link', { name: /继续聊天\s*，和林晚/ });
    try {
      await link.click();
      const preview = await expectPreview(page);
      await page.screenshot({ path: testInfo.outputPath(`existing-entry-${width}.png`) });
      await preview.getByRole('button', { name: '返回陪伴' }).click();
      await expect(preview).toHaveCount(0);
      await expect(link).toBeVisible();
    } finally { release(); }
    await expect(page).toHaveURL('/companion?view=discover');
    // A cancelled route response cannot reopen the conversation.
    await page.waitForTimeout(500);
    await expect(page).toHaveURL('/companion?view=discover');
    await link.click();
    await expect(page).toHaveURL('/chat/known-match');
    await expect(page.getByRole('textbox', { name: '给林晚发消息' })).toBeEnabled();
  });
}

test('returning during a greeting keeps a late success in the list without reopening chat', async ({ page }) => {
  await setup(page);
  let pending!: Route;
  await page.route('**/api/v1/matches', route => route.request().method() === 'POST' ? void (pending = route) : route.fallback());
  await page.goto('/companion');
  await page.getByRole('button', { name: '和林晚打个招呼' }).click();
  const preview = await expectPreview(page);
  await expect.poll(() => !!pending).toBe(true);
  await preview.getByRole('button', { name: '返回陪伴' }).click();
  await expect(preview).toHaveCount(0);
  await pending.fulfill({ json: known });
  await expect(page.getByRole('link', { name: /继续聊天\s*，和林晚/ })).toBeVisible();
  await expect(page).toHaveURL('/companion');
});

test('direct chat entry keeps its frame through slow detail and message reads', async ({ page }) => {
  await setup(page);
  let detail!: Route;
  await page.route('**/api/v1/matches/known-match', route => { detail = route; });
  await page.goto('/chat/known-match');
  const frame = page.getByRole('main', { name: '聊天', exact: true });
  await expect(frame).toBeVisible();
  await expect(frame.getByRole('link', { name: '返回陪伴' })).toBeEnabled();
  await expect(frame.getByRole('textbox')).toBeDisabled();
  await expect.poll(() => !!detail).toBe(true);
  await detail.fulfill({ json: known });
  await expect(page.getByRole('textbox', { name: '给林晚发消息' })).toBeEnabled();
});

for (const width of [390, 1440]) {
  test(`account bootstrap uses the chat frame before slow server authentication at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await request.post('http://127.0.0.1:18181/__performance', { data: { delays: { '/api/v1/me': 2500 } } });
    try {
      await page.goto('/chat/known-match', { waitUntil: 'commit' });
      const startup = page.locator('[data-app-startup]');
      await expect(startup.locator('[data-chat-loading]')).toBeVisible();
      await expect(startup).toHaveAttribute('data-immersive', 'true');
      await expect(page.getByText('正在打开聊天…')).toHaveCount(0);
      await expect(startup.getByRole('textbox')).toBeDisabled();
      await expect(page.getByRole('textbox', { name: '给林晚发消息' })).toBeEnabled();
    } finally { await request.post('http://127.0.0.1:18181/__performance', { data: {} }); }
  });
}

test('profile card enters the same frame before its route response', async ({ page }) => {
  await setup(page, true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/chat\/known-match(?:\?|$)/, async route => { await gate; await route.continue(); });
  await page.goto('/me');
  try {
    await page.getByRole('link', { name: '继续和林晚聊天' }).click();
    await expectPreview(page);
  } finally { release(); }
  await expect(page).toHaveURL('/chat/known-match');
  await expect(page.getByRole('textbox', { name: '给林晚发消息' })).toBeEnabled();
});

test('a forbidden match cannot open a conversation or enable sending', async ({ page }) => {
  await setup(page);
  let sockets = 0;
  await page.routeWebSocket('**/api/v1/conversations/*/socket?*', () => { sockets++; });
  await page.route('**/api/v1/matches/known-match', route => route.fulfill({ status: 403, json: { error: { message: '你不能访问这段聊天' } } }));
  await page.goto('/chat/known-match');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('你不能访问这段聊天');
  await expect(page.getByRole('textbox')).toBeDisabled();
  expect(sockets).toBe(0);
});

test('keyboard entry returns focus to the same card after chatting', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/matches', route => route.request().method() === 'POST' ? route.fulfill({ json: known }) : route.fallback());
  await page.goto('/companion');
  const greeting = page.getByRole('button', { name: '和林晚打个招呼', exact: true });
  await greeting.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/chat/known-match');
  await expect(page.getByRole('textbox', { name: '给林晚发消息' })).toBeEnabled();
  await page.goBack();
  await expect(page.getByRole('link', { name: /继续聊天\s*，和林晚/ })).toBeFocused();
});

test('the inherited identity guard still prevents conversation requests after immediate entry', async ({ page }) => {
  await setup(page);
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-inherited', domain: '127.0.0.1', path: '/' }]);
  const self = { ...known, identity: { ...identity, id: 'inheritance-chennian', name: '陈念' } };
  await page.route('**/api/v1/matches', route => route.request().method() === 'POST' ? route.fulfill({ json: self }) : route.fallback());
  await page.route('**/api/v1/matches/known-match', route => route.fulfill({ json: self }));
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/conversations/')) requests.push(request.url()); });
  await page.goto('/companion');
  await page.getByRole('button', { name: '和林晚打个招呼', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这是你继承的 AI 身份' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '这是你继承的 AI 身份' })).toBeVisible();
  expect(requests).toEqual([]);
});
