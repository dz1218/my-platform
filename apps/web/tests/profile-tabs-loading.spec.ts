import { expect, test } from '@playwright/test';

for (const width of [390, 768, 1440]) {
  test(`profile tabs keep their presentation through hydration at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve; });
    await page.route('**/*', async route => {
      if (route.request().resourceType() === 'script') await scriptsReady;
      await route.continue();
    });
    await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [] } }));
    const tabs = page.getByRole('tablist', { name: '个人主页内容' });
    const recent = tabs.getByRole('tab', { name: '最近聊天', exact: true });
    const identity = tabs.getByRole('tab', { name: 'AI 身份', exact: true });
    async function checkPresentation() {
      await expect(tabs).toHaveCount(1);
      await expect(recent).toHaveCSS('height', width < 768 ? '48px' : '56px');
      if (width < 768) {
        await expect(recent.locator('svg')).toBeVisible();
        await expect(tabs.locator('.profile-tab-indicator')).toBeHidden();
        await expect(recent).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      } else {
        await expect(recent.locator('svg')).toBeHidden();
        await expect(tabs.locator('.profile-tab-indicator')).toBeVisible();
        await expect(recent).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      }
    }
    try {
      await page.goto('/me', { waitUntil: 'commit' });
      await checkPresentation();
      await page.screenshot({ path: testInfo.outputPath('before-hydration.png'), fullPage: true });
    } finally {
      releaseScripts();
    }
    await expect(page.getByText('还没有开始的对话')).toBeVisible();
    await checkPresentation();
    await identity.click();
    await expect(identity).toHaveAttribute('aria-selected', 'true');
    await identity.press('ArrowLeft');
    await expect(recent).toBeFocused();
    await expect(recent).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: testInfo.outputPath('after-hydration.png'), fullPage: true });
  });
}
