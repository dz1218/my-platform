import { expect, test, type Page } from '@playwright/test';

test('login and registration links work when client route requests are unavailable', async ({ page }) => {
  const pageErrors: string[] = [];
  const clientRouteRequests: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  // Next falls back to document navigation if the client router cannot fetch RSC data.
  await page.route('**/*', route => {
    if (route.request().headers()['rsc'] === '1') {
      clientRouteRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/login');
    // Confirm hydration before clicking, so this exercises the client-side behavior.
    await page.getByRole('button', { name: '显示密码' }).click();
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('link', { name: '手机号注册', exact: true }).click();
    await expect(page).toHaveURL('/register');
    await expect(page.getByLabel('短信验证码', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '获取验证码', exact: true })).toBeEnabled();
    await page.getByRole('link', { name: '返回登录', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'password');
  }
  expect(pageErrors).toEqual([]);
  expect(clientRouteRequests.length).toBeGreaterThan(0);
});

async function verifyPhone(page: Page) {
  await page.goto('/register');
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800138002');
  await page.getByRole('textbox', { name: '短信验证码', exact: true }).fill('123456');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('heading', { name: /为相遇，设置一把钥匙。|认识一下你。/ })).toBeVisible();
}

test('phone login errors clear on refresh and a subsequent login succeeds', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/v1/matches', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/discover?*', route => route.fulfill({ json: {
    items: [{ id: 'login-friend', name: '登录测试朋友', age: 24, avatarUrl: '' }],
    total: 1, availableTotal: 1, page: 1, pageSize: 24, nextPage: null, occupations: [],
  } }));
  await page.goto('/login');
  await expect(page.locator('input[type=email]')).toHaveCount(0);
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800138000');
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('手机号或密码不正确，请重新输入。');
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800138000');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('button', { name: '显示密码' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  // A successful redirect alone also passes when the destination has crashed.
  const expectCompanion = async () => {
    await expect(page.getByRole('heading', { name: '今天想和谁聊聊？' })).toBeVisible();
    await expect(page.getByRole('button', { name: '和登录测试朋友打个招呼' })).toBeEnabled();
    await expect(page.getByText('你们的故事，从这里开始')).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  };
  await expectCompanion();
  await page.reload();
  await expectCompanion();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL('/login');
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800138000');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/companion');
  await expectCompanion();
  expect(pageErrors).toEqual([]);
});

test('registration requires verification, shows resend cooldown, and rejects a wrong code', async ({ page }) => {
  await page.goto('/register');
  await expect(page.locator('input[name=password]')).toHaveCount(0);
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800138002');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByRole('status')).toHaveText('验证码已发送，5 分钟内有效。');
  await expect(page.getByRole('button', { name: /s 后重发/ })).toBeDisabled();
  await page.getByRole('textbox', { name: '短信验证码', exact: true }).fill('000000');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('验证码不正确或已过期，请重新获取。');
  await expect(page.locator('input[name=password]')).toHaveCount(0);
  await page.getByRole('textbox', { name: '短信验证码', exact: true }).fill('123456');
  await page.getByRole('button', { name: '验证并继续' }).click();
  await expect(page.getByRole('heading', { name: /为相遇，设置一把钥匙。|认识一下你。/ })).toBeFocused();
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
});

test('duplicate registration is reported and cleared on reload', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800138001');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('该手机号已被注册，请直接登录。');
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('gender help opens on hover, keyboard focus and touch without shifting the form', async ({ page, browser }) => {
  await verifyPhone(page);
  const help = page.getByRole('button', { name: '为什么需要选择性别' });
  const tooltip = page.getByRole('tooltip');
  const gender = page.getByRole('combobox', { name: '性别', exact: true });
  const before = await gender.boundingBox();
  await expect(tooltip).toBeHidden();
  await help.hover();
  await expect(tooltip).toHaveText('用于匹配 AI 身份，注册后可跳过继承。');
  await expect(tooltip).toBeVisible();
  expect(await gender.boundingBox()).toEqual(before);
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await gender.hover();
  await expect(tooltip).toBeHidden();
  await help.hover();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await page.getByLabel('昵称', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(help).toBeFocused();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(gender).toBeFocused();
  await expect(tooltip).toBeHidden();

  const mobile = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true });
  try {
    const touchPage = await mobile.newPage();
    await verifyPhone(touchPage);
    await touchPage.getByRole('button', { name: '为什么需要选择性别' }).tap();
    await expect(touchPage.getByRole('tooltip')).toBeVisible();
    const bounds = await touchPage.getByRole('tooltip').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await touchPage.screenshot({ path: '/tmp/radio-friday-gender-help-mobile.png', fullPage: true });
    await touchPage.getByLabel('密码', { exact: true }).tap();
    await expect(touchPage.getByRole('tooltip')).toBeHidden();
  } finally {
    await mobile.close();
  }
});

test('password step validates confirmation and gender, then completes registration', async ({ page }) => {
  await verifyPhone(page);
  const nickname = page.getByRole('textbox', { name: '昵称', exact: true });
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByLabel('确认密码', { exact: true }).fill('different-password');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '完成注册' }).click();
  await expect(nickname).toBeFocused();
  await nickname.fill('   ');
  await page.getByRole('button', { name: '完成注册' }).click();
  await expect(nickname).toBeFocused();
  await nickname.fill('测试听友');
  await page.getByRole('button', { name: '完成注册' }).click();
  const gender = page.getByRole('combobox', { name: '性别', exact: true });
  await expect(gender).toBeFocused();
  await expect(gender).toHaveAttribute('aria-invalid', 'true');
  await gender.press('ArrowDown');
  await gender.press('ArrowDown');
  await gender.press('Enter');
  await expect(gender).toHaveText('男');
  await page.getByRole('button', { name: '完成注册' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('两次输入的密码不一致。');
  await nickname.fill('测试听友');
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByLabel('确认密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '完成注册' }).click();
  await expect(page).toHaveURL('/choose-identity');
});

test('mobile auth is compact and desktop retains the scene layout', async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: width <= 760 ? '欢迎回来。' : '欢迎回到你的频率。' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 760) {
      await expect(page.locator('.auth-story')).toBeHidden();
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeInViewport();
      expect((await page.locator('#auth-heading').boundingBox())!.y).toBeLessThan(300);
    } else {
      await page.getByRole('button', { name: '故事漫游', exact: true }).click();
      await expect(page.getByRole('heading', { name: '翻开一页，走进另一种生活。' })).toBeVisible();
    }
    await page.screenshot({ path: `/tmp/radio-friday-app-login-${width}.png`, fullPage: true });
    await verifyPhone(page);
    if (width <= 760) {
      await expect(page.getByRole('list', { name: '注册进度' }).locator('[aria-current=step]')).toHaveText('2完善资料');
      expect((await page.getByLabel('昵称', { exact: true }).boundingBox())!.y).toBeLessThan(400);
      await expect(page.getByRole('button', { name: '完成注册', exact: true })).toBeInViewport();
    }
    await page.getByRole('combobox', { name: '性别', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `/tmp/radio-friday-app-profile-${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.auth-frame').evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none');
});

test('story carousel rotates every five seconds without pause controls or hover pauses', async ({ page }) => {
  await page.clock.install();
  await page.goto('/login');
  const scene = (name: string) => page.getByRole('button', { name, exact: true });
  await expect(scene('温暖陪伴')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /暂停图片轮播|播放图片轮播/ })).toHaveCount(0);
  await page.clock.runFor(5100);
  await expect(scene('深夜电台')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(5000);
  await expect(scene('故事漫游')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(5000);
  await expect(scene('温暖陪伴')).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('发现 Radio Friday').hover();
  await page.clock.runFor(5000);
  await expect(scene('深夜电台')).toHaveAttribute('aria-pressed', 'true');
  await scene('故事漫游').focus();
  await page.clock.runFor(5000);
  await expect(scene('故事漫游')).toHaveAttribute('aria-pressed', 'true');
  await scene('深夜电台').click();
  await expect(scene('深夜电台')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(5100);
  await expect(scene('故事漫游')).toHaveAttribute('aria-pressed', 'true');

  // Clicking the selected scene also restarts its full five-second duration.
  await page.clock.runFor(3000);
  await scene('故事漫游').click();
  await page.clock.runFor(4000);
  await expect(scene('故事漫游')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(1100);
  await expect(scene('温暖陪伴')).toHaveAttribute('aria-pressed', 'true');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(5000);
  await expect(scene('深夜电台')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.auth-scene-progress')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.auth-scene.is-active')).toHaveCSS('transition-duration', '0s');
});

test('active scene progress fills over time and resets on manual selection', async ({ page }) => {
  await page.goto('/login');
  const current = page.getByRole('button', { name: '温暖陪伴', exact: true });
  await current.click();
  const progress = page.locator('.auth-scene-progress');
  const fraction = () => progress.evaluate(el => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width);
  await expect(progress).toHaveCount(1);
  await expect(progress).toHaveCSS('animation-duration', '5s');
  await expect.poll(fraction).toBeGreaterThan(0.2);
  expect(await fraction()).toBeLessThan(0.7);
  await current.click();
  expect(await fraction()).toBeLessThan(0.15);
  await page.getByRole('button', { name: '故事漫游', exact: true }).click();
  await expect(progress).toHaveCount(1);
  await expect(page.getByRole('button', { name: '故事漫游', exact: true }).locator('.auth-scene-progress')).toBeVisible();
  expect(await fraction()).toBeLessThan(0.15);
});

test('interaction notice stays in place and preserves login and registration fields', async ({ page, context }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/login');
    await page.getByLabel('手机号', { exact: true }).fill('13800138000');
    await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
    const trigger = page.getByRole('button', { name: '隐私与互动说明', exact: true });
    await trigger.hover();
    await expect(trigger).toHaveCSS('text-decoration-line', 'none');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '隐私与互动说明' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('账号信息和聊天记录会被保存', { exact: false })).toBeVisible();
    await expect(page).toHaveURL('/login');
    await expect(dialog.getByRole('button', { name: '关闭说明' })).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel('手机号', { exact: true })).toHaveValue('13800138000');
    await expect(page.getByLabel('密码', { exact: true })).toHaveValue('only-for-browser-test');
    await trigger.click();
    await dialog.getByRole('button', { name: '关闭说明' }).click();
    await expect(dialog).not.toBeVisible();
    await trigger.click();
    await page.mouse.click(2, 2);
    await expect(dialog).not.toBeVisible();
  }
  await verifyPhone(page);
  await page.getByLabel('密码', { exact: true }).fill('only-for-browser-test');
  await page.getByRole('button', { name: '平台互动说明', exact: true }).click();
  await expect(page).toHaveURL('/register');
  const dialog = page.getByRole('dialog', { name: '隐私与互动说明' });
  await dialog.getByRole('button', { name: '我知道了' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('only-for-browser-test');
  await expect(page.getByRole('heading', { name: /为相遇，设置一把钥匙。|认识一下你。/ })).toBeVisible();
  expect(context.pages()).toHaveLength(1);
});

test('SMS errors stay beside the field and sending only disables the send button', async ({ page }) => {
  await page.goto('/register');
  const phone = page.getByLabel('手机号', { exact: true });
  const code = page.getByLabel('短信验证码', { exact: true });
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(phone).toBeFocused();
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#auth-phone-error')).toHaveText('请输入正确的 11 位手机号。');
  await phone.fill('13800138002');
  await expect(page.locator('#auth-phone-error')).toHaveCount(0);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/register', async route => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: '获取验证码' }).click();
    await expect(page.getByRole('button', { name: '发送中…' })).toBeDisabled();
    await expect(phone).toBeEnabled();
    await expect(code).toBeEnabled();
    await expect(page.getByRole('button', { name: '验证并继续' })).toBeEnabled();
    await code.fill('123456');
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: /s 后重发/ })).toBeDisabled();
  await expect(code).toHaveValue('123456');
});

test('mobile login and registration show three loaded backgrounds and cycle automatically', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  for (const route of ['/login', '/register']) {
    await page.goto(route);
    const background = page.locator('.auth-mobile-background');
    await expect(background).toBeVisible();
    const scenes = background.locator('.auth-mobile-scene');
    await expect(scenes).toHaveCount(3);
    for (const img of await background.locator('img').all()) {
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    for (let index = 0; index < 3; index++) {
      await expect(scenes.nth(index)).toHaveClass(/is-active/);
      await page.clock.runFor(1000);
      await expect(scenes.nth(index)).toHaveCSS('opacity', '1');
      await page.screenshot({ path: `/tmp/auth-${route.slice(1)}-background-${index}.png`, fullPage: true });
      await page.clock.runFor(4000);
    }
    await expect(scenes.nth(0)).toHaveClass(/is-active/);
    await expect(page.getByRole('button', { name: route === '/login' ? '登录' : '验证并继续', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
