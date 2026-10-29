import { expect, test, type Route } from '@playwright/test';

const friend = (id: string, name: string) => ({ id, name, age: 26, city: '杭州', gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' });
const first = friend('greeting-first', '林晚');
const second = friend('greeting-second', '苏禾');
const known = { id: 'known-match', conversationId: 'known-conversation', identity: friend('known-friend', '陈宁') };
const created = { id: 'greeting-match', conversationId: 'greeting-conversation', identity: second };

for (const width of [1440, 390]) {
  test(`one loading card locks all chat entries until failure or navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
    let currentMatches = [known];
    let pushMatches = () => {};
    await page.routeWebSocket('**/api/v1/matches/socket?*', socket => {
      pushMatches = () => socket.send(JSON.stringify({ type: 'matches.updated', items: currentMatches }));
      pushMatches();
    });
    await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items: [first, second, known.identity], total: 3, page: 1, nextPage: null, occupations: [] } }));
    const pending = new Map<string, Route>();
    const calls: string[] = [];
    await page.route('**/api/v1/matches', route => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { items: currentMatches } });
      const id = route.request().postDataJSON().identityId;
      calls.push(id);
      pending.set(id, route);
    });
    await page.route('**/api/v1/matches/*', route => route.fulfill({ json: created }));
    await page.route('**/api/v1/conversations/*/messages', route => route.fulfill({ json: { items: [] } }));
    await page.route('**/api/v1/conversations/*/auto-reply', route => route.fulfill({ json: { ownerType: 'HUMAN', mode: 'ALWAYS', delaySeconds: 0, version: 1, canManage: false } }));
    await page.routeWebSocket('**/api/v1/conversations/*/socket?*', () => {});
    let chatRoute: Route | undefined;
    await page.route(/\/chat\/greeting-match(?:\?|$)/, route => { chatRoute = route; });
    await page.goto('/companion?view=discover');
    const firstButton = page.getByRole('button', { name: '和林晚打个招呼', exact: true });
    const secondButton = page.getByRole('button', { name: /和苏禾/ });
    await expect(firstButton).toBeEnabled();
    const originalSize = await firstButton.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
    const firstCard = page.locator(`[data-identity-id="${first.id}"]`);
    const originalCardSize = await firstCard.boundingBox();
    if (width < 768) await firstCard.click({ position: { x: 20, y: 20 } });
    else await firstButton.click();
    await expect.poll(() => calls.length).toBe(1);
    await expect(firstButton).toBeDisabled();
    await expect(firstButton.locator('svg')).toBeVisible();
    await expect(firstButton).toHaveText('正在进入');
    await expect(firstButton).toHaveAttribute('aria-busy', 'true');
    expect(await firstButton.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))).toEqual(originalSize);
    await expect(firstButton.locator('svg')).toHaveCSS('animation-duration', '0.9s');
    await expect(secondButton).toBeDisabled();
    await expect(secondButton).toHaveText('打个招呼');
    const knownCard = page.locator('[data-identity-id="known-friend"]');
    await expect(knownCard.getByRole('button')).toBeDisabled();
    await expect(knownCard.getByRole('button')).toHaveText('继续聊天');
    if (width >= 768) await expect(page.getByRole('button', { name: '刷新人物目录', exact: true })).toBeEnabled();
    else await expect(page.getByRole('button', { name: /^筛选朋友/ })).toBeEnabled();
    expect(await firstCard.boundingBox()).toEqual(originalCardSize);
    // Real taps on disabled cards must not enqueue another request or navigate.
    for (const card of [firstCard, page.locator(`[data-identity-id="${second.id}"]`), knownCard]) {
      const target = width < 768 ? card : card.getByRole('button');
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      await page.mouse.click(box.x + 20, box.y + 20);
    }
    expect(calls).toEqual([first.id]);
    await expect(page.locator('[data-identity-id] [aria-busy="true"]')).toHaveCount(1);
    await expect(page.locator('[data-skeleton]:visible')).toHaveCount(0);
    await expect(page).toHaveURL('/companion?view=discover');
    if (width === 1440) await expect(page.getByRole('complementary', { name: '最近聊天' })).toContainText('陈宁');
    await page.screenshot({ path: testInfo.outputPath(`greeting-pending-${width}.png`), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(firstButton.locator('svg')).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await pending.get(first.id)!.fulfill({ status: 503, json: { error: { message: '暂时无法开始聊天' } } });
    await expect(firstButton).toBeEnabled();
    await expect(firstButton).toHaveText('打个招呼');
    await expect(secondButton).toBeEnabled();
    await expect(knownCard.getByRole('link')).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('暂时无法开始聊天');
    await secondButton.click();
    await expect.poll(() => calls.length).toBe(2);
    await expect(secondButton).toBeDisabled();
    await expect(firstButton).toBeDisabled();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    currentMatches = [created, known];
    pushMatches();
    await expect(secondButton).toBeDisabled();
    await expect(page.getByRole('link', { name: /继续聊天\s*，和苏禾/ })).toHaveCount(0);
    await pending.get(second.id)!.fulfill({ json: created });
    await expect.poll(() => !!chatRoute).toBe(true);
    // Hold the destination after POST success to exercise the original flash.
    await expect(secondButton).toBeVisible();
    await expect(secondButton).toBeDisabled();
    await expect(secondButton).toHaveAttribute('aria-busy', 'true');
    await expect(secondButton.locator('svg')).toBeVisible();
    await expect(firstButton).toBeDisabled();
    await expect(knownCard.getByRole('button')).toBeDisabled();
    const blocked = (await firstButton.boundingBox())!;
    await page.mouse.click(blocked.x + 10, blocked.y + 10);
    expect(calls).toEqual([first.id, second.id]);
    await expect(page.getByRole('link', { name: /继续聊天\s*，和苏禾/ })).toHaveCount(0);
    await chatRoute!.continue();
    await expect(page).toHaveURL('/chat/greeting-match');
    await expect(page.getByRole('textbox', { name: '给苏禾发消息' })).toBeVisible();
    expect(calls).toEqual([first.id, second.id]);
    await page.goBack();
    await expect(page).toHaveURL('/companion?view=discover');
    await expect(page.getByRole('link', { name: /继续聊天\s*，和苏禾/ })).toBeVisible();
    await expect(page.locator('button[aria-busy="true"]')).toHaveCount(0);
    // An existing conversation gets the same stable busy state before its route is ready.
    let releaseKnown = () => {};
    const heldKnown = new Promise<void>(resolve => { releaseKnown = resolve; });
    await page.route(/\/chat\/known-match(?:\?|$)/, async route => { await heldKnown; await route.continue(); });
    await page.route('**/api/v1/matches/known-match', route => route.fulfill({ json: known }));
    await knownCard.scrollIntoViewIfNeeded();
    const knownSize = await knownCard.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }));
    try {
      if (width < 768) await knownCard.click({ position: { x: 20, y: 20 } });
      else await knownCard.getByRole('link').click();
      const entering = knownCard.getByRole('button', { name: '继续聊天，和陈宁', exact: true });
      await expect(entering).toBeDisabled();
      await expect(entering).toHaveAttribute('aria-busy', 'true');
      await expect(entering.locator('svg')).toBeVisible();
      await expect(entering).toHaveText('正在进入');
      expect(await knownCard.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))).toEqual(knownSize);
      await expect(firstButton).toBeDisabled();
      await expect(secondButton).toBeDisabled();
      const blockedNew = (await firstButton.boundingBox())!;
      await page.mouse.click(blockedNew.x + 10, blockedNew.y + 10);
      await expect(page.locator('[data-identity-id] [aria-busy="true"]')).toHaveCount(1);
      expect(calls).toEqual([first.id, second.id]);
      await page.screenshot({ path: testInfo.outputPath(`existing-chat-pending-${width}.png`) });
    } finally { releaseKnown(); }
    await expect(page).toHaveURL('/chat/known-match');
    await page.goBack();
    await expect(page).toHaveURL('/companion?view=discover');
    await expect(knownCard.getByRole('link')).toBeVisible();
  });
}
