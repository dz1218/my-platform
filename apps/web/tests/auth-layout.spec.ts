import { expect, test, type Page } from '@playwright/test';

async function layoutBounds(page: Page) {
  return page.locator('.auth-frame, .auth-brand-bar, .auth-story').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  }));
}

test('auth documents keep their full width before hydration', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 1440, height: 844 } });
  try {
    const page = await context.newPage();
    for (const route of ['/login', '/register']) {
      await page.goto(route);
      await expect(page.locator('.app-shell')).toHaveCount(0);
      await expect(page.locator('.auth-frame')).toHaveCSS('width', '1200px');
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
      await page.getByRole('link', { name: '关闭并进入首页' }).click();
      await expect(page).toHaveURL('/');
    }
  } finally {
    await context.close();
  }
});

for (const width of [390, 1440]) {
  test(`auth navigation preserves the scene and its timer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // Pause before navigation at a known future instant. Comparing the browser's
    // emulated clock with the test process's Date can fast-forward to the past.
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    await page.goto('/login');
    const story = page.locator(width > 760 ? '.auth-story' : '.auth-mobile-background');
    await expect(story).toBeVisible();
    await story.evaluate(element => element.setAttribute('data-persisted', 'true'));
    await page.clock.runFor(8000);
    const activeScene = page.locator(width > 760 ? '.auth-scene' : '.auth-mobile-scene').nth(1);
    await expect(activeScene).toHaveClass(/is-active/);
    const documents: string[] = [];
    page.on('request', request => {
      if (request.isNavigationRequest() && request.resourceType() === 'document') documents.push(request.url());
    });

    await page.getByRole('link', { name: '手机号注册', exact: true }).click();
    await expect(page).toHaveURL('/register');
    // Streaming introduces React's reveal scheduling; advance its clock too.
    await expect.poll(async () => { await page.clock.runFor(50); return page.getByLabel('短信验证码', { exact: true }).isVisible(); }).toBe(true);
    await expect(story).toHaveAttribute('data-persisted', 'true');
    await expect(activeScene).toHaveClass(/is-active/);
    await page.clock.runFor(2100);
    await expect(page.locator(width > 760 ? '.auth-scene' : '.auth-mobile-scene').nth(2)).toHaveClass(/is-active/);

    await page.getByRole('link', { name: '返回登录', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await expect.poll(async () => { await page.clock.runFor(50); return page.getByLabel('密码', { exact: true }).isVisible(); }).toBe(true);
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'password');
    await expect(story).toHaveAttribute('data-persisted', 'true');
    await page.goBack();
    await expect(page).toHaveURL('/register');
    await expect.poll(async () => { await page.clock.runFor(50); return page.getByLabel('短信验证码', { exact: true }).isVisible(); }).toBe(true);
    await expect(story).toHaveAttribute('data-persisted', 'true');
    await page.goForward();
    await expect(page).toHaveURL('/login');
    await expect(story).toHaveAttribute('data-persisted', 'true');
    expect(documents).toEqual([]);
  });
}

for (const width of [768, 1000, 1440, 1920]) {
  test(`desktop frame and scene stay fixed through registration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/login');
    await expect(page.locator('.auth-story')).toBeVisible();
    const bounds = await layoutBounds(page);
    await page.getByRole('link', { name: '手机号注册', exact: true }).click();
    await expect(page.getByLabel('短信验证码', { exact: true })).toBeVisible();
    expect(await layoutBounds(page)).toEqual(bounds);
    await page.getByRole('button', { name: '获取验证码', exact: true }).click();
    await expect(page.locator('#auth-phone-error')).toBeVisible();
    expect(await layoutBounds(page)).toEqual(bounds);
    await page.getByLabel('手机号', { exact: true }).fill('13800138002');
    await page.getByRole('button', { name: '获取验证码', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('验证码已发送，5 分钟内有效。');
    expect(await layoutBounds(page)).toEqual(bounds);
    await page.getByLabel('短信验证码', { exact: true }).fill('123456');
    await page.getByRole('button', { name: '验证并继续', exact: true }).click();
    await expect(page.getByLabel('昵称', { exact: true })).toBeVisible();
    expect(await layoutBounds(page)).toEqual(bounds);
    await page.getByRole('button', { name: '完成注册', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '完成注册', exact: true })).toBeInViewport();
    expect(await layoutBounds(page)).toEqual(bounds);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/radio-friday-review/auth-profile-stable-${width}.png`, fullPage: true });
  });
}
