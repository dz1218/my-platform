import { expect, test, type Page } from '@playwright/test';

const identities = Array.from({ length: 240 }, (_, index) => ({
  id: `tab-role-${index}`, name: `导航朋友${String(index).padStart(3, '0')}`,
  age: 18 + index % 33, gender: 'FEMALE', city: '杭州', avatarUrl: '',
  occupationCode: 'teacher', occupation: '教师',
  background: '喜欢听你分享生活里的小事。'.repeat(1 + index % 6),
}));

async function setup(page: Page) {
  await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
  const requests: string[] = [];
  await page.route('**/api/v1/discover?*', route => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    return route.fulfill({ json: { items: identities.slice((pageNumber - 1) * 24, pageNumber * 24), total: identities.length,
      page: pageNumber, pageSize: 24, nextPage: pageNumber * 24 < identities.length ? pageNumber + 1 : null,
      occupations: [{ code: 'teacher', name: '教师' }] } });
  });
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [] } }));
  await page.routeWebSocket('**/ws/matches', socket => { socket.onMessage(() => {}); });
  return requests;
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    let frames = 0;
    const next = () => ++frames < 14 ? requestAnimationFrame(next) : resolve();
    requestAnimationFrame(next);
  }));
}

async function readPosition(page: Page) {
  return page.locator('[data-identity-id]').evaluateAll(nodes => {
    const card = nodes.find(node => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom < window.innerHeight - 70;
    }) as HTMLElement | undefined;
    if (!card) throw new Error('A fully visible catalog card is required');
    card.dataset.retained = 'tab-scroll';
    return { id: card.dataset.identityId!, top: card.getBoundingClientRect().top, y: window.scrollY };
  });
}

for (const width of [390, 1440]) {
  test(`main tabs retain the measured catalog and scroll at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    const requests = await setup(page);
    await page.goto('/companion?view=discover');
    const catalog = page.getByTestId('identity-catalog');
    await expect.poll(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      return Number(await catalog.getAttribute('data-loaded-count'));
    }, { timeout: 60_000, intervals: [150, 250] }).toBeGreaterThanOrEqual(144);
    await page.evaluate(() => window.scrollBy(0, -window.innerHeight * 2));
    await settle(page);
    const saved = await readPosition(page);
    const loaded = await catalog.getAttribute('data-loaded-count');
    const reads = requests.length;
    const nav = page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true });
    // Next's development badge covers the center of the first bottom navigation item.
    const returnToCompanion = () => nav.getByRole('link', { name: '陪伴', exact: true }).click(width < 768 ? { position: { x: 70, y: 20 } } : {});
    for (const label of ['直播', '小说', '我的']) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).not.toHaveURL(/\/companion/);
      await expect(page.getByTestId('companion-background')).toBeHidden();
      await page.evaluate(() => window.scrollTo(0, 200));
      await settle(page);
      await returnToCompanion();
      await expect(page).toHaveURL('/companion?view=discover');
      await settle(page);
      const card = page.locator(`[data-identity-id="${saved.id}"]`);
      await expect(card).toHaveAttribute('data-retained', 'tab-scroll');
      expect(Math.abs((await card.boundingBox())!.y - saved.top)).toBeLessThanOrEqual(2);
      expect(Math.abs(await page.evaluate(() => window.scrollY) - saved.y)).toBeLessThanOrEqual(2);
      await expect(catalog).toHaveAttribute('data-loaded-count', loaded!);
      expect(requests).toHaveLength(reads);
    }
    await returnToCompanion();
    expect(Math.abs(await page.evaluate(() => window.scrollY) - saved.y)).toBeLessThanOrEqual(2);
    await page.goBack();
    await expect(page).toHaveURL('/me');
    await page.goForward();
    await expect(page).toHaveURL('/companion?view=discover');
    await settle(page);
    expect(Math.abs(await page.evaluate(() => window.scrollY) - saved.y)).toBeLessThanOrEqual(2);
  });
}

test('returning to the catalog after a viewport change restores its content before revealing it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = await setup(page);
  await page.goto('/companion?view=discover');
  const catalog = page.getByTestId('identity-catalog');
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    return Number(await catalog.getAttribute('data-loaded-count'));
  }, { timeout: 60_000, intervals: [150, 250] }).toBeGreaterThanOrEqual(144);
  await page.evaluate(() => window.scrollBy(0, -window.innerHeight * 2));
  await settle(page);

  for (const width of [390, 1440]) {
    // Use the same first visible anchor the browsing owner saves, including a
    // partially visible card; columns can differ after a viewport change.
    const saved = await page.locator('[data-identity-id]').evaluateAll(nodes => {
      const anchor = (nodes as HTMLElement[]).filter(node => node.getBoundingClientRect().bottom > 0)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      return { id: anchor.dataset.identityId!, top: anchor.getBoundingClientRect().top };
    });
    const loaded = await catalog.getAttribute('data-loaded-count');
    const reads = requests.length;
    await page.getByRole('navigation', { name: width === 390 ? '主导航' : '手机主导航', exact: true }).getByRole('link', { name: '我的', exact: true }).click();
    await expect(page).toHaveURL('/me');
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByTestId('companion-background')).toBeHidden();
    await page.evaluate(saved => {
      const observations: Array<{ top: number | null }> = [];
      (window as typeof window & { restoredCatalogFrames: typeof observations }).restoredCatalogFrames = observations;
      let frames = 0;
      const sample = () => {
        const background = document.querySelector<HTMLElement>('[data-testid="companion-background"]');
        if (location.pathname === '/companion' && background && getComputedStyle(background).visibility !== 'hidden') {
          const anchor = background.querySelector<HTMLElement>(`[data-identity-id="${saved.id}"]`);
          observations.push({ top: anchor?.getBoundingClientRect().top ?? null });
        }
        if (++frames < 240) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, saved);
    await page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true }).getByRole('link', { name: '陪伴', exact: true }).click(width < 768 ? { position: { x: 70, y: 20 } } : {});
    await expect(page).toHaveURL('/companion?view=discover');
    const card = page.locator(`[data-identity-id="${saved.id}"]`);
    await expect(card).toBeVisible();
    await settle(page);
    expect(Math.abs((await card.boundingBox())!.y - saved.top)).toBeLessThanOrEqual(2);
    const visibleFrames = await page.evaluate(() => (window as typeof window & { restoredCatalogFrames: Array<{ top: number | null }> }).restoredCatalogFrames);
    expect(visibleFrames.length).toBeGreaterThan(0);
    expect(visibleFrames.every(frame => frame.top !== null && Math.abs(frame.top - saved.top) <= 2)).toBe(true);
    await expect(catalog).toHaveAttribute('data-loaded-count', loaded!);
    expect(requests).toHaveLength(reads);
  }
});

test('retaining companion does not retain or duplicate a chat connection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  const match = { id: 'tab-match', conversationId: 'tab-conversation', identity: identities[0] };
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [match] } }));
  await page.route('**/api/v1/matches/tab-match', route => route.fulfill({ json: match }));
  await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'AI', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
  let connections = 0;
  await page.routeWebSocket('**/ws/conversations/*', socket => {
    connections++;
    socket.onClose(() => { connections--; });
  });
  await page.goto('/companion');
  await page.getByRole('complementary', { name: '最近聊天' }).getByRole('link', { name: /导航朋友000/ }).click();
  await expect(page.getByTestId('chat-overlay')).toBeVisible();
  await expect.poll(() => connections).toBe(1);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/me');
  await expect(page.getByTestId('chat-overlay')).toHaveCount(0);
  await expect.poll(() => connections).toBe(0);
  await page.getByRole('link', { name: '继续和导航朋友000聊天' }).click();
  await expect(page).toHaveURL('/chat/tab-match');
  await expect(page.getByTestId('chat-overlay')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /发消息/ })).toHaveCount(1);
  await expect(page.getByTestId('companion-background')).toBeHidden();
  await expect.poll(() => connections).toBe(1);
  await page.reload();
  await expect(page.getByTestId('companion-background')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /发消息/ })).toHaveCount(1);
});

test('ordinary pages restore cached content and their own scroll on tabs and history', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  let reads = 0;
  const novels = Array.from({ length: 72 }, (_, index) => ({
    id: `scroll-book-${index}`, title: `滚动小说${index}`, description: '留在这一本书所在的位置。',
    status: 'ongoing', authorId: 'author', author: { id: 'author', name: '作者' }, chapterCount: 1,
  }));
  await page.route('**/api/v1/novels', route => {
    reads++;
    return route.fulfill({ json: { items: novels } });
  });
  await page.goto('/novels');
  await expect(page.getByRole('link', { name: /滚动小说0 / })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1350));
  await settle(page);
  const saved = await page.evaluate(() => window.scrollY);
  expect(saved).toBeGreaterThan(1000);
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await nav.getByRole('link', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL('/me');
  await nav.getByRole('link', { name: '小说', exact: true }).click();
  await expect(page).toHaveURL('/novels');
  await settle(page);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - saved)).toBeLessThanOrEqual(2);
  expect(reads).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL('/me');
  await page.goBack();
  await expect(page).toHaveURL('/novels');
  await settle(page);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - saved)).toBeLessThanOrEqual(2);
  expect(reads).toBe(1);
});

test('the bookshelf restores the same book after changing viewport columns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  let reads = 0;
  const novels = Array.from({ length: 72 }, (_, index) => ({
    id: `resize-book-${index}`, title: `跨列小说${index}`, description: '变换窗口后仍留在这一本书。',
    status: 'ongoing', authorId: 'author', author: { id: 'author', name: '作者' }, chapterCount: 1,
  }));
  await page.route('**/api/v1/novels', route => {
    reads++;
    return route.fulfill({ json: { items: novels } });
  });
  await page.goto('/novels');
  await expect(page.locator('[data-browse-anchor="novel:resize-book-0"]')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1350));
  await settle(page);

  for (const width of [390, 1440]) {
    const saved = await page.locator('[data-browse-anchor]').evaluateAll(nodes => {
      const anchor = (nodes as HTMLElement[]).filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
      }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      return { key: anchor.dataset.browseAnchor!, top: anchor.getBoundingClientRect().top };
    });
    await page.getByRole('navigation', { name: width === 390 ? '主导航' : '手机主导航', exact: true }).getByRole('link', { name: '我的', exact: true }).click();
    await expect(page).toHaveURL('/me');
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(saved => {
      const observations: Array<number | null> = [];
      (window as typeof window & { restoredShelfFrames: typeof observations }).restoredShelfFrames = observations;
      let frames = 0;
      const sample = () => {
        const main = document.querySelector<HTMLElement>('main#main-content');
        if (location.pathname === '/novels' && main && getComputedStyle(main).visibility !== 'hidden') {
          observations.push(main.querySelector<HTMLElement>(`[data-browse-anchor="${saved.key}"]`)?.getBoundingClientRect().top ?? null);
        }
        if (++frames < 240) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, saved);
    await page.getByRole('navigation', { name: width < 768 ? '手机主导航' : '主导航', exact: true }).getByRole('link', { name: '小说', exact: true }).click();
    await expect(page).toHaveURL('/novels');
    const book = page.locator(`[data-browse-anchor="${saved.key}"]`);
    await expect(book).toBeVisible();
    await settle(page);
    expect(Math.abs((await book.boundingBox())!.y - saved.top)).toBeLessThanOrEqual(2);
    const visibleFrames = await page.evaluate(() => (window as typeof window & { restoredShelfFrames: Array<number | null> }).restoredShelfFrames);
    expect(visibleFrames.length).toBeGreaterThan(0);
    expect(visibleFrames.every(top => top !== null && Math.abs(top - saved.top) <= 2)).toBe(true);
    expect(reads).toBe(1);
  }
});
