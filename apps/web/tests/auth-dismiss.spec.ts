import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  for (const reducedMotion of [false, true]) {
    test(`auth close responds during a slow route at ${width}px, reduced motion ${reducedMotion}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('radio-friday:sidebar-collapsed', 'true');
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = (...args) => {
          document.documentElement.dataset.snapshotStarted = 'true';
          return start(...args);
        };
        document.addEventListener('click', event => {
          if ((event.target as Element).closest('[aria-label="关闭并进入首页"]')) {
            document.documentElement.dataset.closeClickedAt = String(performance.now());
          }
        }, { capture: true });
      });
      let release = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      await page.route(url => url.pathname === '/' && url.searchParams.has('_rsc'), async route => {
        if (route.request().headers()['next-router-prefetch'] === '1') return route.abort();
        await page.evaluate(() => {
          const root = document.documentElement;
          root.dataset.closeRequestMs = String(performance.now() - Number(root.dataset.closeClickedAt));
        });
        await held;
        await route.continue();
      });
      try {
        await page.goto('/privacy');
        await page.goto(reducedMotion ? '/register' : '/login');
        // An interactive control confirms hydration before timing.
        if (!reducedMotion) await page.getByRole('button', { name: '显示密码' }).click();
        else {
          await page.getByRole('button', { name: '隐私与互动说明', exact: true }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        const close = page.getByRole('link', { name: '关闭并进入首页' });
        await close.click();
        await expect(close).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('html')).toHaveAttribute('data-close-request-ms');
        await expect(page.locator('html')).not.toHaveAttribute('data-snapshot-started');
        await expect(page.locator('.auth-page')).toHaveCSS('opacity', reducedMotion ? '1' : '0.8');
        // The old fallback waited 180ms before even requesting the destination.
        const requestMs = Number(await page.locator('html').getAttribute('data-close-request-ms'));
        expect(requestMs).toBeLessThan(150);
        await testInfo.attach('close-timing', { body: JSON.stringify({ requestMs, width, reducedMotion }), contentType: 'application/json' });
        await page.screenshot({ path: testInfo.outputPath('pending-close.png') });
        release();
        await expect(page).toHaveURL('/');
        await expect(page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true })).toBeVisible();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-nav-collapsed', 'true');
        await expect(page.getByRole('main')).toBeFocused();
        await expect(page.locator('.app-shell')).toHaveCSS('opacity', '1');
        await expect(page.locator('.app-shell')).toHaveCSS('transform', 'none');
        if (width < 768) {
          const nav = await page.getByRole('navigation', { name: '手机主导航' }).boundingBox();
          expect(nav!.y + nav!.height).toBeCloseTo(900, 0);
        }
        // Replace must not leave the auth page in history.
        await page.goBack();
        await expect(page).toHaveURL('/privacy');
        expect(errors).toEqual([]);
      } finally {
        release();
      }
    });
  }
}
