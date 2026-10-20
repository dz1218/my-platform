import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`closing auth keeps cached lobby content visible at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let reads = 0;
    let release = () => {};
    let held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/rooms', async route => {
      reads++;
      await held;
      await route.fulfill({ json: { items: [] } });
    });
    try {
      await page.goto('/');
      // The first visit still needs a skeleton while no room data is available.
      await expect(page.locator('[data-skeleton="rooms"]:visible')).toHaveCount(1);
      release();
      const emptyLobby = page.getByText(width < 768 ? '暂无直播间，等一个声音，也可以是你。' : '暂无直播间', { exact: true });
      await expect(emptyLobby).toBeVisible();
      await page.evaluate(() => {
        const flashes: string[] = [];
        const sample = () => {
          for (const skeleton of document.querySelectorAll('[data-skeleton="rooms"]')) {
            if (skeleton.getBoundingClientRect().height > 0) {
              flashes.push(skeleton.closest('[data-app-startup]') ? 'app-startup' : 'lobby');
            }
          }
          document.documentElement.dataset.lobbySkeletonFlashes = JSON.stringify(flashes);
        };
        new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, attributes: true });
        sample();
      });
      // Reuse the same visitor scope through both login and registration.
      for (const authPath of ['/login', '/register']) {
        await page.getByRole('link', { name: width < 768 ? '登录开播' : '登录 / 注册', exact: true }).click();
        if (authPath === '/register') {
          await page.getByRole('link', { name: '手机号注册', exact: true }).click();
          await page.emulateMedia({ reducedMotion: 'reduce' });
        }
        await expect(page).toHaveURL(authPath);
        await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
        const readsBefore = reads;
        held = new Promise<void>(resolve => { release = resolve; });
        await page.getByRole('link', { name: '关闭并进入首页' }).click();
        await expect(page).toHaveURL('/');
        // A return must reuse cached data even if another HTTP read would stall.
        await expect(emptyLobby).toBeVisible();
        await expect(page.getByRole('main')).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(`cached-lobby-${authPath.slice(1)}-${width}.png`) });
        await expect(page.locator('html')).toHaveAttribute('data-lobby-skeleton-flashes', '[]');
        expect(reads).toBe(readsBefore);
        release();
      }
      await expect(page.locator('html')).toHaveAttribute('data-lobby-skeleton-flashes', '[]');
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });

  test(`lobby login never displays an unframed lobby skeleton at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Hold the auth layout chunk so its parent loading boundary stays visible.
    await page.route('**/_next/static/chunks/**', async route => {
      if (decodeURIComponent(route.request().url()).includes('/(auth)/layout')) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      await route.continue();
    });
    await page.goto('/');
    const emptyLobby = page.getByText(width < 768 ? '暂无直播间，等一个声音，也可以是你。' : '暂无直播间', { exact: true });
    await expect(emptyLobby).toBeVisible();
    await page.evaluate(() => {
      const sample = () => {
        for (const skeleton of document.querySelectorAll('[data-skeleton="rooms"]')) {
          if (skeleton.getBoundingClientRect().height > 0 && !skeleton.closest('.app-shell')) {
            document.documentElement.dataset.unframedLobby = 'true';
          }
        }
      };
      new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, attributes: true });
      sample();
    });
    await page.getByRole('link', { name: width < 768 ? '登录开播' : '登录 / 注册', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-unframed-lobby');
    await expect(page.locator('[data-skeleton="rooms"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`) });
    await page.getByRole('link', { name: '关闭并进入首页' }).click();
    await expect(page).toHaveURL('/');
    await expect(emptyLobby).toBeVisible();
    await expect(page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
