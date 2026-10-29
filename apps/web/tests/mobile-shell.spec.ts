import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:18181';
const cookie = { name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' };

test.afterEach(async ({ request }) => { await request.post(`${fixture}/__performance`, { data: {} }); });

test('profile keeps one pending matches request across mobile and desktop layouts', async ({ page, context }) => {
  await context.addCookies([cookie]);
  // This test controls the pending HTTP snapshot; an unrelated empty socket
  // snapshot would legitimately replace the loading state before it resolves.
  await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = 0;
  const cancelled: string[] = [];
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/api/v1/matches') cancelled.push(request.url());
  });
  await page.route('**/api/v1/matches', async route => {
    started += 1;
    await gate;
    await route.fulfill({ json: { items: [{ id: 'stable-profile-match', conversationId: 'stable-profile-conversation', identity: { id: 'stable-profile-identity', name: '晚风', age: 24, avatarUrl: '' } }] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto('/me');
    const main = page.getByRole('main');
    await expect(main).toHaveAttribute('data-mobile-page', 'account');
    await expect.poll(() => started).toBe(1);
    await expect(main.getByRole('status', { name: '正在加载聊天…', exact: true })).toBeVisible();
    await main.getByRole('tab', { name: 'AI 身份', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 844 });
    await expect(main).not.toHaveAttribute('data-mobile-page', 'account');
    await expect(main.getByRole('tab', { name: 'AI 身份', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize({ width: 640, height: 844 });
    await expect(main).toHaveAttribute('data-mobile-page', 'account');
    await main.getByRole('tab', { name: '最近聊天', exact: true }).click();
    const skeleton = main.getByRole('status', { name: '正在加载聊天…', exact: true });
    await expect(skeleton).toBeVisible();
    const rows = await skeleton.locator(':scope > div').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
    expect(new Set(rows).size).toBe(rows.length);
    expect(started).toBe(1);
    expect(cancelled).toEqual([]);
  } finally { release(); }
  await expect(page.getByRole('link', { name: '继续和晚风聊天' })).toBeVisible();
  expect(started).toBe(1);
  expect(cancelled).toEqual([]);
});

for (const width of [320, 390]) {
  test(`mobile account keeps private data and working account actions at ${width}px`, async ({ page, context }, testInfo) => {
    await context.addCookies([cookie]);
    await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [{ id: 'mobile-shell-match', conversationId: 'mobile-shell-conversation', identity: { id: 'mobile-shell-identity', name: '林晚', age: 24, avatarUrl: '' } }] } }));
    // This account-action test owns its chat fixture; the default empty socket
    // snapshot must not replace the HTTP response before the logout assertions.
    await page.routeWebSocket('**/api/v1/matches/socket?*', () => {});
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/me');
    const main = page.getByRole('main');
    await expect(main).toHaveAttribute('data-mobile-page', 'account');
    await expect(main).not.toContainText('13800138000');
    await main.getByRole('button', { name: '显示手机号', exact: true }).click();
    await expect(main).toContainText('13800138000');
    await main.getByRole('button', { name: '隐藏手机号', exact: true }).click();
    await expect(main.getByRole('heading', { name: '你的聊天 1', exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: '继续和林晚聊天' })).toHaveAttribute('href', '/chat/mobile-shell-match');
    await main.getByRole('tab', { name: '最近聊天', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(main.getByRole('tabpanel', { name: 'AI 身份', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(main.getByRole('tab', { name: 'AI 身份', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize({ width, height: 844 });
    await expect(main.getByRole('tab', { name: 'AI 身份', exact: true })).toHaveAttribute('aria-selected', 'true');
    await main.getByRole('button', { name: '平台互动说明', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(main.getByRole('button', { name: '平台互动说明', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mobile-account-${width}.png`), fullPage: true });
    await main.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    expect((await context.cookies()).some(item => item.name === 'companion_session')).toBe(false);
  });

  test(`mobile auth owns one form across registration steps at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/register');
    await page.getByLabel('手机号', { exact: true }).fill('13800138002');
    await page.getByLabel('短信验证码', { exact: true }).fill('123456');
    await page.getByRole('button', { name: '验证并继续', exact: true }).click();
    await expect(page.getByLabel('昵称', { exact: true })).toBeVisible();
    await expect(page.locator('form.auth-form')).toHaveCount(1);
    await expect(page.locator('input[name="ticket"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: '认识一下你。', exact: true })).toBeFocused();
    await page.getByLabel('昵称', { exact: true }).fill('晚风');
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('晚风');
    await page.setViewportSize({ width, height: 740 });
    await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('晚风');
    await expect(page.locator('input[name="ticket"]')).toHaveValue('browser-test-phone-proof');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mobile-register-${width}.png`), fullPage: true });
  });
}

test('mobile reader keeps the chapter server-rendered and skips unpublished neighbors', async ({ page, context, request }, testInfo) => {
  await request.post(`${fixture}/__performance`, { data: { user: { id: 'reader-only' } } });
  const headers = { Cookie: 'companion_session=inheritance-test-completed' };
  const chapterURL = `${fixture}/api/v1/novels/design-novel/chapters`;
  await request.post(chapterURL, { headers, data: { title: '未发布草稿' } });
  const response = await request.post(chapterURL, { headers, data: { title: '下一封信' } });
  const nextChapter = await response.json() as { id: string };
  await request.post(`${chapterURL}/${nextChapter.id}/publish`, { headers, data: { published: true } });
  await context.addCookies([cookie]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/novels');
  await expect(page.getByRole('main')).toHaveAttribute('data-mobile-page', 'novels');
  await page.screenshot({ path: testInfo.outputPath('mobile-bookshelf.png'), fullPage: true });
  await page.getByRole('heading', { name: '雨停之前的来信', exact: true }).click();
  await expect(page).toHaveURL('/novels/design-novel');
  await page.getByRole('link', { name: '开始阅读', exact: true }).click();
  await expect(page).toHaveURL('/novels/design-novel/chapters/design-chapter');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: '手机主导航', exact: true })).toBeHidden();
  const navigation = page.getByRole('navigation', { name: '章节导航', exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link', { name: '下一章', exact: true })).toHaveAttribute('href', `/novels/design-novel/chapters/${nextChapter.id}`);
  await expect(navigation.getByText('已是首章')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-reading.png'), fullPage: true });
  await navigation.getByRole('link', { name: '目录', exact: true }).click();
  await expect(page).toHaveURL('/novels/design-novel#chapters');
  await expect(page.getByText('未发布草稿', { exact: true })).toHaveCount(0);
  const document = await context.request.get('/novels/design-novel/chapters/design-chapter');
  expect(await document.text()).toContain('街道另一端的灯还亮着。');
});
