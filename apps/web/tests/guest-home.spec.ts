import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`first visit opens login, closes with animation, and allows guest browsing at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        const transition = start(...args);
        void transition.ready.then(() => {
          document.documentElement.dataset.authExitAnimations = JSON.stringify(document.getAnimations()
            .filter(animation => animation instanceof CSSAnimation).map(animation => animation.animationName));
        }).catch(() => {});
        return transition;
      };
    });
    const privateRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/v1/matches')) privateRequests.push(request.url());
    });
    page.on('websocket', socket => {
      if (new URL(socket.url()).pathname.startsWith('/ws/')) privateRequests.push(socket.url());
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    let failDiscovery = false;
    await page.route('**/api/v1/discover?*', route => failDiscovery
      ? route.fulfill({ status: 503, json: { error: { message: '目录暂时不可用' } } })
      : route.fulfill({ json: {
        items: [{ id: 'guest-friend', name: '林晚', age: 26, city: '杭州', occupation: '设计师', avatarUrl: '', background: '喜欢雨天的书店，也愿意认真听你说说今天。' }],
        total: 1, page: 1, nextPage: null, occupations: [],
      } }));
    await page.goto('/');
    await expect(page).toHaveURL('/login');
    const close = page.getByRole('link', { name: '关闭并进入首页' });
    await expect(close).toBeVisible();
    // The next image is mounted by a client effect. Animation requires hydrated
    // handlers; the ordinary link remains usable before hydration without it.
    await expect(page.locator('.auth-scene img').nth(1)).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath(`login-close-${width}.png`), fullPage: true });
    await close.click();
    await expect(page).toHaveURL('/companion');
    await expect.poll(() => page.locator('html').getAttribute('data-auth-exit-animations')).toContain('auth-view-out');
    await expect(page.locator('html')).toHaveAttribute('data-auth-exit-animations', /auth-view-in/);
    await expect(page.locator('html')).not.toHaveAttribute('data-auth-exit');
    await expect(page.getByRole('main')).toBeFocused();
    const greet = page.getByRole('button', { name: '和林晚打个招呼' });
    await expect(greet).toBeEnabled();
    await expect(page.getByRole('link', { name: '登录 / 注册', exact: true })).toBeVisible();
    if (width < 768) {
      await expect(page.getByRole('button', { name: '发现朋友', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: '最近聊天', exact: true }).click();
      await expect(page.getByRole('link', { name: '登录后聊天', exact: true })).toBeVisible();
      await expect(page.getByText('正在加载聊天…')).toHaveCount(0);
      await page.getByRole('button', { name: '发现朋友', exact: true }).click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`guest-home-${width}.png`), fullPage: true });

    // A catalog error and retry must not bypass the disabled private queries.
    failDiscovery = true;
    await page.reload();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('目录暂时不可用');
    failDiscovery = false;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(greet).toBeEnabled();
    await greet.click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('textbox', { name: '手机号', exact: true })).toBeVisible();
    expect(privateRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test('private routes still require login and existing accounts keep identity onboarding', async ({ page }) => {
  for (const path of ['/chat/private-match', '/me', '/operator', '/choose-identity']) {
    await page.goto(path);
    await expect(page).toHaveURL('/login');
  }
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-female', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/');
  await expect(page).toHaveURL('/choose-identity');
});

for (const mode of ['reduced motion', 'animation fallback']) {
  test(`registration can close to home with ${mode}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    if (mode === 'reduced motion') {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        document.startViewTransition = () => {
          document.documentElement.dataset.unexpectedTransition = 'true';
          throw new Error('Reduced motion must not start a view transition');
        };
      });
    } else {
      await page.addInitScript(() => {
        Object.defineProperty(document, 'startViewTransition', { value: undefined });
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          if (this.matches('.auth-page, .app-shell')) {
            const root = document.documentElement;
            root.dataset.fallbackAnimations = String(Number(root.dataset.fallbackAnimations ?? 0) + 1);
          }
          return animate.apply(this, args);
        };
      });
    }
    await page.goto('/privacy');
    await page.goto('/register');
    await page.getByRole('link', { name: '关闭并进入首页' }).click();
    await expect(page).toHaveURL('/companion');
    await expect(page.getByRole('main')).toBeFocused();
    await expect(page.locator('html')).not.toHaveAttribute('data-auth-exit');
    await expect(page.locator('html')).not.toHaveAttribute('data-unexpected-transition');
    if (mode === 'animation fallback') await expect(page.locator('html')).toHaveAttribute('data-fallback-animations', '2');
    // Closing replaces the auth history entry, so Back does not reopen it.
    await page.goBack();
    await expect(page).toHaveURL('/privacy');
    expect(pageErrors).toEqual([]);
  });
}

test('a signed-in account enters home directly', async ({ page }) => {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/');
  await expect(page).toHaveURL('/companion');
  await expect(page.locator('.auth-page')).toHaveCount(0);
});

for (const scenario of [
  { width: 1440, fallback: false, collapsed: true },
  { width: 390, fallback: true, collapsed: false },
]) {
  test(`home and fixed navigation stay still throughout auth dismissal at ${scenario.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    // Populate a tall page during the animation: a transformed shell used to
    // move the fixed mobile navigation to the bottom of this content.
    await page.route('**/api/v1/discover?*', async route => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({ json: {
        items: Array.from({ length: 24 }, (_, index) => ({ id: `friend-${index}`, name: `朋友${index}`, age: 26, avatarUrl: '' })),
        total: 24, page: 1, nextPage: null, occupations: [],
      } });
    });
    await page.addInitScript(({ fallback, collapsed }) => {
      localStorage.setItem('radio-friday:sidebar-collapsed', String(collapsed));
      const bounds = (selector: string) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? [rect.x, rect.y, rect.width, rect.height] : null;
      };
      const track = async (ready: Promise<unknown>, finished: Promise<unknown>) => {
        await ready;
        let ended = false;
        let after = 0;
        void finished.then(() => { ended = true; });
        const frames: unknown[] = [];
        const sample = () => {
          const shell = document.querySelector('.app-shell');
          frames.push({
            heading: bounds('main h1'),
            navigation: bounds(innerWidth < 768 ? '.mobile-nav' : '.site-nav'),
            collapsed: shell?.getAttribute('data-nav-collapsed'),
            transform: fallback && shell ? getComputedStyle(shell).transform
              : getComputedStyle(document.documentElement, '::view-transition-new(root)').transform,
            scrollY,
          });
          if (!ended || after++ < 2) requestAnimationFrame(sample);
          else document.documentElement.dataset.authLayoutFrames = JSON.stringify(frames);
        };
        sample();
      };
      if (fallback) {
        Object.defineProperty(document, 'startViewTransition', { value: undefined });
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          if (this.matches('.app-shell')) void track(animation.ready, animation.finished);
          return animation;
        };
      } else {
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = (...args) => {
          const transition = start(...args);
          void track(transition.ready, transition.finished);
          return transition;
        };
      }
    }, scenario);
    await page.goto('/login');
    await page.getByRole('button', { name: '显示密码' }).click();
    await page.getByRole('link', { name: '关闭并进入首页' }).click();
    await expect(page).toHaveURL('/companion');
    await expect(page.locator('html')).toHaveAttribute('data-auth-layout-frames');
    const framesJSON = (await page.locator('html').getAttribute('data-auth-layout-frames'))!;
    await testInfo.attach('layout-frames', { body: framesJSON, contentType: 'application/json' });
    const frames = JSON.parse(framesJSON);
    expect(frames.length).toBeGreaterThan(2);
    const finalFrame = frames.at(-1);
    expect(finalFrame.heading).not.toBeNull();
    expect(finalFrame.navigation).not.toBeNull();
    expect(finalFrame.collapsed).toBe(String(scenario.collapsed));
    expect(finalFrame.transform).toBe('none');
    expect(finalFrame.scrollY).toBe(0);
    for (const frame of frames) expect(frame).toEqual(finalFrame);
    await expect(page.getByRole('button', { name: '和朋友0打个招呼' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`stable-home-${scenario.width}.png`) });
  });
}
