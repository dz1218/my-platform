import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  // The development toolbar overlaps the bottom-left account button.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    });
  });
  await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
});

test('account opens a panel without navigation and supports keyboard and outside dismissal', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me');
  const trigger = page.getByRole('button', { name: '账户与身份 · 继承测试用户', exact: true });
  const panel = page.getByRole('navigation', { name: '账户与身份', exact: true });
  await trigger.click();
  await expect(page).toHaveURL('/me');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('link', { name: /个人中心/ })).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('link', { name: /拥有一个 AI 身份/ })).toBeFocused();
  await expect(panel.getByRole('link', { name: /拥有一个 AI 身份/ })).toHaveAttribute('href', '/choose-identity');
  await page.screenshot({ path: testInfo.outputPath('account-panel-expanded.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.locator('h1').click();
  await expect(panel).toBeHidden();
  await trigger.click();
  await panel.getByRole('button', { name: '平台互动说明' }).click();
  await expect(page).toHaveURL('/me');
  await expect(panel).toBeHidden();
  const notice = page.getByRole('dialog', { name: '平台互动说明' });
  await expect(notice).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notice).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await panel.getByRole('link', { name: /拥有一个 AI 身份/ }).click();
  await expect(page).toHaveURL('/choose-identity');
});

test('hover keeps the panel aligned, allows crossing the gap and preserves page focus', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me');
  const trigger = page.getByRole('button', { name: '账户与身份 · 继承测试用户', exact: true });
  const panel = page.getByRole('navigation', { name: '账户与身份', exact: true });
  const main = page.locator('#main-content');
  await main.focus();
  await trigger.hover();
  await expect(panel).toBeVisible();
  await expect(main).toBeFocused();
  await expect(page.locator('.nav-identity-card')).toHaveCSS('border-top-width', '0px');
  const anchor = (await trigger.boundingBox())!;
  const popup = (await panel.boundingBox())!;
  expect(900 - anchor.y - anchor.height).toBe(32);
  expect(Math.abs(anchor.y + anchor.height - popup.y - popup.height)).toBeLessThan(1);
  expect(popup.x - anchor.x - anchor.width).toBe(8);
  // Stay in the gap briefly, then move into the panel without closing it.
  await page.mouse.move(anchor.x + anchor.width + 4, anchor.y + anchor.height / 2);
  await page.waitForTimeout(100);
  await panel.getByRole('link', { name: /拥有一个 AI 身份/ }).hover();
  await page.waitForTimeout(300);
  await expect(panel).toBeVisible();
  await expect(main).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('account-hover-aligned.png') });
  await page.mouse.move(1000, 100);
  await expect(panel).toBeHidden();
  await trigger.hover();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(main).toBeFocused();
  await page.waitForTimeout(300);
  await expect(panel).toBeHidden();
  await page.mouse.move(1000, 100);
  await trigger.hover();
  await expect(panel).toBeVisible();
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('link', { name: /拥有一个 AI 身份/ })).toBeFocused();
});

test('collapsed hover panel stays above overlays and within short viewports', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me');
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'account-occlusion-panel';
    Object.assign(overlay.style, { position: 'fixed', inset: '0 0 0 80px', zIndex: '2147483647', background: 'var(--rf-canvas)' });
    document.body.append(overlay);
  });
  const trigger = page.getByRole('button', { name: '账户与身份 · 继承测试用户', exact: true });
  const panel = page.getByRole('navigation', { name: '账户与身份', exact: true });
  await trigger.hover();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  for (const [width, height] of [[1440, 900], [768, 480], [1440, 320]]) {
    await page.setViewportSize({ width, height });
    await trigger.click();
    await expect(panel).toBeVisible();
    expect(await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
        && element.contains(document.elementFromPoint(rect.left + 20, rect.top + 20));
    })).toBe(true);
    const anchor = (await trigger.boundingBox())!;
    const popup = (await panel.boundingBox())!;
    expect(Math.abs(anchor.y + anchor.height - popup.y - popup.height)).toBeLessThan(1);
    expect(popup.x - anchor.x - anchor.width).toBe(8);
    await page.screenshot({ path: testInfo.outputPath(`account-panel-${width}-${height}.png`), fullPage: false });
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await page.evaluate(() => document.getElementById('account-occlusion-panel')?.remove());
  await trigger.click();
  await expect(panel.getByRole('link', { name: /拥有一个 AI 身份/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: '平台互动说明' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: '退出登录' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel).toBeHidden();
});

test('inherited account shows its role and logs out through the existing action', async ({ page, context }) => {
  await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-inherited', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/me');
  const trigger = page.getByRole('button', { name: '账户与身份 · 继承测试用户', exact: true });
  const panel = page.getByRole('navigation', { name: '账户与身份', exact: true });
  await trigger.click();
  await expect(panel.getByRole('link', { name: '陈念 以此身份回复消息' })).toHaveAttribute('href', '/operator');
  await expect(panel.getByText('拥有一个 AI 身份')).toHaveCount(0);
  await panel.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL('/companion');
  await expect(page.getByRole('link', { name: '登录 / 注册', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '账户与身份 · 继承测试用户', exact: true })).toHaveCount(0);
  expect((await context.cookies()).some(cookie => cookie.name === 'companion_session')).toBe(false);
});

test('sidebar collapse persists, keeps accessible links and leaves mobile navigation unchanged', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me');
  const sidebar = page.locator('.site-nav');
  const mainNav = page.getByRole('navigation', { name: '主导航', exact: true });
  const content = page.locator('.app-content');
  await expect(sidebar).toHaveCSS('width', '236px');
  await expect(sidebar).toHaveCSS('border-right-width', '0px');
  await expect(content).toHaveCSS('background-color', await sidebar.evaluate(el => getComputedStyle(el).backgroundColor));
  const trigger = sidebar.getByRole('button', { name: /账户与身份 ·/ });
  await trigger.click();
  const privacy = page.getByRole('navigation', { name: '账户与身份', exact: true }).getByRole('button', { name: '平台互动说明', exact: true });
  await privacy.hover();
  await expect(privacy).toHaveCSS('text-decoration-line', 'none');
  await page.screenshot({ path: testInfo.outputPath('sidebar-expanded.png'), fullPage: true });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  const expand = page.getByRole('button', { name: '展开侧边栏' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toHaveCSS('width', '80px');
  await expect(content).toHaveCSS('margin-left', '80px');
  for (const name of ['陪伴', '直播', '小说', '我的']) {
    const link = mainNav.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await link.hover();
    await expect(page.getByRole('tooltip', { name, exact: true })).toBeVisible();
  }
  await expect(trigger).toBeVisible();
  await mainNav.getByRole('link', { name: '小说', exact: true }).click();
  await expect(page).toHaveURL('/novels');
  await expect(sidebar).toHaveCSS('width', '80px');
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '80px');
  await mainNav.getByRole('link', { name: '我的', exact: true }).click();
  for (const [width, height] of [[1440, 900], [768, 900], [1440, 480]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sidebar-collapsed-${width}-${height}.png`), fullPage: true });
  }
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(sidebar).toHaveCSS('width', '236px');
  await expect(page.getByRole('button', { name: '收起侧边栏' })).toBeFocused();
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await trigger.click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole('navigation', { name: '账户与身份', exact: true })).toBeHidden();
    await expect(page.getByRole('navigation', { name: '手机主导航' })).toBeVisible();
    await expect(content).toHaveCSS('margin-left', '0px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar).toHaveCSS('width', '80px');
});

test('collapsing the sidebar resizes the chat overlay without reconnecting or losing its draft', async ({ page }) => {
  test.setTimeout(60_000);
  const identity = { id: 'sidebar-friend', name: '林晚', age: 26, city: '杭州', gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' };
  const match = { id: 'sidebar-match', conversationId: 'sidebar-conversation', identity };
  let sockets = 0;
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [identity], total: 1, page: 1, nextPage: null, occupations: [] } }));
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [match] } }));
  await page.route('**/api/v1/matches/*', route => route.fulfill({ json: match }));
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'HUMAN', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
  await page.routeWebSocket('**/api/v1/conversations/*/socket?*', () => { sockets++; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/companion?view=discover');
  await page.getByRole('link', { name: /继续聊天\s*，和林晚/ }).click();
  const overlay = page.getByTestId('chat-overlay');
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  const input = page.getByRole('textbox', { name: '给林晚发消息' });
  await expect(input).toBeEnabled();
  await input.fill('保留这段草稿');
  await expect.poll(() => sockets).toBeGreaterThan(0);
  const connections = sockets;
  const chatURL = page.url();
  const account = page.getByRole('button', { name: /账户与身份 ·/ });
  await account.click();
  await page.getByRole('navigation', { name: '账户与身份', exact: true }).getByRole('button', { name: '平台互动说明' }).click();
  const notice = page.getByRole('dialog', { name: '平台互动说明' });
  await expect(notice).toBeVisible();
  await expect(page).toHaveURL(chatURL);
  await notice.getByRole('button', { name: '我知道了' }).click();
  await expect(notice).toBeHidden();
  await expect(account).toBeFocused();
  await expect(input).toHaveValue('保留这段草稿');
  expect(sockets).toBe(connections);
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(overlay).toHaveCSS('left', '80px');
  await expect(input).toHaveValue('保留这段草稿');
  await page.getByRole('button', { name: '展开侧边栏' }).click();
  await expect(overlay).toHaveCSS('left', '236px');
  await expect(input).toHaveValue('保留这段草稿');
  expect(sockets).toBe(connections);
});


test('notice stays on the account page, restores scroll and adapts between modal and bottom sheet', async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1440]) {
    const height = 844;
    // The notice lives in the account menu. Open it on desktop, then verify
    // that the same mounted dialog adapts to each viewport.
    await page.setViewportSize({ width: 1440, height });
    await page.goto('/me');
    const trigger = page.getByRole('button', { name: /账户与身份 ·/ });
    const openNotice = async () => {
      await trigger.click();
      await page.getByRole('navigation', { name: '账户与身份', exact: true }).getByRole('button', { name: '平台互动说明', exact: true }).click();
    };
    const scroll = await page.evaluate(() => window.scrollY);
    await openNotice();
    const dialog = page.getByRole('dialog', { name: '平台互动说明' });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width, height });
    await expect(page).toHaveURL('/me');
    await expect(dialog.getByRole('button', { name: '关闭平台互动说明' })).toBeFocused();
    await expect(dialog.getByRole('heading', { name: '继承者可以查看这个角色的聊天历史' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '回复可能来自 AI，也可能来自真人' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '查看完整说明' })).toHaveAttribute('aria-expanded', 'false');
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (width < 768) {
      expect(Math.abs(bounds.y + bounds.height - height)).toBeLessThan(1);
    } else {
      expect(bounds.width).toBe(640);
      expect(bounds.height).toBeLessThan(560);
      expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(1);
      expect(Math.abs(bounds.y + bounds.height / 2 - height / 2)).toBeLessThan(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`notice-${width}.png`) });
    await dialog.getByRole('button', { name: '查看完整说明' }).click();
    await expect(dialog.getByRole('button', { name: '返回要点' })).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByText('继承者可以查看其他用户与该身份的聊天历史')).toBeVisible();
    for (const name of ['谁在与你聊天', 'AI 身份继承', '聊天记录与隐私', '关于互动']) {
      await expect(dialog.getByRole('heading', { name, exact: true })).toHaveCount(1);
    }
    await dialog.locator('.sheet-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole('button', { name: '关闭平台互动说明' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: '我知道了' })).toBeInViewport();
    await expect(dialog.getByText('人物表达与故事属于产品中的互动', { exact: false })).toBeInViewport();
    await dialog.getByRole('button', { name: '返回要点' }).click();
    await expect(dialog.getByRole('heading', { name: '是否继承，由你决定' })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭平台互动说明' }).focus();
    // Chrome also includes a scrollable content region in the Tab order.
    for (let step = 0; step < 4; step++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      if (await dialog.getByRole('button', { name: '我知道了' }).evaluate(element => element === document.activeElement)) break;
    }
    await expect(dialog.getByRole('button', { name: '我知道了' })).toBeFocused();
    await page.keyboard.press('Tab');
    // Native dialogs can send Tab to browser chrome before wrapping back.
    if (!await dialog.evaluate(element => element.contains(document.activeElement))) {
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
      await page.keyboard.press('Tab');
    }
    await expect(dialog.getByRole('button', { name: '关闭平台互动说明' })).toBeFocused();
    await page.setViewportSize({ width: 1440, height });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await openNotice();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await openNotice();
    await dialog.getByRole('button', { name: '我知道了' }).click();
    await expect(dialog).toBeHidden();
  }
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: '平台互动说明', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '聊天记录与隐私' })).toBeVisible();
});

test('collapsed account stays square and navigation tooltips support hover and keyboard', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me');
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  const account = page.getByRole('button', { name: /账户与身份 ·/ });
  await account.hover();
  await expect(page.getByRole('navigation', { name: '账户与身份', exact: true })).toBeVisible();
  const bounds = (await account.boundingBox())!;
  expect(bounds.width).toBe(44);
  expect(bounds.height).toBe(44);
  await page.screenshot({ path: testInfo.outputPath('collapsed-account.png') });
  await page.keyboard.press('Escape');
  for (const label of ['陪伴', '直播', '小说', '我的']) {
    const link = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: label, exact: true });
    await link.hover();
    const tooltip = page.getByRole('tooltip', { name: label, exact: true });
    await expect(tooltip).toBeVisible();
    await expect(link).not.toHaveAttribute('title');
    await page.screenshot({ path: testInfo.outputPath(`tooltip-${label}.png`) });
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await page.mouse.move(1000, 100);
    await page.locator('#main-content').focus();
    await link.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(tooltip).toBeHidden();
  }
  await page.getByRole('button', { name: '展开侧边栏' }).click();
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '直播', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mobile-navigation.png') });
});
