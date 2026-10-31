import { expect, test, type Page, type Route } from '@playwright/test';

const friend = (id: string, name: string) => ({ id, name, age: 26, city: '杭州', gender: 'FEMALE', avatarUrl: '', background: '喜欢聊天。' });
const first = friend('greeting-first', '林晚');
const second = friend('greeting-second', '苏禾');
const known = { id: 'known-match', conversationId: 'known-conversation', identity: friend('known-friend', '陈宁') };
const created = { id: 'greeting-match', conversationId: 'greeting-conversation', identity: second };

async function expectPageLocked(page: Page, width: number) {
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  await expect(page.getByRole('status')).toHaveText('正在进入聊天…');
  const filter = page.getByRole('button', { name: /^筛选朋友/, includeHidden: true });
  const nav = page.locator(width < 768 ? '.mobile-nav' : '.primary-nav');
  const targets = [filter, nav.locator('a[href="/me"]')];
  if (width >= 768) targets.push(
    page.getByRole('searchbox', { name: '搜索名字', includeHidden: true }),
    page.locator('aside a[href="/chat/known-match"]'),
    page.locator('aside a[href="/me"]'),
    page.getByRole('button', { name: /^账户与身份/, includeHidden: true }),
  );
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(target).not.toBeFocused();
  }
  await page.keyboard.press('Tab');
  await page.keyboard.type('blocked');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.app-shell'))).toBe(false);
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('dialog:modal, :popover-open')).toHaveCount(0);
  if (width >= 768) await expect(page.getByRole('searchbox', { name: '搜索名字', includeHidden: true })).toHaveValue('');
  const y = await page.evaluate(() => scrollY);
  await page.mouse.move(width / 2, 400);
  await page.mouse.wheel(0, 500);
  await page.keyboard.press('PageDown');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => scrollY)).toBe(y);
  if (width < 768) {
    expect(await page.locator('main').evaluate(element => {
      const touch = new Touch({ identifier: 1, target: element, clientX: 100, clientY: 300 });
      const event = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
    await expect(page.locator('[data-pull-refresh-content]')).toHaveCount(0);
  }
  await expect(page).toHaveURL('/companion?view=discover');
}

for (const width of [1440, 390]) {
  test(`one loading card locks the whole page until failure or navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.context().addCookies([{ name: 'companion_session', value: 'inheritance-test-completed', domain: '127.0.0.1', path: '/' }]);
    let currentMatches = [known];
    let pushMatches = () => {};
    await page.routeWebSocket('**/api/v1/matches/socket?*', socket => {
      pushMatches = () => socket.send(JSON.stringify({ type: 'matches.updated', items: currentMatches }));
      pushMatches();
    });
    const items = [first, second, known.identity, ...Array.from({ length: 12 }, (_, i) => friend(`other-${i}`, `朋友${i}`))];
    await page.route('**/api/v1/discover?*', route => route.fulfill({ json: { items, total: items.length, page: 1, nextPage: null, occupations: [] } }));
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
    const firstButton = page.getByRole('button', { name: '和林晚打个招呼', exact: true, includeHidden: true });
    const secondButton = page.getByRole('button', { name: /和苏禾/, includeHidden: true });
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
    await expect(knownCard.getByRole('button', { includeHidden: true })).toBeDisabled();
    await expect(knownCard.getByRole('button', { includeHidden: true })).toHaveText('继续聊天');
    expect(await firstCard.boundingBox()).toEqual(originalCardSize);
    await expectPageLocked(page, width);
    // Real taps on disabled cards must not enqueue another request or navigate.
    for (const card of [firstCard, page.locator(`[data-identity-id="${second.id}"]`), knownCard]) {
      const target = width < 768 ? card : card.getByRole('button', { includeHidden: true });
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      await page.mouse.click(box.x + 20, box.y + 20);
    }
    expect(calls).toEqual([first.id]);
    await expect(page.locator('[data-identity-id] [aria-busy="true"]')).toHaveCount(1);
    await expect(page.locator('[data-skeleton]:visible')).toHaveCount(0);
    await expect(page).toHaveURL('/companion?view=discover');
    if (width === 1440) await expect(page.getByRole('complementary', { name: '最近聊天', includeHidden: true })).toContainText('陈宁');
    await page.screenshot({ path: testInfo.outputPath(`greeting-pending-${width}.png`), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(firstButton.locator('svg')).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await pending.get(first.id)!.fulfill({ status: 503, json: { error: { message: '暂时无法开始聊天' } } });
    await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
    const filter = page.getByRole('button', { name: /^筛选朋友/ });
    await filter.click();
    await expect(filter).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
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
    await expect(knownCard.getByRole('button', { includeHidden: true })).toBeDisabled();
    await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
    const blocked = (await firstButton.boundingBox())!;
    await page.mouse.click(blocked.x + 10, blocked.y + 10);
    expect(calls).toEqual([first.id, second.id]);
    await expect(page.getByRole('link', { name: /继续聊天\s*，和苏禾/ })).toHaveCount(0);
    await chatRoute!.continue();
    await expect(page).toHaveURL('/chat/greeting-match');
    await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
    await expect(page.getByRole('textbox', { name: '给苏禾发消息' })).toBeVisible();
    await page.getByRole('textbox', { name: '给苏禾发消息' }).fill('可以输入');
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
      const entering = knownCard.getByRole('button', { name: '继续聊天，和陈宁', exact: true, includeHidden: true });
      await expect(entering).toBeDisabled();
      await expect(entering).toHaveAttribute('aria-busy', 'true');
      await expect(entering.locator('svg')).toBeVisible();
      await expect(entering).toHaveText('正在进入');
      expect(await knownCard.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))).toEqual(knownSize);
      await expectPageLocked(page, width);
      await expect(firstButton).toBeDisabled();
      await expect(secondButton).toBeDisabled();
      const blockedNew = (await firstButton.boundingBox())!;
      await page.mouse.click(blockedNew.x + 10, blockedNew.y + 10);
      await expect(page.locator('[data-identity-id] [aria-busy="true"]')).toHaveCount(1);
      expect(calls).toEqual([first.id, second.id]);
      await page.screenshot({ path: testInfo.outputPath(`existing-chat-pending-${width}.png`) });
    } finally { releaseKnown(); }
    await expect(page).toHaveURL('/chat/known-match');
    await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
    await page.goBack();
    await expect(page).toHaveURL('/companion?view=discover');
    await expect(knownCard.getByRole('link')).toBeVisible();
    await filter.click();
    await expect(filter).toHaveAttribute('aria-expanded', 'true');
  });
}
