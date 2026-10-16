import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/identity-inheritance', route => route.fulfill({ json: { gender: 'FEMALE', onboardingCompleted: true, identity: null, items: [] } }));
  await page.route('**/api/v1/identity-inheritance/options?*', route => route.fulfill({ json: { items: [], total: 0, availableTotal: 0, page: 1, nextPage: null, occupations: [] } }));
  await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
});

test('profile privacy and inheritance rules work with keyboard', async ({ page }) => {
  await page.goto('/me');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('继承测试用户');
  await expect(main).not.toContainText('13800138000');
  const reveal = main.getByRole('button', { name: '显示手机号' });
  await expect(reveal.locator('svg')).toHaveClass(/lucide-eye-off/);
  await reveal.focus();
  await page.keyboard.press('Enter');
  await expect(main).toContainText('13800138000');
  await expect(main.getByRole('button', { name: '隐藏手机号' }).locator('svg')).toHaveClass(/lucide-eye(?!-off)/);
  await page.keyboard.press('Enter');
  await expect(main).not.toContainText('13800138000');
  await main.getByRole('tab', { name: 'AI 身份', exact: true }).click();
  const rules = main.locator('summary');
  await rules.focus();
  await page.keyboard.press('Enter');
  await expect(main.getByText(/每个账户只能继承一个同性别/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(main.getByText(/每个账户只能继承一个同性别/)).toBeHidden();
  await expect(main.getByRole('link', { name: '进入聊天' })).toHaveCount(0);
  await main.getByRole('link', { name: '选择 AI 身份', exact: true }).click();
  await expect(page).toHaveURL('/choose-identity');
});

test('inherited identity opens its own conversations', async ({ page, context }) => {
  await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-inherited', domain: '127.0.0.1', path: '/' }]);
  await page.route('**/api/v1/operator/conversations', route => route.fulfill({ json: { items: [] } }));
  await page.goto('/me');
  await page.getByRole('tab', { name: 'AI 身份', exact: true }).click();
  await expect(page.locator('main').getByText('已继承', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: '选择 AI 身份' })).toHaveCount(0);
  await page.locator('main').getByRole('link', { name: '以陈念的身份回复' }).click();
  await expect(page).toHaveURL('/operator');
  await expect(page.getByRole('heading', { name: '和陈念聊天的人' })).toBeVisible();
});

for (const state of ['completed', 'inherited']) {
  for (const width of [320, 390, 768, 1440, 1920]) {
    test(`profile layout ${state} at ${width}px`, async ({ page, context }, testInfo) => {
      await context.addCookies([{ name: 'companion_session', value: `inheritance-test-${state}`, domain: '127.0.0.1', path: '/' }]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/me');
      await expect(page.locator('main h1')).toBeVisible();
      await expect.poll(() => page.locator('main header img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath(`me-${state}-${width}.png`), fullPage: true, animations: 'disabled' });
      await page.getByRole('tab', { name: 'AI 身份', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath(`me-identity-${state}-${width}.png`), fullPage: true, animations: 'disabled' });
    });
  }
}

test('profile tabs support keyboard, real conversations and retry', async ({ page }, testInfo) => {
  let failed = true;
  const items = ['林晚', '陈念', '沈知远'].map((name, index) => ({ id: `profile-match-${index}`, conversationId: `profile-conversation-${index}`, identity: { id: `profile-identity-${index}`, name, age: 25, avatarUrl: '' } }));
  await page.route('**/api/v1/matches', route => failed ? route.fulfill({ status: 500, json: { error: { message: '测试错误' } } }) : route.fulfill({ json: { items } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me');
  await expect(page.getByRole('tabpanel').getByRole('alert')).toContainText('聊天暂时加载失败', { timeout: 15000 });
  failed = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('link', { name: '继续和林晚聊天' })).toHaveAttribute('href', '/chat/profile-match-0');
  const recent = page.getByRole('tab', { name: /最近聊天/ });
  await expect(page.getByRole('heading', { name: '你的聊天 3' })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: '认识新朋友' })).toHaveCount(1);
  const identityTab = page.getByRole('tab', { name: 'AI 身份', exact: true });
  const recentBox = (await recent.boundingBox())!;
  const identityBox = (await identityTab.boundingBox())!;
  expect(recentBox.y).toBe(identityBox.y);
  expect(recentBox.width).toBe(identityBox.width);
  expect(recentBox.height).toBe(identityBox.height);
  await recent.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'AI 身份', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'AI 身份', exact: true })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(recent).toHaveAttribute('aria-selected', 'true');
  await page.locator('main h1').click();
  await page.screenshot({ path: testInfo.outputPath('profile-with-conversations.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: '继续和林晚聊天' }).hover();
  await page.screenshot({ path: testInfo.outputPath('profile-card-hover.png'), fullPage: true, animations: 'disabled' });
  await identityTab.click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '选择 AI 身份', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('profile-identity-focus.png'), fullPage: true, animations: 'disabled' });
});


test('tab indicator settles after rapid reversal and respects reduced motion', async ({ page }) => {
  await page.goto('/me');
  const recent = page.getByRole('tab', { name: /最近聊天/ });
  const identity = page.getByRole('tab', { name: 'AI 身份', exact: true });
  const indicator = page.locator('.profile-tab-indicator');
  const line = page.locator('.profile-tab-line');
  await expect.poll(() => line.evaluate(element => element.getAnimations().length)).toBe(0);
  await identity.click();
  await expect(indicator).toHaveAttribute('data-active', 'identity');
  await recent.click();
  await identity.click();
  await expect.poll(async () => {
    const marker = (await indicator.boundingBox())!;
    const target = (await identity.boundingBox())!;
    return Math.abs(marker.x + marker.width / 2 - target.x - target.width / 2);
  }).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await recent.click();
  await expect(indicator).toHaveCSS('transition-duration', '0s');
  await expect(line).toHaveCSS('animation-name', 'none');
  const marker = (await indicator.boundingBox())!;
  const target = (await recent.boundingBox())!;
  expect(Math.abs(marker.x - target.x)).toBeLessThan(1);
  await expect(recent).toHaveAttribute('aria-selected', 'true');
});
